import { describe, expect, it, vi } from 'vitest';
import type { CancelTimer } from '../../src/core/ports/clock';
import { ControlledClock, DEFAULT_START_TIME } from './clock';

describe('controlled clock time', () => {
	it('starts at the given time or at the default time, and moves only when a test advances the clock', () => {
		const clock = new ControlledClock({ start: 1_000 });
		expect(clock.now()).toBe(1_000);
		clock.advance(250);
		expect(clock.now()).toBe(1_250);
		expect(new ControlledClock().now()).toBe(DEFAULT_START_TIME);
	});

	it('throws when the start value, the maxFiringsPerAdvance value, or a duration is out of range', () => {
		expect(() => new ControlledClock({ start: Number.NaN })).toThrow(
			RangeError,
		);
		expect(() => new ControlledClock({ maxFiringsPerAdvance: 0 })).toThrow(
			RangeError,
		);
		const clock = new ControlledClock({ start: 0 });
		const noop = (): void => {
			/* Every call below throws, so this callback never runs. */
		};
		expect(() => clock.after(-1, noop)).toThrow(RangeError);
		expect(() => clock.after(Number.POSITIVE_INFINITY, noop)).toThrow(
			RangeError,
		);
		expect(() => clock.every(0, noop)).toThrow(RangeError);
		expect(() => {
			clock.advance(-1);
		}).toThrow(RangeError);
	});

	it('creates no real timers', () => {
		const realTimer = vi.fn();
		vi.stubGlobal('setTimeout', realTimer);
		vi.stubGlobal('setInterval', realTimer);
		const clock = new ControlledClock({ start: 0 });
		clock.after(10, () => undefined);
		clock.every(5, () => undefined);
		clock.advance(30);
		vi.unstubAllGlobals();
		expect(realTimer).not.toHaveBeenCalled();
	});
});

describe('controlled clock firing order', () => {
	it('fires each one-shot timer at its due instant, and fires the earliest timer first', () => {
		const clock = new ControlledClock({ start: 0 });
		const log: string[] = [];
		clock.after(30, () => log.push(`late@${String(clock.now())}`));
		clock.after(10, () => log.push(`early@${String(clock.now())}`));
		clock.advance(40);
		expect(log).toEqual(['early@10', 'late@30']);
		expect(clock.now()).toBe(40);
		expect(clock.pendingTimerCount).toBe(0);
	});

	it('fires timers with the same due instant in the order in which the test scheduled them', () => {
		const clock = new ControlledClock({ start: 0 });
		const log: string[] = [];
		clock.after(10, () => log.push('first'));
		clock.after(10, () => log.push('second'));
		clock.after(10, () => log.push('third'));
		clock.advance(10);
		expect(log).toEqual(['first', 'second', 'third']);
	});

	it('fires a repeating timer at each multiple of its period, with no drift', () => {
		const clock = new ControlledClock({ start: 0 });
		const log: number[] = [];
		clock.every(10, () => log.push(clock.now()));
		clock.advance(35);
		expect(log).toEqual([10, 20, 30]);
		expect(clock.now()).toBe(35);
		expect(clock.pendingTimerCount).toBe(1);
	});

	it('mixes a repeating timer with one-shot timers, and reschedules the repeat at each firing', () => {
		const clock = new ControlledClock({ start: 0 });
		const log: string[] = [];
		clock.every(10, () => log.push(`every@${String(clock.now())}`));
		clock.after(15, () => log.push(`a@${String(clock.now())}`));
		clock.after(20, () => log.push(`b@${String(clock.now())}`));
		clock.after(10, () => log.push(`c@${String(clock.now())}`));
		clock.advance(30);
		expect(log).toEqual([
			'every@10',
			'c@10',
			'a@15',
			'b@20',
			'every@20',
			'every@30',
		]);
	});

	it('fires a timer that a callback schedules, when the new timer comes due in the same advance', () => {
		const clock = new ControlledClock({ start: 0 });
		const log: string[] = [];
		clock.after(10, () => {
			clock.after(5, () => log.push(`inner@${String(clock.now())}`));
			clock.after(100, () => log.push('never'));
		});
		clock.advance(20);
		expect(log).toEqual(['inner@15']);
		expect(clock.pendingTimerCount).toBe(1);
	});

	it('fires a timer with zero delay on the next advance, and not before that advance', () => {
		const clock = new ControlledClock({ start: 0 });
		const log: string[] = [];
		clock.after(0, () => log.push('now'));
		expect(log).toEqual([]);
		clock.advance(0);
		expect(log).toEqual(['now']);
	});
});

