/**
 * The calendar arithmetic of the timezone rules.
 *
 * A timezone rule names a day in words: the last Sunday of March, or the
 * first Sunday on or after the eighth of March. This module turns such a
 * name into the day of the month, in one stated year.
 *
 * The generator of the timezone table reads this module, and so does the
 * offset lookup. The two must agree: the generator decides which changes
 * the table writes out, and the lookup decides which changes the repeating
 * pair states after them. One module for both makes the agreement hold by
 * construction.
 *
 * The module computes from its arguments alone. It reads no clock.
 *
 * A year of the argument is the whole year, and it stands at 100 or above.
 * The host reads a year below 100 as a year of the twentieth century, so
 * the year 50 would give 1950. The rules of a timezone reach back to the
 * nineteenth century and no further. The table starts in 1970. No caller
 * of this module therefore reaches that range.
 */

/**
 * The day of a month that a rule names. A weekday is 0 for Sunday through
 * 6 for Saturday.
 */
export type RuleDay =
	| { readonly kind: 'fixed'; readonly day: number }
	| { readonly kind: 'last'; readonly weekday: number }
	| {
			readonly kind: 'onOrAfter';
			readonly weekday: number;
			readonly day: number;
	  }
	| {
			readonly kind: 'onOrBefore';
			readonly weekday: number;
			readonly day: number;
	  };

/** The day of the month that a rule names, in the given year. */
export function dayOfMonth(year: number, month: number, day: RuleDay): number {
	if (day.kind === 'fixed') {
		return day.day;
	}
	if (day.kind === 'last') {
		const last = daysInMonth(year, month);
		return last - stepBack(weekdayOf(year, month, last), day.weekday);
	}
	if (day.kind === 'onOrAfter') {
		return day.day + stepBack(day.weekday, weekdayOf(year, month, day.day));
	}
	return day.day - stepBack(weekdayOf(year, month, day.day), day.weekday);
}

/** The seconds from the start of 1970 to the start of one civil day. */
export function civilSeconds(year: number, month: number, day: number): number {
	return Date.UTC(year, month - 1, day) / 1000;
}

/** The year that holds one instant. */
export function yearOf(instant: number): number {
	return new Date(instant * 1000).getUTCFullYear();
}

/** The weekday of one civil day, 0 for Sunday through 6 for Saturday. */
export function weekdayOf(year: number, month: number, day: number): number {
	return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The count of days in one month. */
export function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The count of days from one weekday back to another. */
function stepBack(from: number, to: number): number {
	return (from - to + 7) % 7;
}
