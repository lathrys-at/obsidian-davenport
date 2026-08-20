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
 */

interface Unit {
	readonly letter: string;
	readonly seconds: number;
}

/** The units, from the longest to the shortest. */
const UNITS: readonly Unit[] = [
	{ letter: 'w', seconds: 604800 },
	{ letter: 'd', seconds: 86400 },
	{ letter: 'h', seconds: 3600 },
	{ letter: 'm', seconds: 60 },
	{ letter: 's', seconds: 1 },
];

/** The largest count of digits that one part holds. */
const MAX_DIGITS = 9;

/** A length of time that a note states. */
export interface Duration {
	/** The length in seconds. The value is never below zero. */
	readonly seconds: number;
	/** True when the value carries a minus sign. */
	readonly negative: boolean;
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
	let seconds = 0;
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
		seconds += Number(digits) * unit.seconds;
		previous = unit;
		index += 1;
	}
	return { ok: true, value: { seconds, negative } };
}

/**
 * The same length of time in the form of the iCalendar format. The form
 * states days and a time of day. The week form of the format holds no
 * other part, so this function writes seven days in place of one week.
 */
export function icsDuration(duration: Duration): string {
	const sign = duration.negative ? '-' : '';
	const days = Math.floor(duration.seconds / 86400);
	const rest = duration.seconds - days * 86400;
	const hours = Math.floor(rest / 3600);
	const minutes = Math.floor((rest - hours * 3600) / 60);
	const seconds = rest - hours * 3600 - minutes * 60;
	const time = [
		hours > 0 ? `${String(hours)}H` : '',
		minutes > 0 ? `${String(minutes)}M` : '',
		seconds > 0 ? `${String(seconds)}S` : '',
	].join('');
	if (days > 0 && time === '') {
		return `${sign}P${String(days)}D`;
	}
	if (days === 0 && time === '') {
		return `${sign}PT0S`;
	}
	const date = days > 0 ? `${String(days)}D` : '';
	return `${sign}P${date}T${time}`;
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
