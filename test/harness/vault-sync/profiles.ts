/**
 * A sync profile holds the behavior of one sync tool. Each profile
 * answers seven questions about that tool:
 *
 * - How does the tool name a conflict copy?
 * - Which side of a divergence does the tool keep at the path?
 * - What does the tool do with the other side?
 * - How does the tool merge?
 * - Do the conflict copies of the tool reach the other devices?
 * - How does the tool deliver a rename?
 * - Does the tool keep the modification time of a file?
 *
 * The entries below are placeholders. Each value is a shape that a real
 * tool could have, and not behavior that somebody observed. The fact
 * recorded against the real tool replaces each value, and the profile
 * interface stays the same. Thus a suite written now still works when
 * the corpus holds real behavior. For this reason every fact that a
 * recording will carry has a member here, even where the placeholder for
 * that fact is the default of the channel.
 */

import type { MergeMangler } from './mangle';
import type { ContentStamp, DeviceId } from './types';

/**
 * What a tool does with the side of a divergence that the tool does not
 * keep at the path.
 */
export type DivergentDelivery = 'overwrite' | 'conflict-copy' | 'merge';

/**
 * Which side of a divergence a tool keeps at the path.
 *
 * Every tool in the corpus models `newest`. This rule ranks the two
 * contents by the time that somebody wrote each content, and the later
 * content wins. Both devices rank the same pair in the same order, so
 * both devices keep the same content, and both devices hold the same
 * bytes at the path.
 *
 * The rules `incoming` and `local` are one-sided, and read no stamp.
 * Under `incoming` each of the two devices takes the content that the
 * other device wrote. Under `local` each device keeps its own content.
 * Neither rule makes the two devices hold the same bytes.
 */
export type DivergenceWinner = 'newest' | 'incoming' | 'local';

/** How a rename arrives: whole, or as a deletion and a creation. */
export type RenameDelivery = 'rename' | 'delete-and-create';

export interface SyncToolProfile {
	readonly id: string;
	/**
	 * The filename pattern for the copy that holds the content of the
	 * losing side. Null for a tool that makes no copies. The pattern can
	 * hold these placeholders: `{dir}`, `{stem}`, `{ext}`, `{device}`,
	 * `{timestamp}`, and `{counter}`.
	 */
	readonly conflictCopyPattern: string | null;
	readonly divergenceWinner: DivergenceWinner;
	readonly divergentDelivery: DivergentDelivery;
	/**
	 * How this tool merges, for a profile that merges. A merger in the
	 * options of the channel replaces this merger. The modeled line merge
	 * stands in when the options and the profile give no merger. Thus the
	 * merge recorded against a real tool comes here, and no call site
	 * changes.
	 */
	readonly merger?: MergeMangler;
	/**
	 * True when a conflict copy reaches the other devices of the tool.
	 * False leaves the copy on the device that made the copy, and every
	 * entry below carries false as its placeholder. Under either value a
	 * device that sees both sides of a divergence makes the copy itself.
	 * Therefore this member decides only what a device gets when that
	 * device never sees one of the two sides.
	 */
	readonly propagateConflictCopies: boolean;
	readonly renameDelivery: RenameDelivery;
	readonly preserveModificationTimes: boolean;
}

export const SYNC_TOOL_PROFILES: readonly SyncToolProfile[] = [
	{
		id: 'obsidian-sync',
		conflictCopyPattern: '{dir}{stem} (conflicted copy {timestamp}){ext}',
		divergenceWinner: 'newest',
		divergentDelivery: 'merge',
		propagateConflictCopies: false,
		renameDelivery: 'rename',
		preserveModificationTimes: false,
	},
	{
		id: 'syncthing',
		conflictCopyPattern:
			'{dir}{stem}.sync-conflict-{timestamp}-{device}{ext}',
		divergenceWinner: 'newest',
		divergentDelivery: 'conflict-copy',
		propagateConflictCopies: false,
		renameDelivery: 'delete-and-create',
		preserveModificationTimes: true,
	},
	{
		id: 'icloud-drive',
		conflictCopyPattern: '{dir}{stem} {counter}{ext}',
		divergenceWinner: 'newest',
		divergentDelivery: 'conflict-copy',
		propagateConflictCopies: false,
		renameDelivery: 'delete-and-create',
		preserveModificationTimes: false,
	},
	{
		id: 'git',
		conflictCopyPattern: null,
		divergenceWinner: 'newest',
		divergentDelivery: 'merge',
		propagateConflictCopies: false,
		renameDelivery: 'rename',
		preserveModificationTimes: false,
	},
];

