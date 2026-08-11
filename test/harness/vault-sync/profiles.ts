/**
 * Per-tool sync profiles: how one sync tool names conflict copies, what it
 * does when a delivery meets a locally edited file, how it delivers a
 * rename, and whether it keeps modification times.
 *
 * The entries below are placeholders — plausible shapes to test against,
 * not observed behavior. Each value is replaced by the fact recorded
 * against the real tool without the profile interface changing, so suites
 * written now keep working when the corpus becomes real.
 */

import type { DeviceId } from './types';

/** What a tool does when a delivery meets content it did not put there. */
export type DivergentDelivery = 'overwrite' | 'conflict-copy' | 'merge';

/** Whether a rename arrives whole or as a deletion and a creation. */
export type RenameDelivery = 'rename' | 'delete-and-create';

export interface SyncToolProfile {
	readonly id: string;
	/**
	 * Filename pattern for the copy holding displaced local content, or
	 * null for a tool that makes no copies. Placeholders are `{dir}`,
	 * `{stem}`, `{ext}`, `{device}`, `{timestamp}`, and `{counter}`.
	 */
	readonly conflictCopyPattern: string | null;
	readonly divergentDelivery: DivergentDelivery;
	readonly renameDelivery: RenameDelivery;
	readonly preserveModificationTimes: boolean;
}

export const SYNC_TOOL_PROFILES: readonly SyncToolProfile[] = [
	{
		id: 'obsidian-sync',
		conflictCopyPattern: '{dir}{stem} (conflicted copy {timestamp}){ext}',
		divergentDelivery: 'merge',
		renameDelivery: 'rename',
		preserveModificationTimes: false,
	},
	{
		id: 'syncthing',
		conflictCopyPattern:
			'{dir}{stem}.sync-conflict-{timestamp}-{device}{ext}',
		divergentDelivery: 'conflict-copy',
		renameDelivery: 'delete-and-create',
		preserveModificationTimes: true,
	},
	{
		id: 'icloud-drive',
		conflictCopyPattern: '{dir}{stem} {counter}{ext}',
		divergentDelivery: 'conflict-copy',
		renameDelivery: 'delete-and-create',
		preserveModificationTimes: false,
	},
	{
		id: 'git',
		conflictCopyPattern: null,
		divergentDelivery: 'merge',
		renameDelivery: 'rename',
		preserveModificationTimes: false,
	},
];

/** The profile a channel uses when the caller names none. */
export const DEFAULT_SYNC_PROFILE: SyncToolProfile = {
	id: 'default',
	conflictCopyPattern: '{dir}{stem} (conflict {counter}){ext}',
	divergentDelivery: 'conflict-copy',
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

export interface ConflictCopyContext {
	/** The path whose local content is being moved aside. */
	readonly path: string;
	/** The device making the copy. */
	readonly device: DeviceId;
	/** The instant the copy is made. */
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
