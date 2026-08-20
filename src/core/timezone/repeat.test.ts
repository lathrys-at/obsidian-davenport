import { describe, expect, it } from 'vitest';
import type { RuleDay } from './calendar';
import {
	repeatOnset,
	repeatPatterns,
	repeatPatternsOfYear,
	repeatRule,
} from './repeat';
import type { TerminalChange } from './table';

function change(
	month: number,
	day: RuleDay,
	wallSeconds: number,
): TerminalChange {
	return { month, day, wallSeconds };
}

const LAST_SUNDAY: RuleDay = { kind: 'last', weekday: 0 };
const SUNDAY_ON_OR_AFTER_EIGHT: RuleDay = {
	kind: 'onOrAfter',
	weekday: 0,
	day: 8,
};
const SUNDAY_ON_OR_BEFORE_THIRTY: RuleDay = {
	kind: 'onOrBefore',
	weekday: 0,
	day: 30,
};

describe('the pattern of a repeating change that stays inside its day', () => {
	it('names the last weekday in the short form of the format', () => {
		expect(repeatPatterns(change(3, LAST_SUNDAY, 3600))).toEqual([
			{ month: 3, days: undefined, byday: '-1SU' },
		]);
	});

	it('names one day of the month where the rule names one day', () => {
		expect(
			repeatPatterns(change(9, { kind: 'fixed', day: 15 }, 7200)),
		).toEqual([{ month: 9, days: [15], byday: undefined }]);
	});

	it('names a window of seven days after the day that the rule states', () => {
		expect(
			repeatPatterns(change(3, SUNDAY_ON_OR_AFTER_EIGHT, 7200)),
		).toEqual([
			{ month: 3, days: [8, 9, 10, 11, 12, 13, 14], byday: 'SU' },
		]);
	});

	it('names a window of seven days before the day that the rule states', () => {
		expect(
			repeatPatterns(change(10, SUNDAY_ON_OR_BEFORE_THIRTY, 7200)),
		).toEqual([
			{ month: 10, days: [24, 25, 26, 27, 28, 29, 30], byday: 'SU' },
		]);
	});

	it('writes one pattern for each month where the window reaches past the month', () => {
		expect(
			repeatPatterns(
				change(4, { kind: 'onOrAfter', weekday: 0, day: 28 }, 7200),
			),
		).toEqual([
			{ month: 4, days: [28, 29, 30], byday: 'SU' },
			{ month: 5, days: [1, 2, 3, 4], byday: 'SU' },
		]);
	});

	it('writes one pattern for each month where the window reaches before the month', () => {
		expect(
			repeatPatterns(
				change(4, { kind: 'onOrBefore', weekday: 0, day: 3 }, 7200),
			),
		).toEqual([
			{ month: 3, days: [28, 29, 30, 31], byday: 'SU' },
			{ month: 4, days: [1, 2, 3], byday: 'SU' },
		]);
	});
});

describe('the pattern of a repeating change whose onset moves to another day', () => {
	it('moves the weekday and the days back by one day', () => {
		expect(repeatPatterns(change(3, LAST_SUNDAY, -3600))).toEqual([
			{ month: 3, days: [24, 25, 26, 27, 28, 29, 30], byday: 'SA' },
		]);
	});

	it('moves the weekday and the days forward by one day', () => {
		expect(
			repeatPatterns(change(9, SUNDAY_ON_OR_AFTER_EIGHT, 86400)),
		).toEqual([
			{ month: 9, days: [9, 10, 11, 12, 13, 14, 15], byday: 'MO' },
		]);
	});

	it('moves a day of the month and names no weekday', () => {
		expect(
			repeatPatterns(change(10, { kind: 'fixed', day: 31 }, 86400)),
		).toEqual([{ month: 11, days: [1], byday: undefined }]);
	});

	it('writes one pattern for each month that the onset reaches', () => {
		expect(
			repeatPatterns(change(10, { kind: 'last', weekday: 4 }, 86400)),
		).toEqual([
			{ month: 10, days: [26, 27, 28, 29, 30, 31], byday: 'FR' },
			{ month: 11, days: [1], byday: 'FR' },
		]);
	});
});

