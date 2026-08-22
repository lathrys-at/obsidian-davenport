/**
 * The sync log of the session, in memory.
 *
 * The engine states what it did with each item, and it states a refusal, a
 * skip, and a failure as well. This log keeps those entries while the
 * plugin runs. The sync activity view reads them.
 *
 * The log holds a limited number of entries. When the log is full, the
 * oldest entry goes. A vault with many calendars produces many entries,
 * and a list that grows without a limit takes memory that a phone does not
 * have.
 *
 * The log writes nothing to disk. The entries of one session go when the
 * plugin unloads.
 */

import type { Logger, SyncLogEntry } from '../core/ports/logger';

/** The number of entries that a log holds where the caller states none. */
export const DEFAULT_LOG_LIMIT = 500;

export class MemoryLog implements Logger {
	private readonly kept: SyncLogEntry[] = [];
	private readonly limit: number;

	constructor(limit: number = DEFAULT_LOG_LIMIT) {
		this.limit = Math.max(1, Math.trunc(limit));
	}

	log(entry: SyncLogEntry): void {
		this.kept.push(entry);
		if (this.kept.length > this.limit) {
			this.kept.splice(0, this.kept.length - this.limit);
		}
	}

	/** The entries that the log holds, oldest first. */
	get entries(): readonly SyncLogEntry[] {
		return [...this.kept];
	}
}
