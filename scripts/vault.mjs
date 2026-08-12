/**
 * Makes a scratch Obsidian vault with the frontmatter probe installed, and
 * says how to open it.
 *
 *     npm run vault              a random three-word name
 *     npm run vault -- <name>    that name, new or already there
 *
 * Vaults are made under `.vaults/` at the top of the repository, which git
 * ignores. Naming one that already exists reports it rather than replacing
 * it: the probe is rebuilt and refreshed if the vault's copy has fallen
 * behind, and nothing else in the vault is touched.
 *
 * Walking the tree, running the build and copying files are here. What a
 * name may be and what a walked vault amounts to are in `vault-core.ts`;
 * the wording of everything printed is in `vault-text.ts`.
 */

import { spawnSync } from 'node:child_process';
import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { delimiter, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CONFIG_FOLDER,
	checkName,
	classifyInstall,
	generateName,
	summarizeVault,
} from './vault-core.ts';
import {
	HELP,
	PLUGIN_LIST,
	PROBE_ID,
	formatOutcome,
	vaultReadme,
} from './vault-text.ts';

const VAULTS_FOLDER = '.vaults';
/** The pair a vault's plugin folder wants, as the probe build names them. */
const PROBE_FILES = ['main.js', 'manifest.json'];

try {
	main();
} catch (error) {
	console.error(`vault: ${said(error)}`);
	if (process.env['DEBUG'] !== undefined && error instanceof Error) {
		console.error(error.stack);
		if (error.cause !== undefined) {
			console.error(`caused by: ${said(error.cause)}`);
		}
	}
	process.exit(1);
}

function main() {
	const argv = process.argv.slice(2);
	if (argv.includes('--help') || argv.includes('-h')) {
		console.log(HELP);
		return;
	}

	const root = repositoryRoot();
	const name = chooseName(argv);
	const path = join(root, VAULTS_FOLDER, name);

	// Everything that can be known to be impossible is settled before the
	// build runs, so a run that cannot work says so at once instead of
	// spending a build first and failing on a mkdir afterwards.
	requireDependencies();
	requireUsableTarget(join(root, VAULTS_FOLDER), path);

	const created = !existsSync(path);
	console.log('Building the probe...');
	const fresh = buildProbe(root);

	const laidOut = layOutVault(path, name);
	const install = installProbe(path, fresh);

	console.log('');
	console.log(
		formatOutcome({
			name,
			path,
			created,
			laidOut,
			install,
			report: summarizeVault(scanVault(path)),
			cliFound: onPath('obsidian'),
		}),
	);
}

/**
 * That the repository's dependencies are installed. The probe build imports
 * esbuild, so a fresh checkout that has not been installed fails inside
 * node's module loader with a stack about a package the owner never named.
 * Asking first turns that into the one instruction that fixes it.
 */
function requireDependencies() {
	const missing = new Error(
		'dependencies are not installed here; run npm ci first',
	);
	let resolved;
	try {
		resolved = import.meta.resolve('esbuild');
	} catch (error) {
		throw new Error(missing.message, { cause: error });
	}
	// Resolution alone proves nothing: node answers with the path a package
	// would occupy whether or not anything is there. The file has to exist.
	if (!existsSync(fileURLToPath(resolved))) {
		throw missing;
	}
}

/**
 * That a vault can be put at this path: that nothing else is already there
 * under that name, and that the directory it goes in can be written to. The
 * errno these would otherwise surface as names a path the owner did not
 * type and a call they did not make.
 */
function requireUsableTarget(vaults, path) {
	if (existsSync(vaults) && !isDirectory(vaults)) {
		throw new Error(`${vaults} is a file, and vaults are made inside it`);
	}
	if (existsSync(path) && !isDirectory(path)) {
		throw new Error(`${path} is a file, not a vault`);
	}
	const writable = existsSync(path)
		? path
		: existsSync(vaults)
			? vaults
			: null;
	if (writable === null) {
		return;
	}
	try {
		accessSync(writable, constants.W_OK);
	} catch (error) {
		throw new Error(`${writable} cannot be written to`, { cause: error });
	}
}

