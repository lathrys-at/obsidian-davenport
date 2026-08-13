/**
 * This file gives the types that the sync log uses. The log records what
 * the sync engine did with each item. The log records a success, and it
 * also records a refusal, a skip, and a conflict. The engine must never
 * pass over an item in silence. The sync activity view shows these log
 * entries to the user.
 */

export type LogOutcome =
	'success' | 'refused' | 'skipped' | 'failed' | 'conflict';

export interface SyncLogEntry {
	/**
	 * The time of the entry, in milliseconds since the Unix epoch. The
	 * clock port gives this time.
	 */
	readonly time: number;
	readonly calendar?: string;
	readonly item?: string;
	readonly action: string;
	readonly outcome: LogOutcome;
	readonly reason?: string;
}

export interface Logger {
	log(entry: SyncLogEntry): void;
}
