/**
 * Clock port: core code never reads ambient time or schedules ambient
 * timers. Debounce, grace periods, horizon edges, and retention windows
 * all run on injected time, so the test harness drives them.
 */

export type CancelTimer = () => void;

export interface Clock {
	/** Milliseconds since the Unix epoch. */
	now(): number;
	after(ms: number, fn: () => void): CancelTimer;
	every(ms: number, fn: () => void): CancelTimer;
}
