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
			duration: {
				negative: false,
				weeks: 0,
				days: 0,
				hours: 1,
				minutes: 30,
				seconds: 0,
			},
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

// The reader of a note finds this fault too. The emitter is exported, so
// a caller that builds a schedule from another source reaches it without
// the reader.
describe('the end that does not stand after the start', () => {
	it('refuses an all-day pair whose last day stands before its first day', () => {
		const result = emitSchedule(
			{
				kind: 'all-day',
				date: { year: 2026, month: 3, day: 16 },
				endDate: { year: 2026, month: 3, day: 14 },
			},
			ZONES,
		);
		expect(result).toEqual({
			ok: false,
			problems: [
				{
					kind: 'end-before-start',
					keys: ['date', 'endDate'],
					start: 'date',
					end: 'endDate',
				},
			],
		});
	});

	it('takes an all-day pair of one day', () => {
		const result = emitSchedule(
			{
				kind: 'all-day',
				date: { year: 2026, month: 3, day: 14 },
				endDate: { year: 2026, month: 3, day: 14 },
			},
			ZONES,
		);
		expect(result.ok && result.value.dtend?.text).toBe('2026-03-15');
	});

	it.each([
		['an end before the start', { hour: 8, minute: 0, second: 0 }],
		['an end that equals the start', { hour: 9, minute: 0, second: 0 }],
	])('refuses a timed pair with %s', (_name, time) => {
		const result = emitSchedule(
			{
				kind: 'timed',
				start: START,
				end: { ...START, time },
				duration: null,
			},
			ZONES,
		);
		expect(result).toEqual({
			ok: false,
			problems: [
				{
					kind: 'end-before-start',
					keys: ['start', 'end'],
					start: 'start',
					end: 'end',
				},
			],
		});
	});

	// The start states an offset and the end states none, so the two reach
	// the format under two different zones. The order of the two then
	// follows from the timezone table, which this module does not read.
	it('compares no pair that carries two different zones', () => {
		const result = emitSchedule(
			{
				kind: 'timed',
				start: { ...START, offsetSeconds: 0 },
				end: { ...START, time: { hour: 8, minute: 0, second: 0 } },
				duration: null,
			},
			ZONES,
		);
		expect(result.ok).toBe(true);
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
