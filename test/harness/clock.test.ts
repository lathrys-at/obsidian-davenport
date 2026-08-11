import { describe, expect, it, vi } from 'vitest';
import type { CancelTimer } from '../../src/core/ports/clock';
import { ControlledClock, DEFAULT_START_TIME } from './clock';

describe('controlled clock time', () => {
	it('starts where it was told and moves only when advanced', () => {
		const clock = new ControlledClock({ start: 1_000 });
		expect(clock.now()).toBe(1_000);
		clock.advance(250);
		expect(clock.now()).toBe(1_250);
		expect(new ControlledClock().now()).toBe(DEFAULT_START_TIME);
	});

	it('refuses a start and durations it cannot order', () => {
		expect(() => new ControlledClock({ start: Number.NaN })).toThrow(
			RangeError,
		);
		expect(() => new ControlledClock({ maxFiringsPerAdvance: 0 })).toThrow(
			RangeError,
		);
		const clock = new ControlledClock({ start: 0 });
		const noop = (): void => {
			/* never runs */
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
	it('fires one-shot timers at their due instant, earliest first', () => {
		const clock = new ControlledClock({ start: 0 });
		const log: string[] = [];
		clock.after(30, () => log.push(`late@${String(clock.now())}`));
		clock.after(10, () => log.push(`early@${String(clock.now())}`));
		clock.advance(40);
		expect(log).toEqual(['early@10', 'late@30']);
		expect(clock.now()).toBe(40);
		expect(clock.pendingTimerCount).toBe(0);
	});

	it('breaks a tie on due instant by scheduling order', () => {
		const clock = new ControlledClock({ start: 0 });
		const log: string[] = [];
		clock.after(10, () => log.push('first'));
		clock.after(10, () => log.push('second'));
		clock.after(10, () => log.push('third'));
		clock.advance(10);
		expect(log).toEqual(['first', 'second', 'third']);
	});

	it('repeats on a fixed grid without drift', () => {
		const clock = new ControlledClock({ start: 0 });
		const log: number[] = [];
		clock.every(10, () => log.push(clock.now()));
		clock.advance(35);
		expect(log).toEqual([10, 20, 30]);
		expect(clock.now()).toBe(35);
		expect(clock.pendingTimerCount).toBe(1);
	});

	it('interleaves repeats with one-shots, rescheduling on each firing', () => {
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

	it('fires a timer scheduled from a callback when it comes due in the same advance', () => {
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

	it('fires a zero-delay timer on the next advance, not before', () => {
		const clock = new ControlledClock({ start: 0 });
		const log: string[] = [];
		clock.after(0, () => log.push('now'));
		expect(log).toEqual([]);
		clock.advance(0);
		expect(log).toEqual(['now']);
	});
});

describe('controlled clock cancellation', () => {
	it('keeps a cancelled timer from firing, one-shot or repeating', () => {
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

	it('drops a timer cancelled from a callback during the same advance', () => {
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

	it('ignores a repeated cancel and a cancel after firing', () => {
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
	it('leaves time at the failing timer and the rest pending', () => {
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

	it('caps the firings one advance may run', () => {
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

describe('re-entrancy', () => {
	it('refuses advance from inside a callback and stays usable', () => {
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
