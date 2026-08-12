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
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	checkName,
	classifyInstall,
	generateName,
	summarizeVault,
} from './vault-core.ts';
import { HELP, PROBE_ID, formatOutcome, vaultReadme } from './vault-text.ts';

/** The vault's configuration folder, under the name Obsidian defaults to. */
const CONFIG_FOLDER = '.obsidian';
const VAULTS_FOLDER = '.vaults';
/** The pair a vault's plugin folder wants, as the probe build names them. */
const PROBE_FILES = ['main.js', 'manifest.json'];

try {
	main();
} catch (error) {
	console.error(`vault: ${said(error)}`);
	if (process.env['DEBUG'] !== undefined && error instanceof Error) {
		console.error(error.stack);
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
	const created = !existsSync(path);

	console.log('Building the probe...');
	const fresh = buildProbe(root);

	if (created) {
		layOutVault(path, name);
	}
	const install = installProbe(path, fresh);

	console.log('');
	console.log(
		formatOutcome({
			name,
			path,
			created,
			install,
			report: summarizeVault(scanVault(path)),
			cliFound: onPath('obsidian'),
		}),
	);
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
 * saying what the vault is for.
 *
 * Every write here is made only where there is no file already, so running
 * against a vault that exists leaves its settings and notes as they are.
 */
function layOutVault(path, name) {
	mkdirSync(join(path, CONFIG_FOLDER), { recursive: true });
	writeIfAbsent(join(path, CONFIG_FOLDER, 'app.json'), '{}\n');
	writeIfAbsent(
		join(path, CONFIG_FOLDER, 'community-plugins.json'),
		`${JSON.stringify([PROBE_ID], null, '\t')}\n`,
	);
	writeIfAbsent(join(path, 'README.md'), vaultReadme(name));
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
	return {
		files: walk(path, ''),
		installedPlugins: folderNames(join(path, CONFIG_FOLDER, 'plugins')),
		enabledPlugins: enabledPlugins(path),
	};
}

/** Every file under this directory, as slash-separated relative paths. */
function walk(directory, prefix) {
	const found = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
		if (entry.isDirectory()) {
			found.push(...walk(join(directory, entry.name), relative));
		} else if (entry.isFile()) {
			found.push(relative);
		}
	}
	return found;
}

function folderNames(directory) {
	if (!existsSync(directory)) {
		return [];
	}
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);
}

/**
 * The plugin ids the vault's own list enables. A list that is missing or
 * that holds something other than ids is reported as no list at all, which
 * reads differently from a list enabling nothing.
 */
function enabledPlugins(path) {
	const file = join(path, CONFIG_FOLDER, 'community-plugins.json');
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

/** Whether a command of this name is on the path, without running it. */
function onPath(command) {
	const paths = (process.env['PATH'] ?? '').split(delimiter);
	return paths.some(
		(entry) => entry !== '' && existsSync(join(entry, command)),
	);
}

function writeIfAbsent(file, contents) {
	if (!existsSync(file)) {
		writeFileSync(file, contents);
	}
}

function said(error) {
	return error instanceof Error ? error.message : 'no reason given';
}