describe('controlled clock cancellation', () => {
	it('stops a cancelled timer from firing, for a one-shot timer and for a repeating timer', () => {
		const clock = new ControlledClock({ start: 0 });
		const log: string[] = [];
		const cancelOnce = clock.after(10, () => log.push('once'));
		const cancelEvery = clock.every(10, () => log.push('every'));
		cancelOnce();
		clock.advance(15);
		cancelEvery();
		clock.advance(50);
		expect(log).toEqual(['every']);
		expect(clock.pendingTimerCount).toBe(0);
	});

	it('drops a timer that a callback cancels during the same advance', () => {
		const clock = new ControlledClock({ start: 0 });
		const log: string[] = [];
		let cancelLater: CancelTimer | null = null;
		clock.after(10, () => {
			cancelLater?.();
		});
		cancelLater = clock.after(20, () => log.push('later'));
		clock.advance(30);
		expect(log).toEqual([]);
		expect(clock.pendingTimerCount).toBe(0);
	});

	it('ignores a second cancel, and a cancel that comes after the timer fires', () => {
		const clock = new ControlledClock({ start: 0 });
		const cancelTwice = clock.after(10, () => undefined);
		cancelTwice();
		cancelTwice();
		const cancelFired = clock.after(10, () => undefined);
		clock.advance(10);
		cancelFired();
		expect(clock.pendingTimerCount).toBe(0);
	});
});

describe('controlled clock failure', () => {
	it('leaves time at the timer that threw, and leaves every other timer pending', () => {
		const clock = new ControlledClock({ start: 0 });
		const log: string[] = [];
		clock.every(10, () => {
			log.push(`every@${String(clock.now())}`);
			throw new Error('callback failed');
		});
		clock.after(15, () => log.push('after'));
		const advance = (): void => {
			clock.advance(30);
		};
		expect(advance).toThrow('callback failed');
		expect(clock.now()).toBe(10);
		expect(clock.pendingTimerCount).toBe(2);
		expect(advance).toThrow('callback failed');
		expect(clock.now()).toBe(20);
		expect(log).toEqual(['every@10', 'after', 'every@20']);
	});

	it('throws when one advance makes more firings than the cap allows', () => {
		const clock = new ControlledClock({
			start: 0,
			maxFiringsPerAdvance: 5,
		});
		const reschedule = (): void => {
			clock.after(0, reschedule);
		};
		clock.after(0, reschedule);
		expect(() => {
			clock.advance(1);
		}).toThrow(/more than 5 timer firings/);
	});
});

describe('controlled clock advance inside a callback', () => {
	it('throws when a callback calls advance, and the clock still works after that', () => {
		const clock = new ControlledClock({ start: 0 });
		let inner: unknown;
		clock.after(10, () => {
			try {
				clock.advance(100);
			} catch (error) {
				inner = error;
			}
		});
		clock.advance(30);
		expect(inner).toBeInstanceOf(Error);
		expect((inner as Error).message).toMatch(/inside a timer callback/);
		expect(clock.now()).toBe(30);
		const log: number[] = [];
		clock.after(5, () => log.push(clock.now()));
		clock.advance(10);
		expect(log).toEqual([35]);
	});
});