function isDirectory(path) {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/**
 * The repository this script is a file in, found from its own location so
 * that the answer does not depend on where it was run from. A checkout is
 * what it needs: the probe to install comes out of one.
 */
function repositoryRoot() {
	const root = fileURLToPath(new URL('../', import.meta.url));
	const manifest = join(root, 'package.json');
	if (!existsSync(manifest) || !existsSync(probeBuild(root))) {
		throw new Error(`${root} is not a checkout of the repository`);
	}
	const name = JSON.parse(readFileSync(manifest, 'utf8')).name;
	if (name !== 'davenport') {
		throw new Error(
			`${root} holds ${String(name)}, not the davenport repository`,
		);
	}
	return root;
}

function probeBuild(root) {
	return join(root, 'tools', 'a11-probe', 'build.mjs');
}

/**
 * The name given on the command line, or one drawn for the occasion.
 *
 * An argument that is not a name is refused rather than skipped over. A
 * script that quietly made a randomly named vault because the name it was
 * handed looked like an option would be answering a question nobody asked.
 */
function chooseName(argv) {
	const unknown = argv.find((argument) => argument.startsWith('-'));
	if (unknown !== undefined) {
		throw new Error(`unknown option ${unknown}; npm run vault -- --help`);
	}
	if (argv.length > 1) {
		throw new Error(
			`one name at a time, and ${String(argv.length)} were given`,
		);
	}
	if (argv.length === 0) {
		return generateName(Math.random);
	}
	const checked = checkName(argv[0]);
	if (!checked.ok) {
		throw new Error(checked.reason);
	}
	return checked.name;
}

/**
 * Runs the probe build and reads back what it wrote. The build is run every
 * time, so what a vault is compared against is the build of the tree as it
 * stands rather than whatever was left in `dist/` last.
 */
function buildProbe(root) {
	const built = spawnSync(process.execPath, [probeBuild(root)], {
		cwd: root,
		encoding: 'utf8',
	});
	if (built.status !== 0) {
		process.stderr.write(built.stderr || built.stdout || '');
		throw new Error('the probe build failed, and its output is above');
	}
	const distribution = join(root, 'tools', 'a11-probe', 'dist');
	return new Map(
		PROBE_FILES.map((file) => {
			const source = join(distribution, file);
			if (!existsSync(source)) {
				throw new Error(`the probe build wrote no ${file}`);
			}
			return [file, readFileSync(source)];
		}),
	);
}

/**
 * A vault Obsidian will open: a configuration folder with the settings it
 * expects to find, the probe listed as one to enable, and a note at the top
 * saying what the vault is for. Returns the files it had to write.
 *
 * Every write here is made only where there is no file already, so this runs
 * against a vault that already exists as readily as against a new one: a
 * directory that was never laid out, or one carried in from another device
 * with its dotfiles left behind, gains what it is missing and nothing else.
 * A file that is there is a file the owner is entitled to have edited.
 */
function layOutVault(path, name) {
	mkdirSync(join(path, CONFIG_FOLDER), { recursive: true });
	const written = [];
	const wrote = (file, contents) => {
		if (writeIfAbsent(file, contents)) {
			written.push(file.slice(path.length + 1));
		}
	};
	wrote(join(path, CONFIG_FOLDER, 'app.json'), '{}\n');
	wrote(
		join(path, CONFIG_FOLDER, PLUGIN_LIST),
		`${JSON.stringify([PROBE_ID], null, '\t')}\n`,
	);
	wrote(join(path, 'README.md'), vaultReadme(name));
	return written.map((file) => file.split(sep).join('/'));
}

/** Puts the build into the vault, or leaves a copy that matches it alone. */
function installProbe(path, fresh) {
	const folder = join(path, CONFIG_FOLDER, 'plugins', PROBE_ID);
	const installed = new Map();
	for (const file of fresh.keys()) {
		const target = join(folder, file);
		if (existsSync(target)) {
			installed.set(file, readFileSync(target));
		}
	}
	const verdict = classifyInstall(fresh, installed);
	if (verdict.toWrite.length > 0) {
		mkdirSync(folder, { recursive: true });
		for (const file of verdict.toWrite) {
			writeFileSync(join(folder, file), fresh.get(file));
		}
	}
	return verdict;
}

/** The vault as the report wants it: every file, and what the plugins are. */
function scanVault(path) {
	const walked = { files: [], unreadable: [] };
	walk(path, '', walked);
	return {
		files: walked.files,
		unreadable: walked.unreadable,
		installedPlugins: folderNames(join(path, CONFIG_FOLDER, 'plugins')),
		enabledPlugins: enabledPlugins(path),
	};
}

/**
 * Every file under this directory, as slash-separated relative paths.
 *
 * A directory that cannot be read is noted and stepped over. The report is
 * the last thing the run does and the least of what it is for; letting one
 * unreadable folder throw it away would lose the path, the link and the
 * probe's state over a directory the owner may not even have meant to keep.
 */
function walk(directory, prefix, walked) {
	let entries;
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch {
		walked.unreadable.push(prefix === '' ? '.' : prefix);
		return;
	}
	for (const entry of entries) {
		const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
		if (entry.isDirectory()) {
			walk(join(directory, entry.name), relative, walked);
		} else if (entry.isFile()) {
			walked.files.push(relative);
		}
	}
}

function folderNames(directory) {
	try {
		return readdirSync(directory, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
	} catch {
		return [];
	}
}

/**
 * The plugin ids the vault's own list enables. A list that is missing or
 * that holds something other than ids is reported as no list at all, which
 * reads differently from a list enabling nothing.
 */
function enabledPlugins(path) {
	const file = join(path, CONFIG_FOLDER, PLUGIN_LIST);
	if (!existsSync(file)) {
		return null;
	}
	try {
		const listed = JSON.parse(readFileSync(file, 'utf8'));
		return Array.isArray(listed) &&
			listed.every((id) => typeof id === 'string')
			? listed
			: null;
	} catch {
		return null;
	}
}

/**
 * Whether a command of this name is on the path, without running it. It has
 * to be a file and it has to be executable: a directory of that name, or a
 * file nobody may run, is not a command, and offering one would hand the
 * owner a line that fails when they paste it.
 */
function onPath(command) {
	const paths = (process.env['PATH'] ?? '').split(delimiter);
	return paths.some((entry) => {
		if (entry === '') {
			return false;
		}
		const candidate = join(entry, command);
		try {
			// statSync follows symlinks, so a dangling one is not a command.
			if (!statSync(candidate).isFile()) {
				return false;
			}
			accessSync(candidate, constants.X_OK);
			return true;
		} catch {
			return false;
		}
	});
}

/** Writes the file if it is not there, and says whether it did. */
function writeIfAbsent(file, contents) {
	if (existsSync(file)) {
		return false;
	}
	writeFileSync(file, contents);
	return true;
}

function said(error) {
	return error instanceof Error ? error.message : 'no reason given';
}
