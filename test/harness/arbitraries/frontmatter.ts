/**
 * Generators of note frontmatter for the property tests.
 *
 * The plugin reads the frontmatter of a note as a plain map of keys. The
 * app hands that map over, and every value in it comes from a person who
 * typed it. The generators here draw two kinds of map.
 *
 * The first kind is a note that the reader accepts whole. Every key holds
 * a legal value, the two keys of a shape agree with each other, and the
 * reader states no fault. A property test uses such a note to ask whether
 * a read and a write give the note back.
 *
 * The second kind is a note with one fault. The fault sits under one named
 * key, and the generator says which key that is. A property test uses such
 * a note to ask whether the reader states a fault that names the key, and
 * whether the reader states it without throwing an error.
 *
 * The values keep to the grammar that the schema states:
 *
 * - A day is four digits, a month of two digits, and a day of two digits.
 * - A time of day carries the day in front of it. It can carry seconds, it
 *   can carry the mark of universal time, and it can carry an offset.
 * - A length of time is a count and a unit, and the units go from the
 *   largest to the smallest with no unit twice.
 *
 * The generator of a note that ends after it starts computes the end from
 * the start. It reads no clock to do so: it builds a count of milliseconds
 * from the parts of the start, adds a length of time, and reads the parts
 * of the result back. The ban on the ambient clock covers the reading of
 * the wall clock, and it leaves this arithmetic alone.
 */

import fc from 'fast-check';
import type { SchemaKey } from '../../../src/core/frontmatter/keys';
import { SCHEMA_KEYS } from '../../../src/core/frontmatter/keys';
import type { Raw } from '../../../src/core/frontmatter/reader';
import { knownTimezoneNames } from '../../../src/core/timezone/names';

/** A note with one fault, and the key that carries the fault. */
export interface FaultyNote {
	readonly raw: Raw;
	/** The key that the reader must name in a fault. */
	readonly names: SchemaKey;
	/** What makes the note faulty. A failure report shows this text. */
	readonly why: string;
}

/**
 * The keys that the reader reads. The reader passes over `uid`, so a value
 * under that key states nothing and can state nothing wrong.
 */
export const READ_KEYS: readonly SchemaKey[] = SCHEMA_KEYS.filter(
	(key) => key !== 'uid',
);

const FIRST_YEAR = 1900;
const LAST_YEAR = 2098;
const DAY_IN_MILLISECONDS = 86_400_000;

/** The units of a length of time, from the largest to the smallest. */
const DURATION_UNITS = ['w', 'd', 'h', 'm', 's'] as const;

