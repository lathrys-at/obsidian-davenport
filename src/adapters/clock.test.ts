/**
 * The clock over the timers of a host.
 *
 * The point of these cases is the contract of the port: the clock reads
 * the time of the host, it starts one timer for each call, and the
 * function that it gives back stops that timer.
 */

import { describe, expect, it, vi } from 'vitest';
import { withRealTime } from '../../test/harness/sweeps';
import type { ClockHost } from './clock';
import { createClock, systemClock } from './clock';

/** A host that records the calls and starts no timer of the platform. */
function recordingHost(): {
	readonly host: ClockHost;
	readonly calls: string[];
} {
	const calls: string[] = [];
	let next = 1;
	return {
		calls,
		host: {
			now: () => 1750,
			setTimeout: (_fn, ms) => {
				calls.push(`setTimeout ${String(ms)}`);
				return next++;
			},
			clearTimeout: (id) => {
				calls.push(`clearTimeout ${String(id)}`);
			},
			setInterval: (_fn, ms) => {
				calls.push(`setInterval ${String(ms)}`);
				return next++;
			},
			clearInterval: (id) => {
				calls.push(`clearInterval ${String(id)}`);
			},
		},
	};
}

describe('the clock over a host', () => {
	it('reads the time of the host', () => {
		const { host } = recordingHost();
		expect(createClock(host).now()).toBe(1750);
	});

	it('starts a timer that runs one time, and stops that timer', () => {
		const { host, calls } = recordingHost();
		const cancel = createClock(host).after(500, () => undefined);
		expect(calls).toEqual(['setTimeout 500']);
		cancel();
		expect(calls).toEqual(['setTimeout 500', 'clearTimeout 1']);
	});

	it('starts a timer that repeats, and stops that timer', () => {
		const { host, calls } = recordingHost();
		const cancel = createClock(host).every(60, () => undefined);
		expect(calls).toEqual(['setInterval 60']);
		cancel();
		expect(calls).toEqual(['setInterval 60', 'clearInterval 1']);
	});

	it('gives the callback of the caller to the host', () => {
		let ran = 0;
		const host: ClockHost = {
			now: () => 0,
			setTimeout: (fn) => {
				fn();
				return 1;
			},
			clearTimeout: () => undefined,
			setInterval: (fn) => {
				fn();
				return 2;
			},
			clearInterval: () => undefined,
		};
		const clock = createClock(host);
		clock.after(1, () => {
			ran += 1;
		});
		clock.every(1, () => {
			ran += 1;
		});
		expect(ran).toBe(2);
	});
});

describe('the clock of the platform', () => {
	it('reads the clock of the machine', () => {
		const time = withRealTime(
			'this case asks whether the clock of the plugin reads the clock of the machine',
			() => systemClock().now(),
		);
		expect(time).toBeGreaterThan(0);
	});

	// The stub holds a timer that records the call and starts nothing. It
	// opens no way to the wall clock, and the poison of the harness stays
	// in place for every other spelling.
	it('starts the timers of the window of the app', () => {
		const calls: string[] = [];
		vi.stubGlobal('window', {
			setTimeout: (_fn: () => void, ms: number) => {
				calls.push(`setTimeout ${String(ms)}`);
				return 7;
			},
			clearTimeout: (id: number) => {
				calls.push(`clearTimeout ${String(id)}`);
			},
			setInterval: (_fn: () => void, ms: number) => {
				calls.push(`setInterval ${String(ms)}`);
				return 8;
			},
			clearInterval: (id: number) => {
				calls.push(`clearInterval ${String(id)}`);
			},
		});
		const clock = systemClock();
		clock.after(30, () => undefined)();
		clock.every(60, () => undefined)();
		expect(calls).toEqual([
			'setTimeout 30',
			'clearTimeout 7',
			'setInterval 60',
			'clearInterval 8',
		]);
	});
});
