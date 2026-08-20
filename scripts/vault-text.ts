/**
 * This module holds all the text that the QA vault script prints. It also
 * holds the note that the script leaves in the vault for the person who
 * opens the vault.
 *
 * The wording is the reason for a separate module. The wording is the whole
 * interface of the script. Therefore this module builds the text from
 * values, and the script does not print the text as the script runs. A test
 * can read back every line.
 */

import type { InstallVerdict, VaultReport } from './vault-core.ts';
import {
	CONFIG_FOLDER,
	PROBE_FOLDER,
	WINDOWS_ABORT_STATUS,
	isWindowsAbort,
	listPhrase,
} from './vault-core.ts';

/**
 * The identifier of the probe. The script uses this value as the name of
 * the plugin folder. The script also writes this value into the list of
 * enabled plugins. Therefore this value must be equal to the identifier in
 * the manifest of the probe.
 */
export const PROBE_ID = 'davenport-frontmatter-probe';

/** The name that the probe shows in the list of installed plugins. */
const PROBE_NAME = 'Davenport frontmatter probe';

export const HELP = `This script makes a scratch Obsidian vault with the frontmatter probe
installed.

  npm run vault              makes a vault with a random three-word name
  npm run vault -- <name>    makes a vault with that name, or reports on it
  npm run vault -- --help    prints this text

The script makes each vault in .vaults/ at the top of the repository. Git
ignores that directory. A name uses lowercase letters, digits and hyphens
only.

If you name a vault that already exists, the script keeps the contents of
that vault. The script builds the probe on each run. If the copy of the
probe in the vault is out of date, the script writes the new copy. The
script then reports on the vault, and does not replace it.`;

/** What one run of the script did, in the terms that the output uses. */
export interface Outcome {
	readonly name: string;
	/** The absolute path of the vault. Obsidian receives this path. */
	readonly path: string;
	/** False when the vault already existed and the script only reported it. */
	readonly created: boolean;
	/**
	 * The configuration files that this run wrote. On a new vault, this is
	 * every configuration file. On a vault that already existed, this is only
	 * the files that were absent.
	 */
	readonly laidOut: readonly string[];
	readonly install: InstallVerdict;
	readonly report: VaultReport;
	/** True when the script found an `obsidian` command on the path. */
	readonly cliFound: boolean;
}

/**
 * Whether this run made the vault ready to open. This run can write the
 * plugin list into a vault that already existed. Then nobody opened that
 * vault with the probe in the list before, whatever else the folder held.
 * Such a vault needs the first-open steps, the same as a new vault.
 */
function firstOpen(outcome: Outcome): boolean {
	return (
		outcome.created ||
		outcome.laidOut.some((file) => file.endsWith(`/${PLUGIN_LIST}`))
	);
}

/** The file in the configuration of a vault that names the plugins to load. */
export const PLUGIN_LIST = 'community-plugins.json';

/**
 * What the script says when the probe build did not end with the status 0.
 * The message states what happened to the build, and each cause gets its own
 * words.
 *
 * A host can abort a process. The host then gives the process a status that
 * the process did not choose. That status is not the answer of the build.
 * The message therefore names the abort. The message also asks the reader to
 * run the command again.
 *
 * A signal can stop a process before the process writes a status. The build
 * then wrote no status, and the message says that.
 *
 * Every other status is the answer of the build. The message names that
 * status, and the script prints the output of the build above the message.
 */
export function probeBuildFailure(
	status: number | null,
	platform: string,
): string {
	if (isWindowsAbort(status, platform)) {
		return (
			`the host aborted the probe build with the status ` +
			`${String(WINDOWS_ABORT_STATUS)} (0xC0000409). The build did not ` +
			`write this status, and the build did not fail. Run the command ` +
			`one more time.`
		);
	}
	if (status === null) {
		return (
			'a signal stopped the probe build before the build wrote a ' +
			'status, and the output of the build is above'
		);
	}
	return (
		`the probe build failed with the status ${String(status)}, and the ` +
		`output of the build is above`
	);
}

/** All the text that a successful run prints. */
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
 * The link that opens a vault again. Obsidian finds the most specific vault
 * that contains the path. The code must encode every value in the link, and this
 * includes the separators.
 */
export function vaultUri(absolutePath: string): string {
	return `obsidian://open?path=${encodeURIComponent(absolutePath)}`;
}

/** The note at the top of the vault. The owner reads it inside Obsidian. */
export function vaultReadme(name: string): string {
	return `# Davenport QA vault

This is \`${name}\`, a scratch vault for the frontmatter probe. The data in
this vault is not important. Delete the whole folder when you no longer
need it.

## The command to run

1. Open the command palette with **Cmd+P**.
2. Run the command **Run frontmatter probe**.

Each run writes one file into \`${PROBE_FOLDER}/\`. The file has the name
\`emission-samples-<timestamp>Z.json\`. The run also writes notes through the
frontmatter writer into the same folder. Copy those files back to the
repository. Then compare the runs from two devices with this command:

\`\`\`bash
node tools/frontmatter-probe/compare.mjs <one file> <another file>
\`\`\`

## If the command is not in the palette

The plugin is installed, but it does not run yet. Do these steps:

1. Open **Settings → Community plugins**.
2. Turn off restricted mode.
3. Enable **${PROBE_NAME}**.
`;
}

