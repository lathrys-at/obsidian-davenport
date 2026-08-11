/**
 * Per-tool sync profiles: how one sync tool names conflict copies, which
 * side of a divergence it keeps, what it does with the other side, how it
 * merges, whether its conflict copies reach the other devices, how it
 * delivers a rename, and whether it keeps modification times.
 *
 * The entries below are placeholders — plausible shapes to test against,
 * not observed behavior. Each value is replaced by the fact recorded
 * against the real tool without the profile interface changing, so suites
 * written now keep working when the corpus becomes real. That is why
 * every fact a recording will carry has a slot here even where the
 * placeholder for it is the channel's own default.
 */

import type { MergeMangler } from './mangle';
import type { ContentStamp, DeviceId } from './types';

/** What a tool does with the side of a divergence it does not keep. */
export type DivergentDelivery = 'overwrite' | 'conflict-copy' | 'merge';

/**
 * Which side of a divergence a tool keeps at the path. `newest` is the
 * one every tool in the corpus models: the more recently written content
 * wins wherever the two are ranked, so every device picks the same
 * winner and they agree on the path's bytes. `incoming` and `local` are
 * the one-sided rules, which leave two devices holding each other's
 * content.
 */
export type DivergenceWinner = 'newest' | 'incoming' | 'local';

/** Whether a rename arrives whole or as a deletion and a creation. */
export type RenameDelivery = 'rename' | 'delete-and-create';

export interface SyncToolProfile {
	readonly id: string;
	/**
	 * Filename pattern for the copy holding the losing side's content, or
	 * null for a tool that makes no copies. Placeholders are `{dir}`,
	 * `{stem}`, `{ext}`, `{device}`, `{timestamp}`, and `{counter}`.
	 */
	readonly conflictCopyPattern: string | null;
	readonly divergenceWinner: DivergenceWinner;
	readonly divergentDelivery: DivergentDelivery;
	/**
	 * How this tool merges, for a profile that merges. A merger passed to
	 * the channel wins over it, and the modeled line merge stands in where
	 * neither is given, so the merge recorded against a real tool lands
	 * here without any call site changing.
	 */
	readonly merger?: MergeMangler;
	/**
	 * Whether a conflict copy reaches the tool's other devices. False
	 * leaves the copy on the device that made it, which is the placeholder
	 * every entry below carries. Either way a device that sees both sides
	 * of a divergence makes the copy itself, so this decides what reaches
	 * a device that never sees one of them.
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

/** The profile a channel uses when the caller names none. */
export const DEFAULT_SYNC_PROFILE: SyncToolProfile = {
	id: 'default',
	conflictCopyPattern: '{dir}{stem} (conflict {counter}){ext}',
	divergenceWinner: 'newest',
	divergentDelivery: 'conflict-copy',
	propagateConflictCopies: false,
	renameDelivery: 'rename',
	preserveModificationTimes: false,
};

/** The profile with this id, or an error naming the ids there are. */
export function syncToolProfile(id: string): SyncToolProfile {
	const found = SYNC_TOOL_PROFILES.find((profile) => profile.id === id);
	if (found === undefined) {
		const known = SYNC_TOOL_PROFILES.map((profile) => profile.id).join(
			', ',
		);
		throw new Error(
			`sync tool profile: no profile ${id}; corpus holds ${known}`,
		);
	}
	return found;
}

/**
 * Whether the delivery's content takes the path. `newest` ranks the two
 * sides by the time each was written and breaks a tie on the author's id,
 * the earlier id winning. Both devices in a divergence hold the same two
 * stamps and so reach the same answer from opposite sides, which is what
 * lets them agree on the path and put the same content in the copy.
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
	/** The path whose losing content is being moved aside. */
	readonly path: string;
	/**
	 * The device that wrote the content being moved aside. Every device
	 * resolving one divergence names the copy after the same loser, so the
	 * copy is one file with one name across the vault rather than a
	 * different one on each device.
	 */
	readonly device: DeviceId;
	/**
	 * The modification time of the content being moved aside, which is
	 * what a tool names its copies after and what the copy itself keeps.
	 */
	readonly at: number;
	/** Fills `{counter}`; the first attempt uses 2, as tools number from. */
	readonly counter: number;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Fills a conflict-copy pattern. An unknown placeholder is an error rather
 * than a literal, so a typo in a corpus entry fails where it is written
 * instead of producing a filename nothing matches.
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
					`sync tool profile: unknown placeholder {${name}} in pattern ${pattern}`,
				);
		}
	});
}

/**
 * `YYYYMMDD-HHmmss` in UTC. Fixed width and zone so a pattern renders the
 * same wherever the suite runs.
 */
export function formatTimestamp(at: number): string {
	const iso = new Date(at).toISOString();
	return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
}

interface PathParts {
	/** Directory including its trailing slash; empty at the vault root. */
	readonly dir: string;
	readonly stem: string;
	/** Extension including its leading dot; empty where there is none. */
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
