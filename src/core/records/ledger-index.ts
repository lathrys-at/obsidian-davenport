/**
 * The index of the ledger: from the pair that names an event to the path
 * of the record of that event, and back.
 *
 * A note names an event with the calendar and the UID, and the plugin
 * resolves that name through this index. The index also answers the other
 * direction. A vault event names a path, and the plugin must know which
 * event that path belongs to.
 *
 * The index holds the path that the vault shows, and not the path that
 * the digest gives. The two are the same for a record that the plugin
 * wrote. They differ for a copy that a sync tool made, and that
 * difference is what a later check reads. The index therefore never
 * corrects a path, and it never hides a second file.
 *
 * The index refuses a second path for one identity. Two files that claim
 * one event are a fault, and the caller decides what to do with the
 * second one. The index takes no side.
 *
 * The index holds no file. A caller reads each record and states what it
 * read. The index therefore needs no way to list a folder, and it works
 * the same for a caller that loads the whole folder and for a caller that
 * learns one identity at a time.
 */

import type { EventIdentity } from '../model/identity';
import { identityText } from './filename';

/** What one entry of the index states. */
export interface LedgerEntry {
	readonly identity: EventIdentity;
	/** The path that the vault shows for this record. */
	readonly path: string;
}

/** What an attempt to put one record into the index did. */
export type LedgerAdmission =
	/** The index held neither the identity nor the path. */
	| 'added'
	/** The index already held this identity at this path. */
	| 'known'
	/** The index already held this identity at another path. */
	| 'duplicate-identity'
	/** The index already held this path under another identity. */
	| 'duplicate-path';

export class LedgerIndex {
	private readonly paths = new Map<string, LedgerEntry>();
	private readonly identities = new Map<string, string>();

	/** The number of records that the index holds. */
	get size(): number {
		return this.paths.size;
	}

	/**
	 * Puts one record into the index. The index changes nothing when the
	 * answer names a duplicate.
	 */
	add(identity: EventIdentity, path: string): LedgerAdmission {
		const key = identityText(identity);
		const standing = this.identities.get(key);
		if (standing !== undefined) {
			return standing === path ? 'known' : 'duplicate-identity';
		}
		if (this.paths.has(path)) {
			return 'duplicate-path';
		}
		this.identities.set(key, path);
		this.paths.set(path, { identity, path });
		return 'added';
	}

	/** The path of the record of one identity. */
	pathOf(identity: EventIdentity): string | undefined {
		return this.identities.get(identityText(identity));
	}

	/** The identity that one path holds. */
	identityOf(path: string): EventIdentity | undefined {
		return this.paths.get(path)?.identity;
	}

	/** Takes one path out of the index. */
	remove(path: string): boolean {
		const entry = this.paths.get(path);
		if (entry === undefined) {
			return false;
		}
		this.paths.delete(path);
		this.identities.delete(identityText(entry.identity));
		return true;
	}

	/** Every entry of the index, in the order in which they arrived. */
	entries(): readonly LedgerEntry[] {
		return [...this.paths.values()];
	}
}
