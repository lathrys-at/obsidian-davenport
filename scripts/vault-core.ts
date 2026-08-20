/**
 * The decisions behind the QA vault script:
 *
 * - what name a vault can have;
 * - how a vault without a name gets one;
 * - whether the probe in a vault still matches the build beside it;
 * - whether an exit status of the probe build came from the build or from
 *   the host;
 * - what a walked vault adds up to.
 *
 * No function here reads a file, draws its own randomness, or reads a clock.
 * Therefore a test can exercise every decision directly. `vault.mjs` walks
 * the tree, runs the build, and copies the files. `vault-text.ts` holds the
 * wording that the script prints around these answers.
 *
 * The probe owns the folder that it writes into and the names of its files.
 * Therefore this module takes both from the results module of the probe.
 * This module does not write them down again, and the two cannot drift
 * apart.
 */

import {
	PROBE_FOLDER,
	RESULTS_NAME,
} from '../tools/frontmatter-probe/results.ts';

export { PROBE_FOLDER };

/** The longest name that is worth typing. Three words fit easily in it. */
export const NAME_LIMIT = 64;

/**
 * A name that passed the check, or the reason for the refusal.
 *
 * The character rule keeps a name inside `.vaults/`. The alphabet has no dot
 * and no slash. Therefore a name cannot point to a directory above
 * `.vaults/`.
 */
export type NameCheck =
	| { readonly ok: true; readonly name: string }
	| { readonly ok: false; readonly reason: string };

/** Whether a vault can have this name, and if not, the reason. */
export function checkName(raw: string): NameCheck {
	if (raw === '') {
		return { ok: false, reason: 'a vault name cannot be empty' };
	}
	if (raw.length > NAME_LIMIT) {
		return {
			ok: false,
			reason: `a vault name has ${String(NAME_LIMIT)} characters at most, and that name has ${String(raw.length)}`,
		};
	}
	const offenders = [...new Set(raw)].filter(
		(character) => !/[a-z0-9-]/.test(character),
	);
	if (offenders.length > 0) {
		return {
			ok: false,
			reason:
				'a vault name uses lowercase letters, digits and hyphens only, ' +
				`and that name has ${listPhrase(offenders.map(describeCharacter))}`,
		};
	}
	if (raw.startsWith('-') || raw.endsWith('-')) {
		return {
			ok: false,
			reason: 'a vault name starts and ends with a letter or a digit',
		};
	}
	return { ok: true, name: raw };
}

/**
 * A name of three words: two adjectives and a noun. The caller supplies the
 * randomness, so a test can select the words. The function draws the second
 * adjective from the words that the first draw left. Therefore a name never
 * repeats a word.
 */
export function generateName(random: () => number): string {
	const first = pickWord(ADJECTIVES, random);
	const second = pickWord(
		ADJECTIVES.filter((word) => word !== first),
		random,
	);
	return `${first}-${second}-${pickWord(NOUNS, random)}`;
}

/** Whether the copy in a vault is the same as the build beside it. */
export type InstallState = 'absent' | 'stale' | 'current';

export interface InstallVerdict {
	readonly state: InstallState;
	/** The files to write, with the names that the build gives them. */
	readonly toWrite: readonly string[];
}

/**
 * The function compares the installed copy against the fresh build, byte for
 * byte. An absent file counts as a file to write. Therefore a half-copied
 * install is stale and not current. A byte that differs gets the same
 * answer.
 */
export function classifyInstall(
	fresh: ReadonlyMap<string, Uint8Array>,
	installed: ReadonlyMap<string, Uint8Array>,
): InstallVerdict {
	const toWrite: string[] = [];
	let present = 0;
	for (const [name, bytes] of fresh) {
		const already = installed.get(name);
		if (already === undefined) {
			toWrite.push(name);
			continue;
		}
		present += 1;
		if (!sameBytes(already, bytes)) {
			toWrite.push(name);
		}
	}
	if (present === 0) {
		return { state: 'absent', toWrite };
	}
	return { state: toWrite.length > 0 ? 'stale' : 'current', toWrite };
}

/**
 * The status that Windows gives to a process that the host aborted. The
 * number is 0xC0000409.
 */
export const WINDOWS_ABORT_STATUS = 3221226505;

/**
 * Tells whether the host aborted a child that ended with this status. Only
 * Windows writes the abort status, so the answer on every other platform is
 * no.
 *
 * The build does not choose this status. A build that ends with this status
 * did not fail. A second run of the same command can pass.
 */
export function isWindowsAbort(
	status: number | null,
	platform: string,
): boolean {
	return platform === 'win32' && status === WINDOWS_ABORT_STATUS;
}

/**
 * A vault as the walk found it. The paths are relative to the vault, and
 * they use a slash as the separator.
 */
export interface VaultScan {
	readonly files: readonly string[];
	/** The plugin folders under the configuration directory of the vault. */
	readonly installedPlugins: readonly string[];
	/**
	 * The plugin ids that `community-plugins.json` lists. The value is null
	 * when the vault has no readable list. A vault with no readable list is
	 * not the same as a list that enables no plugin, and the report shows the
	 * difference.
	 */
	readonly enabledPlugins: readonly string[] | null;
	/**
	 * The directories that the walk could not read. A vault that the report
	 * cannot fully read is still a vault that is worth a report. Therefore the
	 * scan carries these directories through and names them. The scan does not
	 * throw an error.
	 */
	readonly unreadable: readonly string[];
}