/** The words that each key of a word takes. */
export const WORD_VOCABULARIES = {
	state: ['draft', 'ready'],
	type: ['event', 'task', 'block'],
	rsvp: ['accepted', 'declined', 'tentative'],
	class: ['public', 'private', 'confidential'],
	transp: ['opaque', 'transparent'],
	status: ['tentative', 'confirmed', 'cancelled'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

function twoDigits(value: number): string {
	return String(value).padStart(2, '0');
}

function fourDigits(value: number): string {
	return String(value).padStart(4, '0');
}

/** The day that a count of milliseconds falls on, in universal time. */
function dayTextOf(milliseconds: number): string {
	const stamp = new Date(milliseconds);
	return `${fourDigits(stamp.getUTCFullYear())}-${twoDigits(stamp.getUTCMonth() + 1)}-${twoDigits(stamp.getUTCDate())}`;
}

/** The day and the time of day that a count of milliseconds states. */
function stampTextOf(
	milliseconds: number,
	seconds: boolean,
	offset: string,
): string {
	const stamp = new Date(milliseconds);
	const clock = `${twoDigits(stamp.getUTCHours())}:${twoDigits(stamp.getUTCMinutes())}`;
	const tail = seconds ? `:${twoDigits(stamp.getUTCSeconds())}` : '';
	return `${dayTextOf(milliseconds)}T${clock}${tail}${offset}`;
}

/** A count of milliseconds that falls inside the years above. */
function instant(): fc.Arbitrary<number> {
	return fc
		.tuple(
			fc.integer({ min: FIRST_YEAR, max: LAST_YEAR }),
			fc.integer({ min: 1, max: 12 }),
			fc.integer({ min: 1, max: 28 }),
			fc.integer({ min: 0, max: 23 }),
			fc.integer({ min: 0, max: 59 }),
			fc.integer({ min: 0, max: 59 }),
		)
		.map(([year, month, day, hour, minute, second]) =>
			Date.UTC(year, month - 1, day, hour, minute, second),
		);
}

/** The text that states an offset from universal time, or no offset. */
function offsetText(): fc.Arbitrary<string> {
	return fc.oneof(
		fc.constant(''),
		fc.constant('Z'),
		fc
			.tuple(
				fc.constantFrom('+', '-'),
				fc.integer({ min: 0, max: 23 }),
				fc.constantFrom(0, 15, 30, 45),
				fc.constantFrom(':', '', 'hours only'),
			)
			.map(([sign, hours, minutes, shape]) => {
				if (shape === 'hours only') {
					return `${sign}${twoDigits(hours)}`;
				}
				return `${sign}${twoDigits(hours)}${shape}${twoDigits(minutes)}`;
			}),
	);
}

/** A day, as the schema states one. */
export function dayText(): fc.Arbitrary<string> {
	return instant().map(dayTextOf);
}

/** A day with a time of day, as the schema states one. */
export function stampText(): fc.Arbitrary<string> {
	return fc
		.tuple(instant(), fc.boolean(), offsetText())
		.map(([milliseconds, seconds, offset]) =>
			stampTextOf(milliseconds, seconds, offset),
		);
}

/**
 * A length of time, as the schema states one. The units go from the
 * largest to the smallest, and no unit stands two times. The count of each
 * unit is one or more, so the whole length is more than nothing.
 */
export function durationText(): fc.Arbitrary<string> {
	const count = fc.integer({ min: 1, max: 999 });
	return fc
		.tuple(
			fc.uniqueArray(fc.constantFrom(...DURATION_UNITS), {
				minLength: 1,
				maxLength: DURATION_UNITS.length,
			}),
			fc.array(count, {
				minLength: DURATION_UNITS.length,
				maxLength: DURATION_UNITS.length,
			}),
		)
		.map(([units, counts]) =>
			DURATION_UNITS.filter((unit) => units.includes(unit))
				.map((unit, index) => `${String(counts[index] ?? 1)}${unit}`)
				.join(''),
		);
}

/** A length of time that a sign can stand in front of. */
export function alarmText(): fc.Arbitrary<string> {
	return fc
		.tuple(fc.constantFrom('', '-', '+'), durationText())
		.map(([sign, text]) => `${sign}${text}`);
}

/** A word of text that the reader accepts under a key of text. */
function words(): fc.Arbitrary<string> {
	return fc
		.string({ minLength: 1, maxLength: 24 })
		.filter((text) => text.trim().length > 0);
}

/** The schedule of a note, in one of the two shapes. */
function schedule(): fc.Arbitrary<Raw> {
	const timed = fc
		.tuple(
			instant(),
			fc.boolean(),
			offsetText(),
			fc.integer({ min: 1, max: 86_399 }),
			fc.constantFrom('start alone', 'with end', 'with duration'),
			durationText(),
		)
		.map(([start, seconds, offset, gap, shape, length]) => {
			const startText = stampTextOf(start, seconds, offset);
			if (shape === 'with end') {
				// A text without seconds states the same time of day for
				// every second of one minute. The gap is therefore a whole
				// minute where the text drops the seconds, so that the end
				// always stands after the start in the text as well.
				const step = seconds ? 1000 : 60_000;
				return {
					start: startText,
					end: stampTextOf(start + gap * step, seconds, offset),
				};
			}
			return shape === 'with duration'
				? { start: startText, duration: length }
				: { start: startText };
		});
	const allDay = fc
		.tuple(instant(), fc.option(fc.integer({ min: 0, max: 400 })))
		.map(([day, span]) =>
			span === null
				? { date: dayTextOf(day) }
				: {
						date: dayTextOf(day),
						endDate: dayTextOf(day + span * DAY_IN_MILLISECONDS),
					},
		);
	return fc.oneof<fc.Arbitrary<Raw>[]>(timed, allDay);
}

/** The keys that stand beside the schedule, each one optional. */
function otherKeys(): fc.Arbitrary<Raw> {
	return fc.record(
		{
			uid: words(),
			state: fc.constantFrom(...WORD_VOCABULARIES.state),
			calendar: words(),
			summary: words(),
			timezone: fc.constantFrom(...knownTimezoneNames()),
			rrule: words(),
			type: fc.constantFrom(...WORD_VOCABULARIES.type),
			task: words(),
			due: fc.oneof(dayText(), stampText()),
			completed: stampText(),
			priority: fc.integer({ min: 0, max: 9 }),
			rsvp: fc.constantFrom(...WORD_VOCABULARIES.rsvp),
			description: words(),
			attachments: fc.array(words(), { maxLength: 3 }),
			alarm: alarmText(),
			location: words(),
			categories: fc.array(words(), { maxLength: 3 }),
			class: fc.constantFrom(...WORD_VOCABULARIES.class),
			transp: fc.constantFrom(...WORD_VOCABULARIES.transp),
			status: fc.constantFrom(...WORD_VOCABULARIES.status),
		},
		{ requiredKeys: [] },
	);
}

/**
 * A note that the reader accepts whole. One note in five holds the
 * schedule and nothing else. A note of that shape is what a person writes
 * first, and a generator that drew each key on its own chance would almost
 * never reach it.
 */
export function validNote(): fc.Arbitrary<Raw> {
	return fc
		.tuple(
			schedule(),
			fc.oneof(
				{ arbitrary: otherKeys(), weight: 4 },
				{ arbitrary: fc.constant<Raw>({}), weight: 1 },
			),
		)
		.map(([times, rest]) => ({ ...rest, ...times }));
}

/** A value of a kind that no key of the schema takes. */
function wrongKind(): fc.Arbitrary<unknown> {
	return fc.oneof<fc.Arbitrary<unknown>[]>(
		fc.constant(null),
		fc.constant(''),
		fc.constant(42),
		fc.constant(true),
		fc.constant({ nested: 'map' }),
	);
}

/** A day or a time of day that the schema does not state. */
function badStamp(): fc.Arbitrary<unknown> {
	return fc.oneof<fc.Arbitrary<unknown>[]>(
		fc.constant('2026-3-14'),
		fc.constant('2026-02-30'),
		fc.constant('2026-03-14T09:00:00.5'),
		fc.constant('2026-03-14T09:00:00+9:00'),
		fc.constant('2026-03-14T25:00'),
		fc.constant('0099-01-01T00:00'),
		fc.constant('tomorrow'),
		wrongKind(),
	);
}

/** A length of time that the schema does not state. */
function badDuration(): fc.Arbitrary<unknown> {
	return fc.oneof<fc.Arbitrary<unknown>[]>(
		fc.constant('30'),
		fc.constant('30x'),
		fc.constant('30 m'),
		fc.constant('1m1m'),
		fc.constant('1s1h'),
		fc.constant('1234567890h'),
		fc.constant('h'),
		wrongKind(),
	);
}

/** The values that make one key faulty, by key. */
function faultyValue(key: SchemaKey): fc.Arbitrary<unknown> {
	if (key === 'start' || key === 'end' || key === 'completed') {
		return fc.oneof<fc.Arbitrary<unknown>[]>(
			badStamp(),
			fc.constant('2026-03-14'),
		);
	}
	if (key === 'date' || key === 'endDate') {
		return fc.oneof<fc.Arbitrary<unknown>[]>(
			badStamp(),
			fc.constant('2026-03-14T09:00'),
		);
	}
	if (key === 'due') {
		return badStamp();
	}
	if (key === 'duration' || key === 'alarm') {
		return badDuration();
	}
	if (key === 'priority') {
		return fc.oneof<fc.Arbitrary<unknown>[]>(
			fc.constant(-1),
			fc.constant(10),
			fc.constant(5.5),
			fc.constant('5'),
			wrongKind(),
		);
	}
	if (key === 'attachments' || key === 'categories') {
		return fc.oneof<fc.Arbitrary<unknown>[]>(
			fc.constant('one'),
			fc.constant(7),
			fc.constant(null),
		);
	}
	if (key in WORD_VOCABULARIES) {
		return fc.oneof<fc.Arbitrary<unknown>[]>(
			fc.constant('neither'),
			fc.constant('Draft'),
			wrongKind(),
		);
	}
	return wrongKind();
}

/**
 * The keys that carry a fault of their own value. A key of a schedule
 * needs the other keys of its shape around it, so those keys come from the
 * note that the generator starts from.
 */
const VALUE_KEYS: readonly SchemaKey[] = READ_KEYS.filter(
	(key) => key !== 'date' && key !== 'endDate' && key !== 'end',
);

/** A note that holds one faulty value under one key. */
export function noteWithOneFault(): fc.Arbitrary<FaultyNote> {
	return fc
		.tuple(validNote(), fc.constantFrom(...VALUE_KEYS))
		.chain(([note, key]) =>
			faultyValue(key).map((value) => ({
				raw: { ...note, [key]: value },
				names: key,
				why: `the key ${key} holds the value ${JSON.stringify(value)}`,
			})),
		);
}

/** A note whose two keys contradict each other. */
export function noteWithContradiction(): fc.Arbitrary<FaultyNote> {
	return fc.oneof<fc.Arbitrary<FaultyNote>[]>(
		fc.tuple(stampText(), dayText()).map(([start, date]) => ({
			raw: { start, date },
			names: 'date',
			why: 'the note states a day and a start',
		})),
		fc
			.tuple(stampText(), stampText(), durationText())
			.map(([start, end, duration]) => ({
				raw: { start, end, duration },
				names: 'end',
				why: 'the note states an end two times',
			})),
		fc.tuple(stampText()).map(([end]) => ({
			raw: { end },
			names: 'end',
			why: 'the note states an end and no start',
		})),
		fc.tuple(durationText()).map(([duration]) => ({
			raw: { duration },
			names: 'duration',
			why: 'the note states a length of time and no start',
		})),
		fc.tuple(dayText()).map(([endDate]) => ({
			raw: { endDate },
			names: 'endDate',
			why: 'the note states a last day and no day',
		})),
		fc
			.tuple(instant(), fc.integer({ min: 1, max: 86_399 }))
			.map(([start, gap]) => ({
				raw: {
					start: stampTextOf(start, true, 'Z'),
					end: stampTextOf(start - gap * 1000, true, 'Z'),
				},
				names: 'end',
				why: 'the note ends before it starts',
			})),
		fc
			.tuple(instant(), fc.integer({ min: 1, max: 400 }))
			.map(([day, span]) => ({
				raw: {
					date: dayTextOf(day),
					endDate: dayTextOf(day - span * DAY_IN_MILLISECONDS),
				},
				names: 'endDate',
				why: 'the note ends on a day before its first day',
			})),
	);
}
