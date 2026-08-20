/**
 * This script makes a scratch Obsidian vault with the frontmatter probe
 * installed. The script also says how to open the vault.
 *
 *     npm run vault              a random three-word name
 *     npm run vault -- <name>    that name, new or already there
 *
 * The script makes each vault under `.vaults/` at the top of the repository.
 * Git ignores that directory. If you name a vault that already exists, the
 * script reports on that vault and does not replace it. The script builds
 * the probe on each run. If the copy in the vault is different, the script
 * writes the new copy. The script touches nothing else in the vault.
 *
 * This file walks the tree, runs the build, and copies the files.
 * `vault-core.ts` holds the rules for a name and the sum of a walked vault.
 * `vault-text.ts` holds the wording of everything that the script prints.
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
	probeBuildFailure,
	vaultReadme,
} from './vault-text.ts';

const VAULTS_FOLDER = '.vaults';
/**
 * The two files that the plugin folder of a vault needs. The probe build
 * gives them these names.
 */
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

	// The script settles every known impossibility before the build runs.
	// Thus a run that cannot work says so at once. It does not spend a build
	// first and then fail on a mkdir afterwards.
	requireDependencies();
	requireUsableTarget(join(root, VAULTS_FOLDER), path);

	const created = !existsSync(path);
	console.log('The script builds the probe...');
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
 * Requires that the repository has its dependencies installed. The probe
 * build imports esbuild. A fresh checkout without an install fails inside
 * the module loader of node. That failure shows a stack about a package that
 * the owner never named. This check turns that failure into the one
 * instruction that repairs it.
 */
function requireDependencies() {
	const missing = new Error(
		'this checkout has no installed dependencies; run npm ci first',
	);
	let resolved;
	try {
		resolved = import.meta.resolve('esbuild');
	} catch (error) {
		throw new Error(missing.message, { cause: error });
	}
	// Resolution alone proves nothing. Node answers with the path that a
	// package would occupy, whether or not the package is there. Therefore
	// the file must also exist.
	if (!existsSync(fileURLToPath(resolved))) {
		throw missing;
	}
}

/**
 * Requires that a vault can go at this path. Nothing else can be there under
 * that name. The script must be able to write to the directory that holds
 * the vault. Without these checks, node reports an errno. That errno names a
 * path that the owner did not type, and a call that the owner did not make.
 */
function requireUsableTarget(vaults, path) {
	if (existsSync(vaults) && !isDirectory(vaults)) {
		throw new Error(
			`${vaults} is a file, but the script makes vaults inside it`,
		);
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
		throw new Error(`the script cannot write to ${writable}`, {
			cause: error,
		});
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
 * The repository that holds this script. The function finds the repository
 * from the location of the script. Thus the answer does not depend on the
 * directory where the owner ran the script. The script needs a checkout,
 * because the probe to install comes out of a checkout.
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
			`${root} holds the package ${String(name)}, and not the davenport repository`,
		);
	}
	return root;
}

function probeBuild(root) {
	return join(root, 'tools', 'frontmatter-probe', 'build.mjs');
}

/**
 * The name from the command line, or a name that the script draws.
 *
 * The script refuses an argument that is not a name. The script does not
 * step over such an argument. An argument can look like an option. A script
 * that quietly made a vault with a random name in that case would answer a
 * question that nobody asked.
 */
function chooseName(argv) {
	const unknown = argv.find((argument) => argument.startsWith('-'));
	if (unknown !== undefined) {
		throw new Error(
			`unknown option ${unknown}; for the usage text, run npm run vault -- --help`,
		);
	}
	if (argv.length > 1) {
		throw new Error(
			`the script takes one name at a time, and you gave ${String(argv.length)}`,
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
 * Runs the probe build and reads back the files that the build wrote. The
 * build runs every time. Thus the script compares a vault against the build
 * of the tree as it stands now, and not against the last contents of
 * `dist/`.
 *
 * A host can abort the build. The host then gives the build a status that the
 * build did not choose. The script does not run the build again. The script
 * names the abort, and the person who runs the script decides what to do.
 */
function buildProbe(root) {
	const built = spawnSync(process.execPath, [probeBuild(root)], {
		cwd: root,
		encoding: 'utf8',
	});
	if (built.status !== 0) {
		process.stderr.write(built.stderr || built.stdout || '');
		throw new Error(probeBuildFailure(built.status, process.platform));
	}
	const distribution = join(root, 'tools', 'frontmatter-probe', 'dist');
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
 * Makes a vault that Obsidian can open. The vault gets a configuration
 * folder with the settings that Obsidian expects. The vault lists the probe
 * as a plugin to enable. The vault gets a note at the top that says what the
 * vault is for. The function returns the files that it had to write.
 *
 * The function writes a file only where no file is there already. Therefore
 * it runs against a vault that already exists as readily as against a new
 * vault. This also applies to a directory that nobody laid out. This also
 * applies to a directory that came from another device without its dotfiles.
 * Such a directory gains what it does not have, and nothing else. A file
 * that is there is a file that the owner had the right to edit.
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

/**
 * Puts the build into the vault. If the copy in the vault matches the build,
 * the function does not touch that copy.
 */
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

/** The vault in the form that the report needs: every file, and the plugins. */
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
 * Every file under this directory, as relative paths with slashes.
 *
 * The walk notes a directory that it cannot read, and then steps over it.
 * The report is the last work of the run and the least important work. One
 * unreadable folder must not throw the report away. Such a throw would lose
 * the path, the link, and the state of the probe. It would lose them over a
 * directory that the owner may not even want to keep.
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
 * The plugin ids that the list of the vault enables. The function reports an
 * absent list, or a list that holds something other than ids, as no list at
 * all. That result reads differently from a list that enables no plugin.
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
 * Whether a command with this name is on the path. The function does not run
 * the command. The command must be a file, and the file must be executable.
 * A directory with that name is not a command. A file that nobody can run is
 * not a command. An offer of one of these would give the owner a line that
 * fails when the owner pastes it.
 */
function onPath(command) {
	const paths = (process.env['PATH'] ?? '').split(delimiter);
	return paths.some((entry) => {
		if (entry === '') {
			return false;
		}
		const candidate = join(entry, command);
		try {
			// statSync follows a symlink, so a dangling symlink is not a command.
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

/** Writes the file when no file is there, and says whether it wrote. */
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
