/**
 * The clock port, over the clock and the timers of the platform.
 *
 * The engine reads no time and starts no timer of its own. It asks this
 * port for both. The test harness answers the same port with a clock that
 * a test moves by hand.
 *
 * A caller that starts a timer holds the function that stops that timer,
 * and that caller stops the timer. A plugin that registers such a function
 * with its own cleanup therefore unloads with no timer left behind.
 */

import type { CancelTimer, Clock } from '../core/ports/clock';

/**
 * The part of the platform that this module uses. The window of the app
 * satisfies the four timer methods, and `Date.now` answers the time.
 */
export interface ClockHost {
	now(): number;
	setTimeout(fn: () => void, ms: number): number;
	clearTimeout(id: number): void;
	setInterval(fn: () => void, ms: number): number;
	clearInterval(id: number): void;
}

/** The clock that reads one host. */
export function createClock(host: ClockHost): Clock {
	return {
		now(): number {
			return host.now();
		},
		after(ms: number, fn: () => void): CancelTimer {
			const id = host.setTimeout(fn, ms);
			return () => {
				host.clearTimeout(id);
			};
		},
		every(ms: number, fn: () => void): CancelTimer {
			const id = host.setInterval(fn, ms);
			return () => {
				host.clearInterval(id);
			};
		},
	};
}

/** The clock of the platform that the plugin runs on. */
export function systemClock(): Clock {
	return createClock({
		now: () => Date.now(),
		setTimeout: (fn, ms) => window.setTimeout(fn, ms),
		clearTimeout: (id) => {
			window.clearTimeout(id);
		},
		setInterval: (fn, ms) => window.setInterval(fn, ms),
		clearInterval: (id) => {
			window.clearInterval(id);
		},
	});
}
