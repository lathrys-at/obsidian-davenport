/**
 * Sync-log vocabulary (§14.4). The log records refusals, skips, and
 * conflicts, not only successes: nothing is silently skipped (§1
 * principle 5), and the sync activity view renders these entries.
 */

export type LogOutcome = 'success' | 'refused' | 'skipped' | 'failed' | 'conflict';

export interface SyncLogEntry {
	/** Epoch milliseconds, from the Clock port. */
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
