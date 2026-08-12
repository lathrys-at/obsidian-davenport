/**
 * The decisions behind the QA vault script: what a vault may be called, how
 * an unnamed one gets a name, whether the probe sitting in a vault still
 * matches the build beside it, and what a walked vault adds up to.
 *
 * Nothing here reads a file, draws its own randomness or reads a clock, so
 * every decision can be put under test directly. Walking the tree, running
 * the build and copying files belong to `vault.mjs`; the wording printed
 * around these answers is in `vault-text.ts`.
 *
 * Where the probe writes and what it calls its files are the probe's own
 * business, so they are taken from its results module rather than written
 * down again here, and cannot drift from it.
 */

import { PROBE_FOLDER, RESULTS_NAME } from '../tools/a11-probe/results.ts';

export { PROBE_FOLDER };

/** The longest name worth typing, with room to spare for three words. */
export const NAME_LIMIT = 64;

/**
 * A checked name, or the reason it was refused.
 *
 * The character rule is what keeps a name inside `.vaults/`: with no dot
 * and no slash in the alphabet, a name cannot name a directory above it.
 */
export type NameCheck =
	| { readonly ok: true; readonly name: string }
	| { readonly ok: false; readonly reason: string };

/** Whether this is a name a vault may be given, and if not, why not. */
export function checkName(raw: string): NameCheck {
	if (raw === '') {
		return { ok: false, reason: 'a vault name cannot be empty' };
	}
	if (raw.length > NAME_LIMIT) {
		return {
			ok: false,
			reason: `a vault name runs to ${String(NAME_LIMIT)} characters at most, and that one is ${String(raw.length)}`,
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
				`and that one has ${listPhrase(offenders.map(describeCharacter))}`,
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
 * A three-word name, drawn from the caller's randomness so that a test can
 * say which words it wants. Two adjectives and a noun, and the second
 * adjective is drawn from the words the first one left, so no name repeats
 * a word back at itself.
 */
export function generateName(random: () => number): string {
	const first = pickWord(ADJECTIVES, random);
	const second = pickWord(
		ADJECTIVES.filter((word) => word !== first),
		random,
	);
	return `${first}-${second}-${pickWord(NOUNS, random)}`;
}

/** Whether the copy installed in a vault is the build sitting beside it. */
export type InstallState = 'absent' | 'stale' | 'current';

export interface InstallVerdict {
	readonly state: InstallState;
	/** The files to write, named as the build names them. */
	readonly toWrite: readonly string[];
}

/**
 * The installed copy weighed against the fresh build, byte for byte. A
 * missing file counts as one to write, so a half-copied install is stale
 * rather than current — the same answer a differing byte gets.
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

/** A vault as the walk found it, in vault-relative slash-separated paths. */
export interface VaultScan {
	readonly files: readonly string[];
	/** The plugin folders under the vault's configuration directory. */
	readonly installedPlugins: readonly string[];
	/**
	 * The plugin ids `community-plugins.json` lists, or null when the vault
	 * has no readable list — which is not the same as a list enabling
	 * nothing, and is reported differently.
	 */
	readonly enabledPlugins: readonly string[] | null;
	/**
	 * Directories the walk was refused. A vault the report cannot read all
	 * of is still a vault worth reporting, so these are carried through and
	 * named rather than thrown.
	 */
	readonly unreadable: readonly string[];
}

export interface PluginEntry {
	readonly id: string;
	readonly enabled: boolean;
}

/** One results file the probe left behind. */
export interface ResultsFile {
	readonly name: string;
	/** The instant in the file's own name, or null when it carries none. */
	readonly timestamp: string | null;
}

export interface VaultReport {
	/** Notes: the markdown a person put in the vault. */
	readonly markdownFiles: number;
	/** Anything else in the vault that is not configuration. */
	readonly otherFiles: number;
	/** Files under the configuration folder, which nobody writes by hand. */
	readonly configFiles: number;
	readonly plugins: readonly PluginEntry[];
	/** Ids the list enables that no installed folder answers for. */
	readonly enabledWithoutFolder: readonly string[];
	readonly results: readonly ResultsFile[];
	readonly unreadable: readonly string[];
}

/** The vault's configuration folder, under the name Obsidian defaults to. */
export const CONFIG_FOLDER = '.obsidian';

/**
 * What the walked vault amounts to, in the terms the report states.
 *
 * The vault's own contents are counted apart from its configuration. Asked
 * what shape a vault is in, what is wanted is how many notes are in it, and
 * a count that folds in the plugin's own files answers a different question.
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
 * The probe's results files, newest name first. The instant a run finished
 * is in the file's own name, so the listing needs no clock and no stat: it
 * reads what the probe wrote there.
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

/** The instant in a results file's name, read back as a plain one. */
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

/** Whether two runs of bytes are the same run of bytes. */
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((byte, index) => byte === right[index]);
}

/**
 * A word from the list. The draw is clamped rather than trusted, so a
 * source returning exactly 1, or anything outside the unit interval, still
 * names a word instead of nothing.
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

/** A character named so it can be read aloud, including the invisible ones. */
function describeCharacter(character: string): string {
	if (/\s/.test(character)) {
		return 'a space';
	}
	return `"${character}"`;
}

/** Items said as a list: one, two and three. */
export function listPhrase(items: readonly string[]): string {
	if (items.length <= 1) {
		return items.join('');
	}
	const last = items[items.length - 1];
	return `${items.slice(0, -1).join(', ')} and ${last ?? ''}`;
}

/**
 * The words a generated name is built from. They are meant to be pleasant
 * to read and to say over a desk, since a name from here ends up in a
 * window title, a path, and whatever the owner writes a result down in.
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

/** A written-out block of words as the list it reads as. */
function words(block: string): readonly string[] {
	return block.trim().split(/\s+/);
}
