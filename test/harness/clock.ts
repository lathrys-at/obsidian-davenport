/**
 * Controlled clock: the harness's only source of time. Time moves when a
 * test moves it and never on its own, and no real timer is created.
 *
 * Timers fire during `advance`, earliest due instant first; timers due at
 * the same instant fire in the order they were scheduled. A repeating
 * timer is rescheduled at the moment it fires, so it sorts behind anything
 * already waiting on the instant it lands on. Inside a callback `now()`
 * reads the timer's due instant, so a timer scheduled from a callback
 * counts from there, and one that comes due before the end of the advance
 * fires in the same advance. When the last due timer has run, time lands
 * exactly on the advance target.
 *
 * A callback that throws propagates out of `advance` with time left at
 * that timer's due instant and every remaining timer still pending; a
 * repeating timer that throws stays scheduled for its next period.
 */

import type { CancelTimer, Clock } from '../../src/core/ports/clock';

/** Epoch milliseconds a clock reads when the caller names no start. */
export const DEFAULT_START_TIME = Date.UTC(2026, 0, 1);

const DEFAULT_MAX_FIRINGS_PER_ADVANCE = 100_000;

export interface ControlledClockOptions {
	/** Epoch milliseconds the clock reads before the first advance. */
	readonly start?: number;
	/**
	 * Firings one `advance` may run before it throws. The cap turns a
	 * timer that reschedules itself without end into a failure rather
	 * than a hang.
	 */
	readonly maxFiringsPerAdvance?: number;
}

interface ScheduledTimer {
	readonly id: number;
	readonly fn: () => void;
	/** Null for a one-shot timer. */
	readonly period: number | null;
	/** The instant the timer was scheduled from; repeats count from here. */
	readonly origin: number;
	iteration: number;
	due: number;
	order: number;
}

export class ControlledClock implements Clock {
	private readonly timers = new Map<number, ScheduledTimer>();
	private readonly maxFiringsPerAdvance: number;
	private time: number;
	private nextId = 1;
	private nextOrder = 1;
	private advancing = false;

	constructor(options: ControlledClockOptions = {}) {
		const start = options.start ?? DEFAULT_START_TIME;
		const cap =
			options.maxFiringsPerAdvance ?? DEFAULT_MAX_FIRINGS_PER_ADVANCE;
		if (!Number.isFinite(start)) {
			throw new RangeError(
				`controlled clock: start must be a finite instant, got ${String(start)}`,
			);
		}
		if (!Number.isInteger(cap) || cap < 1) {
			throw new RangeError(
				`controlled clock: maxFiringsPerAdvance must be a positive integer, got ${String(cap)}`,
			);
		}
		this.time = start;
		this.maxFiringsPerAdvance = cap;
	}

	/** Timers waiting to fire, one-shot and repeating alike. */
	get pendingTimerCount(): number {
		return this.timers.size;
	}

	now(): number {
		return this.time;
	}

	after(ms: number, fn: () => void): CancelTimer {
		assertDuration(ms, 'after');
		return this.schedule(fn, null, ms);
	}

	every(ms: number, fn: () => void): CancelTimer {
		assertPeriod(ms);
		return this.schedule(fn, ms, ms);
	}

	/**
	 * Moves time forward by `ms`, firing every timer that comes due along
	 * the way. Cancelling a timer from a callback keeps it from firing in
	 * this advance. Advancing from inside a timer callback throws: a nested
	 * advance would let the outer one snap time backwards over timers the
	 * inner one already fired.
	 */
	advance(ms: number): void {
		assertDuration(ms, 'advance');
		if (this.advancing) {
			throw new Error(
				'controlled clock: advance called from inside a timer callback',
			);
		}
		this.advancing = true;
		try {
			const target = this.time + ms;
			let fired = 0;
			for (
				let timer = this.nextDue(target);
				timer !== null;
				timer = this.nextDue(target)
			) {
				fired += 1;
				if (fired > this.maxFiringsPerAdvance) {
					throw new Error(
						`controlled clock: more than ${String(this.maxFiringsPerAdvance)} timer firings in one advance`,
					);
				}
				this.time = timer.due;
				if (timer.period === null) {
					this.timers.delete(timer.id);
				} else {
					timer.iteration += 1;
					timer.due = timer.origin + timer.iteration * timer.period;
					timer.order = this.nextOrder++;
				}
				timer.fn();
			}
			this.time = target;
		} finally {
			this.advancing = false;
		}
	}

	private schedule(
		fn: () => void,
		period: number | null,
		firstDelay: number,
	): CancelTimer {
		const id = this.nextId++;
		this.timers.set(id, {
			id,
			fn,
			period,
			origin: this.time,
			iteration: 1,
			due: this.time + firstDelay,
			order: this.nextOrder++,
		});
		return () => {
			this.timers.delete(id);
		};
	}

	private nextDue(target: number): ScheduledTimer | null {
		let next: ScheduledTimer | null = null;
		for (const timer of this.timers.values()) {
			if (timer.due > target) {
				continue;
			}
			if (
				next === null ||
				timer.due < next.due ||
				(timer.due === next.due && timer.order < next.order)
			) {
				next = timer;
			}
		}
		return next;
	}
}

function assertDuration(ms: number, label: string): void {
	if (!Number.isFinite(ms) || ms < 0) {
		throw new RangeError(
			`controlled clock: ${label} needs a finite duration of zero milliseconds or more, got ${String(ms)}`,
		);
	}
}

function assertPeriod(ms: number): void {
	if (!Number.isFinite(ms) || ms <= 0) {
		throw new RangeError(
			`controlled clock: every needs a finite period above zero milliseconds, got ${String(ms)}`,
		);
	}
}
