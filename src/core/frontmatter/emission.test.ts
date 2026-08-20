import { describe, expect, it } from 'vitest';
import { emitSchedule, nextDay } from './emission';
import type { NoteSchedule } from './schedule';

const ZONES = {
	noteTimezone: 'Europe/London',
	calendarTimezone: undefined,
} as const;

const START = {
	kind: 'date-time',
	date: { year: 2026, month: 3, day: 14 },
	time: { hour: 9, minute: 0, second: 0 },
	offsetSeconds: null,
} as const;

/** The times of one timed schedule under a zone of the note. */
function emit(schedule: NoteSchedule) {
	const result = emitSchedule(schedule, ZONES);
	if (!result.ok) {
		throw new Error('the schedule emits no times');
	}
	return result.value;
}

describe('the times of a timed schedule', () => {
	it('states the length where the note states a length', () => {
		const emission = emit({
			kind: 'timed',
			start: START,
			end: null,
			duration: { seconds: 5400, negative: false },
		});
		expect(emission.duration).toBe('PT1H30M');
		expect(emission.dtend).toBeNull();
	});

	it('states no end and no length where the note states neither', () => {
		const emission = emit({
			kind: 'timed',
			start: START,
			end: null,
			duration: null,
		});
		expect(emission.dtend).toBeNull();
		expect(emission.duration).toBeNull();
		expect(emission.timezoneNames).toEqual(['Europe/London']);
	});

	it('names one zone where the start and the end name one zone', () => {
		const emission = emit({
			kind: 'timed',
			start: START,
			end: { ...START, time: { hour: 10, minute: 30, second: 0 } },
			duration: null,
		});
		expect(emission.timezoneNames).toEqual(['Europe/London']);
	});
});

describe('the day after one day', () => {
	it.each([
		[
			{ year: 2026, month: 3, day: 14 },
			{ year: 2026, month: 3, day: 15 },
		],
		[
			{ year: 2026, month: 1, day: 31 },
			{ year: 2026, month: 2, day: 1 },
		],
		[
			{ year: 2026, month: 2, day: 28 },
			{ year: 2026, month: 3, day: 1 },
		],
		[
			{ year: 2028, month: 2, day: 28 },
			{ year: 2028, month: 2, day: 29 },
		],
		[
			{ year: 2028, month: 2, day: 29 },
			{ year: 2028, month: 3, day: 1 },
		],
		[
			{ year: 2026, month: 11, day: 30 },
			{ year: 2026, month: 12, day: 1 },
		],
		[
			{ year: 2026, month: 12, day: 31 },
			{ year: 2027, month: 1, day: 1 },
		],
	])('steps from %o to %o', (date, expected) => {
		expect(nextDay(date)).toEqual(expected);
	});

	it('steps over every last day of a year of 365 days', () => {
		const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
		for (const [index, day] of days.entries()) {
			const month = index + 1;
			expect(nextDay({ year: 2026, month, day })).toEqual(
				month === 12
					? { year: 2027, month: 1, day: 1 }
					: { year: 2026, month: month + 1, day: 1 },
			);
		}
	});
});