function heading(outcome: Outcome): string {
	const what = outcome.created
		? `The script made the vault ${outcome.name}`
		: `The vault ${outcome.name} already exists`;
	return `${what}\n${outcome.path}`;
}

/** The state of the vault, as a block of labelled lines. */
function summaryLines(outcome: Outcome): string[] {
	const { report } = outcome;
	// A row can have more than one line. The lines after the first line get a
	// blank label column. Thus a long row stays one row to the eye, and the
	// next label starts a new row.
	const rows: [string, string[]][] = [
		['Probe', [describeInstall(outcome.install)]],
	];
	// On a new vault, this run wrote all of the configuration, and a list of
	// those files adds nothing. On a vault that already existed, this run made
	// a repair, and the owner must know which files were absent.
	if (!outcome.created && outcome.laidOut.length > 0) {
		rows.push(['Added', [listPhrase(outcome.laidOut)]]);
	}
	rows.push(
		['Contents', [describeContents(report)]],
		['Plugins', [describePlugins(report)]],
	);
	const results = report.results.map(
		(file) =>
			`${file.name}${file.timestamp === null ? '' : ` (${file.timestamp})`}`,
	);
	rows.push(['Probe results', results.length > 0 ? results : ['none yet']]);
	if (report.unreadable.length > 0) {
		rows.push(['Could not read', [...report.unreadable]]);
	}
	return rows.flatMap(([label, values]) =>
		values.map(
			(value, index) =>
				`  ${(index === 0 ? label : '').padEnd(15)}${value}`,
		),
	);
}

/**
 * What the vault holds. This count keeps the contents of the vault apart
 * from the machinery that runs the vault. The number of notes answers the
 * question "what shape is this vault in". The configuration is machinery. A
 * count that adds the two together answers neither question.
 */
function describeContents(report: VaultReport): string {
	const notes = `${String(report.markdownFiles)} ${
		report.markdownFiles === 1 ? 'note' : 'notes'
	}`;
	const other =
		report.otherFiles > 0 ? `, ${String(report.otherFiles)} other` : '';
	return `${notes}${other} and ${String(report.configFiles)} files under ${CONFIG_FOLDER}`;
}

function describeInstall(install: InstallVerdict): string {
	const written = listPhrase(install.toWrite);
	if (install.state === 'absent') {
		return `installed, and the script wrote ${written}`;
	}
	if (install.state === 'stale') {
		return `refreshed, and the script rewrote ${written}`;
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
 * How to open the vault. Obsidian answers its own link only for the vaults
 * that it recorded before. Thus the owner must open a new vault by hand one
 * time. The link works only after that first open. These lines say so for
 * two reasons. No script can do that step, and a person who must find the
 * step again loses an afternoon.
 *
 * The link is the whole of the opening procedure. The command line of
 * Obsidian takes a vault by name and not by path. For a vault that it has no
 * record of, the command line answers `Vault not found`. Therefore the
 * command line cannot do the first open. The lines below offer the command
 * line only for the checks that it does well.
 *
 * The script prints the link inside single quotes. The encoding keeps `!` as
 * it is. Inside double quotes, an interactive shell reads `!` as a history
 * expansion and refuses the line. Then a checkout with `!` in its path would
 * give the owner a command that nobody can paste.
 */
function openingLines(outcome: Outcome): string[] {
	const reopen = [`    open '${vaultUri(outcome.path)}'`];
	const checking = outcome.cliFound
		? [
				'',
				'  After you open the vault, this command lists the enabled plugins:',
				'',
				`    obsidian vault=${outcome.name} plugins`,
			]
		: [];
	if (!firstOpen(outcome)) {
		return [
			'Open the vault in Obsidian',
			'',
			...reopen,
			'',
			'  If Obsidian tells you that it cannot find a vault for that link,',
			'  then Obsidian did not open this folder before. Do these steps:',
			'',
			'  1. In Obsidian, select the vault switcher at the bottom left.',
			'  2. Select Open folder as vault.',
			'  3. Select the folder from the path above.',
			...checking,
		];
	}
	return [
		'Open the vault in Obsidian',
		'',
		'  Obsidian opens only the vaults that it has a record of. If this vault',
		'  is new to Obsidian, then you must open it by hand one time:',
		'',
		'  1. In Obsidian, select the vault switcher at the bottom left.',
		'  2. Select Open folder as vault.',
		'  3. Select this folder:',
		'',
		`    ${outcome.path}`,
		'',
		'  After that, this command opens the vault again:',
		'',
		...reopen,
		'',
		'  Then turn on the probe:',
		'',
		'  1. Open Settings → Community plugins.',
		'  2. Turn off restricted mode.',
		`  3. Make sure that ${PROBE_NAME} is enabled.`,
		'',
		'  The vault already lists the probe. Usually you only have to turn off',
		'  restricted mode. Obsidian asks for this confirmation one time for each',
		'  vault, and no script can answer the confirmation for you.',
		...checking,
	];
}

function runningLines(): string[] {
	return [
		'Run the probe',
		'',
		'  1. Open the command palette with Cmd+P.',
		'  2. Run the command Run frontmatter probe.',
		'',
		`  Each run writes one file in ${PROBE_FOLDER}/ inside the vault. To`,
		'  compare the files from two devices, use tools/frontmatter-probe/compare.mjs.',
	];
}
