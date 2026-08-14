/**
 * The controlled clock is the only source of time in the harness. Time
 * moves when a test moves it, and never on its own. The clock creates no
 * real timer.
 *
 * Each timer has a due instant: the time at which the clock must call the
 * callback of that timer. To fire a timer is to make that call, and one
 * firing is one such call. A one-shot timer fires one time. A repeating
 * timer fires again and again, one time in each period.
 *
 * The `advance` method fires the timers that come due. The clock fires
 * the timer with the earliest due instant first. When two timers have the
 * same due instant, the clock fires them in the order in which the caller
 * scheduled them. The clock gives a repeating timer its next due instant
 * at the moment when that repeating timer fires. The repeating timer
 * therefore fires after every timer that already waits on the instant
 * that the repeat lands on.
 *
 * Inside a callback, `now()` gives the due instant of the timer that
 * fires. A timer that a callback schedules therefore counts its delay
 * from that due instant. When this new timer comes due before the end of
 * the advance, the new timer fires in the same advance. After the last
 * due timer fires, time stops exactly on the target of the advance.
 *
 * A callback that throws sends the error out of `advance`. Time stays at
 * the due instant of the timer that threw, and every other timer stays
 * pending. A repeating timer that throws keeps its place in the schedule
 * for its next period.
 */

import type { CancelTimer, Clock } from '../../src/core/ports/clock';

/**
 * The time that a clock reads when the caller gives no start value. The
 * value is in milliseconds since the Unix epoch.
 */
export const DEFAULT_START_TIME = Date.UTC(2026, 0, 1);

const DEFAULT_MAX_FIRINGS_PER_ADVANCE = 100_000;

export interface ControlledClockOptions {
	/**
	 * The time that the clock reads before the first advance. The value
	 * is in milliseconds since the Unix epoch.
	 */
	readonly start?: number;
	/**
	 * The largest number of timer firings that one `advance` allows. The
	 * advance throws when it goes above this number. Without the limit, a
	 * timer that schedules itself again without end makes a test hang.
	 * With the limit, that timer makes the test fail.
	 */
	readonly maxFiringsPerAdvance?: number;
}

interface ScheduledTimer {
	readonly id: number;
	readonly fn: () => void;
	/** The period in milliseconds. The value is null for a one-shot timer. */
	readonly period: number | null;
	/**
	 * The instant at which the caller scheduled the timer. Each repeat
	 * counts its delay from this instant.
	 */
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
				`controlled clock: start must be a finite number of milliseconds, got ${String(start)}`,
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

	/**
	 * The number of timers that wait to fire. The count includes the
	 * one-shot timers and the repeating timers.
	 */
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
	 * Moves time forward by `ms` milliseconds, and fires every timer that
	 * comes due in that period. When a callback cancels a timer, that
	 * timer does not fire in this advance.
	 *
	 * A call to `advance` from inside a timer callback throws. Such a
	 * call would put a second advance inside the first advance. The first
	 * advance would then move time backwards over the timers that the
	 * second advance already fired.
	 */
	advance(ms: number): void {
		assertDuration(ms, 'advance');
		if (this.advancing) {
			throw new Error(
				'controlled clock: advance cannot run inside a timer callback. Call advance from the test body.',
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
						`controlled clock: one advance made more than ${String(this.maxFiringsPerAdvance)} timer firings. Look for a timer that schedules itself again without end.`,
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
