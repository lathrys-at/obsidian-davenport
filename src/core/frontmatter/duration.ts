/**
 * The short form of a length of time, as a note writes it.
 *
 * A note writes a length of time as a count and a unit, for example "30m"
 * or "1h30m". The units are w for weeks, d for days, h for hours, m for
 * minutes, and s for seconds. A capital letter reads the same as a small
 * letter.
 *
 * The rules of the form:
 *
 * - The value starts with a sign, or with no sign. A value with no sign is
 *   positive.
 * - Each part holds a count of digits and then one unit. The count is a
 *   whole number, and it holds nine digits or fewer.
 * - The parts come in the order of the units above, from the longest unit
 *   to the shortest unit. Each unit comes one time or no time.
 * - A value holds at least one part.
 *
 * A reader of a note needs to know which rule a value breaks, so this
 * module reports the place of the fault and not one refusal for every
 * fault.
 *
 * The iCalendar format writes a length of time in another form. This
 * module also writes that form, so that one length of time reaches the
 * server with the meaning that the note gives it.
 *
 * The two formats hold two kinds of length, and the difference is not a
 * matter of spelling. A day and a week are nominal: the clock can change
 * inside them, so one day is 23, 24 or 25 hours of real time. An hour, a
 * minute and a second are exact. `24h` and `1d` therefore name different
 * lengths, and the two differ by one hour across a change of the clock.
 *
 * A value of this module therefore keeps the count of each unit that the
 * note wrote. The writer of the calendar form writes the same units back.
 * A note that states hours reaches the server as hours, and a note that
 * states days reaches the server as days.
 */

/** The name of one unit of a length of time. */
type UnitName = 'weeks' | 'days' | 'hours' | 'minutes' | 'seconds';

interface Unit {
	readonly letter: string;
	readonly name: UnitName;
	/** The seconds of one of this unit, where every day holds 24 hours. */
	readonly seconds: number;
}

/** The units, from the longest to the shortest. */
const UNITS: readonly Unit[] = [
	{ letter: 'w', name: 'weeks', seconds: 604800 },
	{ letter: 'd', name: 'days', seconds: 86400 },
	{ letter: 'h', name: 'hours', seconds: 3600 },
	{ letter: 'm', name: 'minutes', seconds: 60 },
	{ letter: 's', name: 'seconds', seconds: 1 },
];

/** The largest count of digits that one part holds. */
const MAX_DIGITS = 9;

/**
 * A length of time that a note states. The value holds the count of each
 * unit that the note wrote, and a unit that the note did not write holds
 * zero. A reader that needs one number calls `durationSeconds`.
 */
export interface Duration {
	/** True when the value carries a minus sign. */
	readonly negative: boolean;
	readonly weeks: number;
	readonly days: number;
	readonly hours: number;
	readonly minutes: number;
	readonly seconds: number;
}

/** A length of time that states no unit. */
const NOTHING: Duration = {
	negative: false,
	weeks: 0,
	days: 0,
	hours: 0,
	minutes: 0,
	seconds: 0,
};

/**
 * The length in seconds, where every day holds 24 hours and every week
 * holds 7 days. The sign of the value does not reach this number. A
 * caller that compares a length against zero reads this number. A caller
 * that computes a time from a length must not read it, because a day of
 * the calendar can hold 23 hours or 25 hours.
 */
export function durationSeconds(duration: Duration): number {
	return UNITS.reduce(
		(total, unit) => total + duration[unit.name] * unit.seconds,
		0,
	);
}

/** Why the plugin cannot read a length of time. */
export type DurationFailure =
	| { readonly kind: 'empty' }
	/** The value ends with a count that states no unit. */
	| { readonly kind: 'no-unit'; readonly count: string }
	/** The value holds a character that names no unit. */
	| { readonly kind: 'unknown-unit'; readonly text: string }
	/** A unit stands with no count in front of it. */
	| { readonly kind: 'no-count'; readonly unit: string }
	| { readonly kind: 'repeated-unit'; readonly unit: string }
	/** A unit stands after a unit that is shorter than it. */
	| {
			readonly kind: 'unit-order';
			readonly unit: string;
			readonly after: string;
	  }
	/** A count holds more digits than the plugin reads. */
	| { readonly kind: 'too-large'; readonly count: string };

export type DurationResult =
	| { readonly ok: true; readonly value: Duration }
	| { readonly ok: false; readonly failure: DurationFailure };

/** The length of time that this text states. */
export function parseDuration(text: string): DurationResult {
	let index = 0;
	let negative = false;
	if (text.startsWith('+') || text.startsWith('-')) {
		negative = text.startsWith('-');
		index = 1;
	}
	if (index === text.length) {
		return { ok: false, failure: { kind: 'empty' } };
	}
	const counts: Record<UnitName, number> = {
		weeks: 0,
		days: 0,
		hours: 0,
		minutes: 0,
		seconds: 0,
	};
	let previous: Unit | null = null;
	while (index < text.length) {
		const digits = digitsAt(text, index);
		index += digits.length;
		const character = text.slice(index, index + 1);
		if (character === '') {
			return { ok: false, failure: { kind: 'no-unit', count: digits } };
		}
		const letter = character.toLowerCase();
		const unit = UNITS.find((candidate) => candidate.letter === letter);
		if (unit === undefined) {
			return {
				ok: false,
				failure: { kind: 'unknown-unit', text: character },
			};
		}
		if (digits.length === 0) {
			return { ok: false, failure: { kind: 'no-count', unit: letter } };
		}
		if (digits.length > MAX_DIGITS) {
			return { ok: false, failure: { kind: 'too-large', count: digits } };
		}
		if (previous !== null && previous.letter === letter) {
			return {
				ok: false,
				failure: { kind: 'repeated-unit', unit: letter },
			};
		}
		if (previous !== null && previous.seconds < unit.seconds) {
			return {
				ok: false,
				failure: {
					kind: 'unit-order',
					unit: letter,
					after: previous.letter,
				},
			};
		}
		counts[unit.name] = Number(digits);
		previous = unit;
		index += 1;
	}
	return { ok: true, value: { ...NOTHING, ...counts, negative } };
}

/**
 * The same length of time in the form of the iCalendar format. The
 * function writes the same units that the note wrote, so a length that
 * the note states in hours stays a length in hours.
 *
 * The week form of the format holds no other part. Therefore a value of
 * weeks alone writes a week, and a value of weeks with another part writes
 * seven days for each week. Both forms state the same count of nominal
 * days.
 */
export function icsDuration(duration: Duration): string {
	const sign = duration.negative ? '-' : '';
	const time = [
		part(duration.hours, 'H'),
		part(duration.minutes, 'M'),
		part(duration.seconds, 'S'),
	].join('');
	if (duration.weeks > 0 && duration.days === 0 && time === '') {
		return `${sign}P${String(duration.weeks)}W`;
	}
	const days = duration.weeks * 7 + duration.days;
	if (time === '') {
		return days > 0 ? `${sign}P${String(days)}D` : `${sign}PT0S`;
	}
	return `${sign}P${days > 0 ? `${String(days)}D` : ''}T${time}`;
}

function part(count: number, letter: string): string {
	return count > 0 ? `${String(count)}${letter}` : '';
}

function digitsAt(text: string, start: number): string {
	let end = start;
	while (end < text.length && isDigit(text.charCodeAt(end))) {
		end += 1;
	}
	return text.slice(start, end);
}

function isDigit(code: number): boolean {
	return code >= 48 && code <= 57;
}