export interface PluginEntry {
	readonly id: string;
	readonly enabled: boolean;
}

/** One results file that the probe wrote. */
export interface ResultsFile {
	readonly name: string;
	/** The instant in the name of the file, or null when the name has none. */
	readonly timestamp: string | null;
}

export interface VaultReport {
	/** Notes: the markdown files that a person put in the vault. */
	readonly markdownFiles: number;
	/** The other files in the vault that are not configuration. */
	readonly otherFiles: number;
	/** The files under the configuration folder. Nobody writes these by hand. */
	readonly configFiles: number;
	readonly plugins: readonly PluginEntry[];
	/** The ids that the list enables and that no installed folder supplies. */
	readonly enabledWithoutFolder: readonly string[];
	readonly results: readonly ResultsFile[];
	readonly unreadable: readonly string[];
}

/**
 * The configuration folder of the vault, with the name that Obsidian uses by
 * default.
 */
export const CONFIG_FOLDER = '.obsidian';

/**
 * What the walked vault adds up to, in the terms that the report states.
 *
 * The function counts the contents of the vault apart from the configuration
 * of the vault. The question "what shape is this vault in" asks how many
 * notes the vault holds. A count that adds the files of the plugin answers a
 * different question.
 */
export function summarizeVault(scan: VaultScan): VaultReport {
	const enabled = new Set(scan.enabledPlugins ?? []);
	const installed = [...scan.installedPlugins].sort();
	const configPrefix = `${CONFIG_FOLDER}/`;
	const content = scan.files.filter((path) => !path.startsWith(configPrefix));
	const markdown = content.filter((path) =>
		path.toLowerCase().endsWith('.md'),
	);
	return {
		markdownFiles: markdown.length,
		otherFiles: content.length - markdown.length,
		configFiles: scan.files.length - content.length,
		plugins: installed.map((id) => ({ id, enabled: enabled.has(id) })),
		enabledWithoutFolder: [...enabled]
			.filter((id) => !installed.includes(id))
			.sort(),
		results: readResultsFiles(scan.files),
		unreadable: [...scan.unreadable].sort(),
	};
}

/**
 * The results files of the probe, with the newest name first. The name of
 * each file holds the instant when that run finished. Therefore the listing
 * needs no clock and no stat call. The listing reads what the probe wrote in
 * the name.
 */
export function readResultsFiles(files: readonly string[]): ResultsFile[] {
	const prefix = `${PROBE_FOLDER}/`;
	return files
		.filter(
			(path) =>
				path.startsWith(prefix) &&
				!path.slice(prefix.length).includes('/') &&
				RESULTS_NAME.test(path.slice(prefix.length)),
		)
		.map((path) => path.slice(prefix.length))
		.sort((left, right) => right.localeCompare(left))
		.map((name) => ({ name, timestamp: readStamp(name) }));
}

/** The instant in the name of a results file, in a plain form. */
function readStamp(name: string): string | null {
	const match = RESULTS_NAME.exec(name);
	if (match === null) {
		return null;
	}
	const [, date, time] = match;
	if (date === undefined || time === undefined) {
		return null;
	}
	const day = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
	const hour = `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`;
	return `${day} ${hour}Z`;
}

/** Whether two sequences of bytes are the same. */
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((byte, index) => byte === right[index]);
}

/**
 * A word from the list. The function clamps the draw and does not trust it.
 * Therefore a source that answers exactly 1, or a value outside the unit
 * interval, still gives a word and not nothing.
 */
function pickWord(words: readonly string[], random: () => number): string {
	const drawn = random();
	const index = Number.isFinite(drawn)
		? Math.min(
				words.length - 1,
				Math.max(0, Math.floor(drawn * words.length)),
			)
		: 0;
	const word = words[index];
	if (word === undefined) {
		throw new Error('the word list is empty');
	}
	return word;
}

/**
 * A character in a form that a person can read aloud. This includes the
 * characters that are invisible.
 */
function describeCharacter(character: string): string {
	if (/\s/.test(character)) {
		return 'a space';
	}
	return `"${character}"`;
}

/** Items as a list in text: one, two and three. */
export function listPhrase(items: readonly string[]): string {
	if (items.length <= 1) {
		return items.join('');
	}
	const last = items[items.length - 1];
	return `${items.slice(0, -1).join(', ')} and ${last ?? ''}`;
}

/**
 * The words that make a generated name. The words must be pleasant to read
 * and to say over a desk. A name from this list goes into a window title,
 * into a path, and into the notes where the owner writes a result.
 */
const ADJECTIVES = words(`
	amber azure brisk calm candid clear coastal copper crisp deft distant
	early even fair fleet fresh gentle gilded golden hushed keen level lucid
	mellow mild modest northern open patient placid polished quiet russet
	sage settled silver slate smooth steady still sunlit tidy tranquil upland
	warm western winter
`);

const NOUNS = words(`
	anchor atlas beacon canyon cedar compass cove delta ember fjord garden
	glacier grove harbor haven hollow isle juniper lagoon lantern ledge
	ledger lighthouse maple meadow mesa orchard pine prairie quarry quill
	ridge river summit terrace thicket valley willow
`);

/** A block of written-out words, as the list of those words. */
function words(block: string): readonly string[] {
	return block.trim().split(/\s+/);
}
