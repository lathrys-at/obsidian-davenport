/**
 * The repeat rules of a synthesised timezone definition.
 *
 * A zone that keeps its seasonal rules repeats two changes every year. The
 * definition states each of those changes one time, and it gives each one a
 * repeat rule. The definition therefore covers every year, and it states no
 * end date.
 *
 * The table states the day of such a change in words, such as the last
 * Sunday of March. The table states the time of the change on the clock
 * that runs before it. That time can stand outside the day that the rule
 * names. The onset then falls on the day before or on the day after the
 * day of the rule. A rule of the format states the day of the onset. This
 * module therefore reads the days of the onset, and not the days of the
 * rule.
 *
 * A rule of the format names one month, one weekday and a set of days of
 * that month. The month and the day of the month multiply, so one rule
 * cannot name a day in one month together with a day in the month beside
 * it. The onset of a change that moves across a month boundary therefore
 * needs one rule for each month that it reaches. Each rule covers the
 * years in which the onset falls in the month of that rule. The rules
 * together cover every year one time.
 *
 * A rule that names a weekday and a window of seven days holds each
 * weekday one time. Such a rule names one day of each year. A rule that
 * covers part of a window holds each weekday one time or no time. Such a
 * rule names one day of a year, or no day of that year.
 */

import type { JCalRecur } from '../ics/jcal';
import type { RuleDay } from './calendar';
import {
	civilDateTime,
	civilSeconds,
	dayOfMonth,
	daysInMonth,
} from './calendar';
import type { TerminalChange } from './table';

/** The seconds in one day. */
const DAY_SECONDS = 86400;

/**
 * A year that is not a leap year. The patterns read the days of a month
 * from this year.
 *
 * February holds one more day in a leap year. A pattern that names a day at
 * the end of February therefore names a different set of days in such a
 * year. A rule of the format names one set for every year. A set that held
 * both forms would hold eight days or more. A set of eight days holds one
 * weekday two times in some years. The rule would then name a day that the
 * zone does not change on.
 *
 * No pattern of the release names a day of February. A test compares the
 * patterns of a leap year against the patterns of this year. The test
 * reads every repeating change of the table.
 */
const COMMON_YEAR = 2001;

/** The names of the days of the week, from Sunday. */
const WEEKDAY_NAMES: readonly string[] = [
	'SU',
	'MO',
	'TU',
	'WE',
	'TH',
	'FR',
	'SA',
];

/** One month that the onset of a repeating change reaches. */
export interface RepeatPattern {
	/** The month, from 1 for January through 12 for December. */
	readonly month: number;
	/**
	 * The days of that month that the onset can take. The value is absent
	 * where the rule names the last weekday of the month.
	 */
	readonly days: readonly number[] | undefined;
	/** The weekday part of the rule, absent where the rule names a day. */
	readonly byday: string | undefined;
}

/**
 * The onset of one repeating change in one year, in seconds from the start
 * of 1970 on the wall clock that runs before the change.
 */
export function repeatOnset(change: TerminalChange, year: number): number {
	const day = dayOfMonth(year, change.month, change.day);
	return civilSeconds(year, change.month, day) + change.wallSeconds;
}

/**
 * Every month that the onset of one repeating change reaches, in the order
 * in which the onset reaches them.
 */
export function repeatPatterns(
	change: TerminalChange,
): readonly RepeatPattern[] {
	return repeatPatternsOfYear(change, COMMON_YEAR);
}

/**
 * The patterns that one year gives. `repeatPatterns` reads the year that
 * this module states. A pattern that names a day at the end of February
 * differs between a leap year and every other year. A test compares the
 * two kinds of year over every repeating change of the table.
 */
export function repeatPatternsOfYear(
	change: TerminalChange,
	year: number,
): readonly RepeatPattern[] {
	const shift = Math.floor(change.wallSeconds / DAY_SECONDS);
	if (shift === 0 && change.day.kind === 'last') {
		return [
			{
				month: change.month,
				days: undefined,
				byday: `-1${weekdayName(change.day.weekday)}`,
			},
		];
	}
	const byday =
		change.day.kind === 'fixed'
			? undefined
			: weekdayName(shifted(change.day.weekday, shift));
	const months = new Map<number, number[]>();
	for (const day of ruleWindow(change.month, change.day, year)) {
		const moved = movedDay(change.month, day, shift, year);
		const days = months.get(moved.month);
		if (days === undefined) {
			months.set(moved.month, [moved.day]);
		} else {
			days.push(moved.day);
		}
	}
	return [...months].map(([month, days]) => ({ month, days, byday }));
}

/** The repeat rule of one pattern. */
export function repeatRule(pattern: RepeatPattern): JCalRecur {
	const days = pattern.days;
	return {
		freq: 'YEARLY',
		...(pattern.byday === undefined ? {} : { byday: pattern.byday }),
		...(days === undefined
			? {}
			: { bymonthday: days.length === 1 ? (days[0] ?? 1) : days }),
		bymonth: pattern.month,
	};
}

/**
 * Every day of the month that the rule of a change can name. A rule that
 * names a weekday reaches a window of seven days, and a rule that names
 * one day of the month reaches that day alone. A window can reach past the
 * end of the month, or before the start of it. The day of the onset then
 * falls in the month beside this one.
 */
function ruleWindow(
	month: number,
	day: RuleDay,
	year: number,
): readonly number[] {
	if (day.kind === 'fixed') {
		return [day.day];
	}
	if (day.kind === 'last') {
		const length = daysInMonth(year, month);
		return span(length - 6, length);
	}
	return day.kind === 'onOrAfter'
		? span(day.day, day.day + 6)
		: span(day.day - 6, day.day);
}

/** The day that stands the given number of days after another day. */
function movedDay(
	month: number,
	day: number,
	shift: number,
	year: number,
): { readonly month: number; readonly day: number } {
	const when = civilDateTime(
		civilSeconds(year, month, day) + shift * DAY_SECONDS,
	);
	return { month: when.month, day: when.day };
}

/** The weekday that stands the given number of days after another weekday. */
function shifted(weekday: number, shift: number): number {
	return (((weekday + shift) % 7) + 7) % 7;
}

function weekdayName(weekday: number): string {
	return WEEKDAY_NAMES[weekday] ?? 'SU';
}

function span(from: number, to: number): readonly number[] {
	const list: number[] = [];
	for (let value = from; value <= to; value += 1) {
		list.push(value);
	}
	return list;
}
