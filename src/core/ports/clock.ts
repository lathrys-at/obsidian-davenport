/**
 * The clock port gives the time to the core code. The core code never
 * reads the clock of the system, and never starts a timer of the system.
 * Every behavior that depends on time uses the time from this port: the
 * debounce of edits, the grace periods, the edges of the sync horizon,
 * and the retention windows. The test harness therefore drives that
 * behavior.
 */

/** Stops a timer. The timer does not run again after this call. */
export type CancelTimer = () => void;

export interface Clock {
	/** Returns the time now, in milliseconds since the Unix epoch. */
	now(): number;
	/** Runs `fn` one time, `ms` milliseconds from now. */
	after(ms: number, fn: () => void): CancelTimer;
	/** Runs `fn` again and again, one time each `ms` milliseconds. */
	every(ms: number, fn: () => void): CancelTimer;
}
