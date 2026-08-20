/**
 * The date forms and the date-time forms of ISO 8601 that a note writes.
 *
 * A note states a day as "2026-03-14". A note states a day with a time of
 * day as "2026-03-14T09:00", and it can add the seconds. The letter T can
 * be a capital letter or a small letter.
 *
 * A date-time states an offset from universal time, or it states no
 * offset. The forms of an offset are "Z" for universal time, "+09:00",
 * "+0900", and "+09". A date-time with no offset states a wall time, and
 * the zone of that wall time comes from another key. This module reports
 * what the text holds, and it never gives a time an offset of its own.
 *
 * The module reads no clock. It converts nothing to another zone. It
 * refuses two forms that a reader could take for a time of the vault:
 *
 * - a fraction of a second, because the calendar format holds whole
 *   seconds only, and a plugin that removes the fraction loses what the
 *   user wrote;
 * - a year below 1000, because the date functions of the host read a year
 *   below 100 as a year of the twentieth century, and the plugin would
 *   then compute the wrong day.
 */

import { daysInMonth } from '../timezone/calendar';

/** One day of the calendar. */
export interface CivilDate {
	readonly year: number;
	/** The month, from 1 for January through 12 for December. */
	readonly month: number;
	readonly day: number;
}

/** One time of a day. */
export interface CivilTime {
	readonly hour: number;
	readonly minute: number;
	readonly second: number;
}

/**
 * What the text of a date key or a date-time key holds. A value of the
 * kind `date-time` states an offset in seconds, or null where the text
 * states no offset.
 */
export type IsoValue =
	| { readonly kind: 'date'; readonly date: CivilDate }
	| {
			readonly kind: 'date-time';
			readonly date: CivilDate;
			readonly time: CivilTime;
			readonly offsetSeconds: number | null;
	  };

/** Why the plugin cannot read a date or a date-time. */
export type IsoFailure =
	| { readonly kind: 'empty' }
	/** The text does not follow the form of a date or of a date-time. */
	| { readonly kind: 'shape' }
	/** The text states a fraction of a second. */
	| { readonly kind: 'fraction' }
	/** The year is below 1000. */
	| { readonly kind: 'year-range'; readonly year: number }
	/** The calendar has no such day, for example the 30th of February. */
	| { readonly kind: 'no-such-day'; readonly date: CivilDate }
	/** The clock has no such time of day. */
	| { readonly kind: 'no-such-time'; readonly time: CivilTime }
	/** The offset states more hours or more minutes than an offset holds. */
	| { readonly kind: 'offset-range'; readonly text: string };

export type IsoResult =
	| { readonly ok: true; readonly value: IsoValue }
	| { readonly ok: false; readonly failure: IsoFailure };

/** The smallest year that the plugin reads. */
export const MIN_YEAR = 1000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME =
	/^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}(?::(\d{2}))?(\.\d+)?([Zz]|[+-]\d{2}(?::?\d{2})?)?$/;

/** The day, or the day and the time, that this text states. */
export function parseIsoValue(text: string): IsoResult {
	if (text.length === 0) {
		return { ok: false, failure: { kind: 'empty' } };
	}
	if (DATE.test(text)) {
		const date = readDate(text);
		const failure = dateFailure(date);
		return failure === null
			? { ok: true, value: { kind: 'date', date } }
			: { ok: false, failure };
	}
	const stamp = DATE_TIME.exec(text);
	if (stamp === null) {
		return { ok: false, failure: { kind: 'shape' } };
	}
	if (stamp[2] !== undefined) {
		return { ok: false, failure: { kind: 'fraction' } };
	}
	const date = readDate(text);
	const dayFailure = dateFailure(date);
	if (dayFailure !== null) {
		return { ok: false, failure: dayFailure };
	}
	const seconds = stamp[1];
	const time = {
		hour: Number(text.slice(11, 13)),
		minute: Number(text.slice(14, 16)),
		second: seconds === undefined ? 0 : Number(seconds),
	};
	if (time.hour > 23 || time.minute > 59 || time.second > 59) {
		return { ok: false, failure: { kind: 'no-such-time', time } };
	}
	const zone = stamp[3];
	if (zone === undefined) {
		return {
			ok: true,
			value: { kind: 'date-time', date, time, offsetSeconds: null },
		};
	}
	const offsetSeconds = readOffset(zone);
	if (offsetSeconds === null) {
		return { ok: false, failure: { kind: 'offset-range', text: zone } };
	}
	return {
		ok: true,
		value: { kind: 'date-time', date, time, offsetSeconds },
	};
}

/** The offset in seconds, or null where the text states no such offset. */
function readOffset(text: string): number | null {
	if (text === 'Z' || text === 'z') {
		return 0;
	}
	const digits = text.slice(1).replace(':', '');
	const hours = Number(digits.slice(0, 2));
	const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
	if (hours > 23 || minutes > 59) {
		return null;
	}
	const seconds = hours * 3600 + minutes * 60;
	// The format states an offset of zero with a sign of either kind, and
	// the two state one offset. A minus sign in front of zero would give
	// the number type its own negative zero, which reads as another value.
	if (seconds === 0) {
		return 0;
	}
	return text.startsWith('-') ? -seconds : seconds;
}

function readDate(text: string): CivilDate {
	return {
		year: Number(text.slice(0, 4)),
		month: Number(text.slice(5, 7)),
		day: Number(text.slice(8, 10)),
	};
}

function dateFailure(date: CivilDate): IsoFailure | null {
	if (date.year < MIN_YEAR) {
		return { kind: 'year-range', year: date.year };
	}
	if (date.month < 1 || date.month > 12) {
		return { kind: 'no-such-day', date };
	}
	if (date.day < 1 || date.day > daysInMonth(date.year, date.month)) {
		return { kind: 'no-such-day', date };
	}
	return null;
}