describe('the rule of one pattern', () => {
	it('states the frequency, the weekday, the days and the month, in that order', () => {
		expect(
			Object.entries(
				repeatRule({
					month: 3,
					days: [8, 9, 10, 11, 12, 13, 14],
					byday: 'SU',
				}),
			),
		).toEqual([
			['freq', 'YEARLY'],
			['byday', 'SU'],
			['bymonthday', [8, 9, 10, 11, 12, 13, 14]],
			['bymonth', 3],
		]);
	});

	it('states one number where the pattern holds one day', () => {
		expect(repeatRule({ month: 11, days: [1], byday: 'FR' })).toStrictEqual(
			{
				freq: 'YEARLY',
				byday: 'FR',
				bymonthday: 1,
				bymonth: 11,
			},
		);
	});

	it('states no days where the pattern names the last weekday', () => {
		expect(
			repeatRule({ month: 10, days: undefined, byday: '-1SU' }),
		).toStrictEqual({ freq: 'YEARLY', byday: '-1SU', bymonth: 10 });
	});

	it('states no weekday where the pattern names a day of the month', () => {
		expect(
			repeatRule({ month: 5, days: [15], byday: undefined }),
		).toStrictEqual({ freq: 'YEARLY', bymonthday: 15, bymonth: 5 });
	});
});

describe('the onset of a repeating change', () => {
	it('reads the day that the rule names and the time of that day', () => {
		// The last Sunday of March 2026 is the 29th.
		expect(repeatOnset(change(3, LAST_SUNDAY, 3600), 2026)).toBe(
			Date.UTC(2026, 2, 29, 1) / 1000,
		);
	});

	it('reaches the day before where the time stands before the day', () => {
		expect(repeatOnset(change(3, LAST_SUNDAY, -3600), 2026)).toBe(
			Date.UTC(2026, 2, 28, 23) / 1000,
		);
	});

	it('reaches the day after where the time stands at the end of the day', () => {
		expect(repeatOnset(change(3, LAST_SUNDAY, 86400), 2026)).toBe(
			Date.UTC(2026, 2, 30) / 1000,
		);
	});
});

describe('the days that a pattern names in a leap year', () => {
	const LEAP_YEAR = 2000;

	it('holds the days of every pattern that stays away from February', () => {
		for (const one of [
			change(3, LAST_SUNDAY, 3600),
			change(3, SUNDAY_ON_OR_AFTER_EIGHT, 7200),
			change(10, SUNDAY_ON_OR_BEFORE_THIRTY, 7200),
			change(10, { kind: 'last', weekday: 4 }, 86400),
		]) {
			expect(repeatPatternsOfYear(one, LEAP_YEAR)).toEqual(
				repeatPatterns(one),
			);
		}
	});

	it('moves the last day where a pattern reaches the end of February', () => {
		// A change in March whose onset falls one day early reaches back over
		// the end of February. The last day of that month differs between a
		// leap year and every other year, so this pattern names two sets.
		const one = change(
			3,
			{ kind: 'onOrAfter', weekday: 0, day: 1 },
			-86400,
		);
		expect(repeatPatterns(one)).toEqual([
			{ month: 2, days: [28], byday: 'SA' },
			{ month: 3, days: [1, 2, 3, 4, 5, 6], byday: 'SA' },
		]);
		expect(repeatPatternsOfYear(one, LEAP_YEAR)).toEqual([
			{ month: 2, days: [29], byday: 'SA' },
			{ month: 3, days: [1, 2, 3, 4, 5, 6], byday: 'SA' },
		]);
	});

	it('moves the first day where a window reaches back over February', () => {
		const one = change(3, { kind: 'onOrBefore', weekday: 0, day: 3 }, 7200);
		expect(repeatPatterns(one)[0]?.days).toEqual([25, 26, 27, 28]);
		expect(repeatPatternsOfYear(one, LEAP_YEAR)[0]?.days).toEqual([
			26, 27, 28, 29,
		]);
	});
});