/** The profile that a channel uses when the caller names no profile. */
export const DEFAULT_SYNC_PROFILE: SyncToolProfile = {
	id: 'default',
	conflictCopyPattern: '{dir}{stem} (conflict {counter}){ext}',
	divergenceWinner: 'newest',
	divergentDelivery: 'conflict-copy',
	propagateConflictCopies: false,
	renameDelivery: 'rename',
	preserveModificationTimes: false,
};

/**
 * The profile with this id. Throws an error that names the known ids
 * when the corpus holds no profile with this id.
 */
export function syncToolProfile(id: string): SyncToolProfile {
	const found = SYNC_TOOL_PROFILES.find((profile) => profile.id === id);
	if (found === undefined) {
		const known = SYNC_TOOL_PROFILES.map((profile) => profile.id).join(
			', ',
		);
		throw new Error(
			`sync tool profile: there is no profile ${id}; the corpus holds ${known}`,
		);
	}
	return found;
}

/**
 * True when the content of the delivery takes the path. The rule
 * `newest` ranks the two sides by the time that somebody wrote each
 * side, and gives a tie to the earlier author id. Both devices in a
 * divergence hold the same pair of stamps, so both devices get the same
 * answer from opposite sides. For this reason the two devices agree on
 * the content at the path, and put the same content in the copy.
 */
export function incomingWins(
	rule: DivergenceWinner,
	incoming: ContentStamp,
	local: ContentStamp,
): boolean {
	switch (rule) {
		case 'incoming':
			return true;
		case 'local':
			return false;
		case 'newest':
			return incoming.at === local.at
				? incoming.author < local.author
				: incoming.at > local.at;
	}
}

export interface ConflictCopyContext {
	/** The path whose losing content the channel moves aside. */
	readonly path: string;
	/**
	 * The device that wrote the content that the channel moves aside.
	 * Every device that resolves one divergence names the copy after the
	 * same losing device. Thus the copy is one file with one name across
	 * the vault, and not a different file on each device.
	 */
	readonly device: DeviceId;
	/**
	 * The modification time of the content that the channel moves aside.
	 * A tool names its copies after this time, and the copy keeps this
	 * time.
	 */
	readonly at: number;
	/**
	 * Fills `{counter}`. The first try uses 2, because a tool numbers its
	 * copies from 2.
	 */
	readonly counter: number;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Fills a conflict-copy pattern. An unknown placeholder throws an error,
 * and the function does not keep the placeholder as literal text. Thus a
 * typo in a corpus entry fails at the entry, and does not make a filename
 * that nothing matches.
 */
export function renderConflictPath(
	pattern: string,
	context: ConflictCopyContext,
): string {
	const parts = splitPath(context.path);
	return pattern.replace(PLACEHOLDER, (_match, name: string) => {
		switch (name) {
			case 'dir':
				return parts.dir;
			case 'stem':
				return parts.stem;
			case 'ext':
				return parts.ext;
			case 'device':
				return context.device;
			case 'timestamp':
				return formatTimestamp(context.at);
			case 'counter':
				return String(context.counter);
			default:
				throw new Error(
					`sync tool profile: unknown placeholder {${name}} in pattern ${pattern}; use {dir}, {stem}, {ext}, {device}, {timestamp}, or {counter}`,
				);
		}
	});
}

/**
 * The time as `YYYYMMDD-HHmmss` in UTC. The width and the time zone are
 * fixed, so a pattern gives the same text wherever the suite runs.
 */
export function formatTimestamp(at: number): string {
	const iso = new Date(at).toISOString();
	return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
}

interface PathParts {
	/** The directory with its trailing slash. Empty at the vault root. */
	readonly dir: string;
	readonly stem: string;
	/** The extension with its leading dot. Empty when the name has none. */
	readonly ext: string;
}

export function splitPath(path: string): PathParts {
	const slash = path.lastIndexOf('/');
	const dir = slash === -1 ? '' : path.slice(0, slash + 1);
	const name = path.slice(slash + 1);
	const dot = name.lastIndexOf('.');
	if (dot <= 0) {
		return { dir, stem: name, ext: '' };
	}
	return { dir, stem: name.slice(0, dot), ext: name.slice(dot) };
}
