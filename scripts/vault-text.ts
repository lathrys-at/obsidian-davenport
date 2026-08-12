/**
 * Everything the QA vault script prints, and the note it leaves inside the
 * vault for whoever opens it.
 *
 * The wording is the reason this is a separate module: it is the whole
 * interface of the script, so it is assembled from values rather than
 * printed as it goes, and every line of it can be read back in a test.
 */

import type { InstallVerdict, VaultReport } from './vault-core.ts';
import { RESULTS_FOLDER, listPhrase } from './vault-core.ts';

/** The plugin folder the probe is installed as, which is not negotiable. */
export const PROBE_ID = 'davenport-a11-probe';

/** The name the probe shows under installed plugins. */
const PROBE_NAME = 'Davenport frontmatter probe';

export const HELP = `Creates a scratch Obsidian vault with the frontmatter probe installed.

  npm run vault              a new vault under a random three-word name
  npm run vault -- <name>    a new vault under that name, or a report on it
  npm run vault -- --help    this

Vaults live in .vaults/ at the top of the repository, which git ignores. A
name is lowercase letters, digits and hyphens.

Naming a vault that already exists changes nothing in it: the probe is
rebuilt and refreshed if the vault's copy has fallen behind, and the vault
is reported rather than replaced.`;

/** What one run of the script did, in the terms its output is built from. */
export interface Outcome {
	readonly name: string;
	/** The vault's absolute path, which is what Obsidian is handed. */
	readonly path: string;
	/** False when the vault was already there and was reported instead. */
	readonly created: boolean;
	readonly install: InstallVerdict;
	readonly report: VaultReport;
	/** Whether an `obsidian` command was found on the path. */
	readonly cliFound: boolean;
}

/** The whole of what a successful run prints. */
export function formatOutcome(outcome: Outcome): string {
	return [
		heading(outcome),
		'',
		...summaryLines(outcome),
		'',
		...openingLines(outcome),
		'',
		...runningLines(),
	].join('\n');
}

/**
 * The link that reopens a vault. Obsidian resolves the most specific vault
 * containing the path, and asks for every value in it to be encoded, down
 * to the separators.
 */
export function vaultUri(absolutePath: string): string {
	return `obsidian://open?path=${encodeURIComponent(absolutePath)}`;
}

/** The note left at the top of the vault, read from inside Obsidian. */
export function vaultReadme(name: string): string {
	return `# Davenport QA vault

This is \`${name}\`, a scratch vault for the frontmatter probe. Nothing in here
is precious. Delete the whole folder when you are done with it.

## The one command

Open the command palette with **Cmd+P** and run **Run frontmatter probe**.

Each run writes one file into \`${RESULTS_FOLDER}/\`, named
\`emission-samples-<timestamp>Z.json\`, alongside the notes it wrote through
the frontmatter writer. Carry those files back to the repository and compare
the runs from two devices:

\`\`\`bash
node tools/a11-probe/compare.mjs <one file> <another file>
\`\`\`

## If the command is not in the palette

The plugin is installed but not yet running. Open
**Settings → Community plugins**, turn off restricted mode, and enable
**${PROBE_NAME}**.
`;
}

function heading(outcome: Outcome): string {
	const what = outcome.created
		? `Created the vault ${outcome.name}`
		: `The vault ${outcome.name} is already there`;
	return `${what}\n${outcome.path}`;
}

/** The state of the vault, as a block of labelled lines. */
function summaryLines(outcome: Outcome): string[] {
	const { report } = outcome;
	const rows: [string, string][] = [
		['Probe', describeInstall(outcome.install)],
		[
			'Files',
			`${String(report.totalFiles)} in all, ${String(report.markdownFiles)} markdown`,
		],
		['Plugins', describePlugins(report)],
	];
	const results = report.results.map(
		(file) =>
			`${file.name}${file.timestamp === null ? '' : ` (${file.timestamp})`}`,
	);
	rows.push(['Probe results', results[0] ?? 'none yet']);
	const lines = rows.map(([label, value]) => `  ${label.padEnd(15)}${value}`);
	// Further results files hang under the first, so the column holds.
	return [
		...lines,
		...results.slice(1).map((file) => `  ${''.padEnd(15)}${file}`),
	];
}

function describeInstall(install: InstallVerdict): string {
	const written = listPhrase(install.toWrite);
	if (install.state === 'absent') {
		return `installed, ${written}`;
	}
	if (install.state === 'stale') {
		return `refreshed, ${written} rewritten`;
	}
	return 'already current';
}

function describePlugins(report: VaultReport): string {
	if (report.plugins.length === 0) {
		return 'none installed';
	}
	const installed = report.plugins.map(
		(plugin) =>
			`${plugin.id} (${plugin.enabled ? 'enabled' : 'not enabled'})`,
	);
	const orphans = report.enabledWithoutFolder.map(
		(id) => `${id} (enabled, but not installed)`,
	);
	return [...installed, ...orphans].join(', ');
}

/**
 * How to get the vault open. Obsidian answers its own link only for vaults
 * it has already recorded, so a vault this script has just made has to be
 * opened by hand once before the link means anything. Saying so here is the
 * point: it is the step that cannot be automated away, and the one that
 * wastes an afternoon when it is left to be rediscovered.
 *
 * The link is the whole of the opening. Obsidian's own command line takes a
 * vault by name rather than by path and answers `Vault not found` for one
 * it has no record of, so it cannot do this first open either, and it is
 * offered below only for the checking it is good at.
 */
function openingLines(outcome: Outcome): string[] {
	const reopen = [`    open "${vaultUri(outcome.path)}"`];
	const checking = outcome.cliFound
		? [
				'',
				'  Once it has been opened, this says what the vault has enabled:',
				'',
				`    obsidian vault=${outcome.name} plugins`,
			]
		: [];
	if (!outcome.created) {
		return [
			'Open it in Obsidian',
			'',
			...reopen,
			'',
			'  If Obsidian answers that it cannot find a vault for that link, it has',
			'  not opened this folder yet. Use the vault switcher at the bottom left,',
			'  then Open folder as vault, and choose the folder above.',
			...checking,
		];
	}
	return [
		'Open it in Obsidian',
		'',
		'  Obsidian opens the vaults it already knows, and it does not know this one',
		'  yet, so the first open is by hand. In Obsidian, select the vault switcher',
		'  at the bottom left, then Open folder as vault, and choose:',
		'',
		`    ${outcome.path}`,
		'',
		'  After that, this reopens it:',
		'',
		...reopen,
		'',
		'  Then turn the probe on: Settings → Community plugins, turn off restricted',
		`  mode, and check that ${PROBE_NAME} is enabled. The vault`,
		'  already lists it, so leaving restricted mode is usually all it takes. That',
		'  confirmation is asked once per vault and no script can answer it for you.',
		...checking,
	];
}

function runningLines(): string[] {
	return [
		'Run the probe',
		'',
		'  Open the command palette with Cmd+P and run Run frontmatter probe.',
		`  Every run leaves a file in ${RESULTS_FOLDER}/ inside the vault. Compare`,
		'  the files from two devices with tools/a11-probe/compare.mjs.',
	];
}
