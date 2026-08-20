import { describe, expect, it } from 'vitest';
import {
	civilSeconds,
	dayOfMonth,
	daysInMonth,
	weekdayOf,
	yearOf,
} from './calendar';

describe('the day of a month that a repeating change falls on', () => {
	it('takes a day that the rule names', () => {
		expect(dayOfMonth(2023, 3, { kind: 'fixed', day: 9 })).toBe(9);
	});

	it('takes the last such weekday of the month', () => {
		// The Sundays of March 2023 are the 5th, 12th, 19th and 26th.
		expect(dayOfMonth(2023, 3, { kind: 'last', weekday: 0 })).toBe(26);
	});

	it('takes the first such weekday on or after a day', () => {
		expect(
			dayOfMonth(2023, 3, { kind: 'onOrAfter', weekday: 0, day: 8 }),
		).toBe(12);
	});

	it('takes that same day where the day is already the weekday', () => {
		expect(
			dayOfMonth(2023, 3, { kind: 'onOrAfter', weekday: 0, day: 12 }),
		).toBe(12);
	});

	it('takes the last such weekday on or before a day', () => {
		// The Saturdays of October 2023 are the 7th, 14th, 21st and 28th.
		expect(
			dayOfMonth(2023, 10, { kind: 'onOrBefore', weekday: 6, day: 30 }),
		).toBe(28);
	});

	it('counts the extra day of a leap year', () => {
		expect(dayOfMonth(2024, 2, { kind: 'last', weekday: 4 })).toBe(29);
		expect(dayOfMonth(2023, 2, { kind: 'last', weekday: 4 })).toBe(23);
	});
});

describe('the civil arithmetic', () => {
	it('counts the seconds to the start of a day', () => {
		expect(civilSeconds(1970, 1, 1)).toBe(0);
		expect(civilSeconds(2023, 3, 12)).toBe(Date.UTC(2023, 2, 12) / 1000);
	});

	it('names the year that holds an instant', () => {
		expect(yearOf(0)).toBe(1970);
		expect(yearOf(Date.UTC(2023, 11, 31, 23, 59) / 1000)).toBe(2023);
	});

	it('names the weekday of a day', () => {
		// The 12th of March 2023 was a Sunday.
		expect(weekdayOf(2023, 3, 12)).toBe(0);
		expect(weekdayOf(2023, 3, 13)).toBe(1);
	});

	it('counts the days of a month', () => {
		expect(daysInMonth(2023, 2)).toBe(28);
		expect(daysInMonth(2024, 2)).toBe(29);
		expect(daysInMonth(2023, 12)).toBe(31);
		expect(daysInMonth(2023, 4)).toBe(30);
	});
});
