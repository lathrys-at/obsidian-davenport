/**
 * What the plugin found wrong in the frontmatter of a note, and the words
 * that state it to the user.
 *
 * Each problem names the key or the keys that it is about. A problem that
 * comes from two keys together names both of them, because the user must
 * see which two keys disagree. The plugin never chooses one of the two
 * keys and continues.
 *
 * A message states the fault and then the action that corrects it. A
 * message holds no jargon and no number that only a programmer reads.
 */

import type { DurationFailure } from './duration';
import type { IsoFailure } from './datetime';
import type { SchemaKey } from './keys';

/** A key that the plugin owns, or a pair of such keys. */
type Keys = readonly SchemaKey[];

/**
 * One fault in the frontmatter of a note. Every kind of fault names its
 * keys, so a caller can list the faults of a note against the fields that
 * hold them.
 */
export type FrontmatterProblem =
	/** The note holds a key of each shape of a schedule. */
	| { readonly kind: 'shape-conflict'; readonly keys: Keys }
	/** The note states the end of an event two times. */
	| { readonly kind: 'end-conflict'; readonly keys: Keys }
	/** A key needs another key, and the note holds only the first one. */
	| {
			readonly kind: 'anchor-missing';
			readonly keys: Keys;
			readonly key: SchemaKey;
			readonly needs: SchemaKey;
	  }
	/**
	 * A key of one shape stands beside the first key of the other shape.
	 * The key that the note holds names the shape of the note, and the
	 * other key belongs to the shape that the note does not take.
	 */
	| {
			readonly kind: 'shape-mismatch';
			readonly keys: Keys;
			readonly key: SchemaKey;
			/** The first key of the shape that the note takes. */
			readonly held: SchemaKey;
			/** The key of that shape for the same purpose, where one exists. */
			readonly use: SchemaKey | null;
	  }
	/** The key holds a value that is not text. */
	| {
			readonly kind: 'not-text';
			readonly keys: Keys;
			readonly key: SchemaKey;
			readonly found: string;
	  }
	/** The key holds nothing. */
	| {
			readonly kind: 'empty-value';
			readonly keys: Keys;
			readonly key: SchemaKey;
	  }
	/** The key holds a value that is not a list. */
	| {
			readonly kind: 'not-a-list';
			readonly keys: Keys;
			readonly key: SchemaKey;
	  }
	/** The key holds a value that is not a whole number. */
	| {
			readonly kind: 'not-a-number';
			readonly keys: Keys;
			readonly key: SchemaKey;
			readonly found: string;
	  }
	/** The key holds a number outside the range that the key takes. */
	| {
			readonly kind: 'number-range';
			readonly keys: Keys;
			readonly key: SchemaKey;
			readonly value: number;
			readonly low: number;
			readonly high: number;
	  }
	/** The key holds a word that is not in the list of the key. */
	| {
			readonly kind: 'unknown-value';
			readonly keys: Keys;
			readonly key: SchemaKey;
			readonly value: string;
			readonly permitted: readonly string[];
	  }
	/** The plugin cannot read the day, or the day and the time. */
	| {
			readonly kind: 'bad-time';
			readonly keys: Keys;
			readonly key: SchemaKey;
			readonly text: string;
			readonly failure: IsoFailure;
	  }
	/** A key of the timed shape holds a day with no time of day. */
	| {
			readonly kind: 'time-of-day-missing';
			readonly keys: Keys;
			readonly key: SchemaKey;
			readonly text: string;
	  }
	/**
	 * A key that states a time of day holds a date value, and not text.
	 * The parser of the note editor made that value.
	 */
	| {
			readonly kind: 'time-not-text';
			readonly keys: Keys;
			readonly key: SchemaKey;
	  }
	/** A key of the all-day shape holds a time of day. */
	| {
			readonly kind: 'time-of-day-refused';
			readonly keys: Keys;
			readonly key: SchemaKey;
			readonly text: string;
	  }
	/** The plugin cannot read the length of time. */
	| {
			readonly kind: 'bad-duration';
			readonly keys: Keys;
			readonly key: SchemaKey;
			readonly text: string;
			readonly failure: DurationFailure;
	  }
	/** The length of time is zero or less. */
	| {
			readonly kind: 'duration-not-positive';
			readonly keys: Keys;
			readonly key: SchemaKey;
	  }
	/** The event stops before it starts. */
	| {
			readonly kind: 'end-before-start';
			readonly keys: Keys;
			readonly start: SchemaKey;
			readonly end: SchemaKey;
	  }
	/** The bundled timezone table holds no rules for this name. */
	| {
			readonly kind: 'unknown-timezone';
			readonly keys: Keys;
			readonly key: SchemaKey;
			readonly name: string;
	  }
	/** The default timezone of the calendar is not a name of the table. */
	| {
			readonly kind: 'unknown-calendar-timezone';
			readonly keys: Keys;
			readonly name: string;
	  }
	/** No timezone resolves for a time that states no offset. */
	| {
			readonly kind: 'timezone-missing';
			readonly keys: Keys;
			readonly key: SchemaKey;
	  };

/** The words that state one problem to the user. */
export function describeProblem(problem: FrontmatterProblem): string {
	switch (problem.kind) {
		case 'shape-conflict':
			return `The note holds the key "date" and the key "start". An event takes one of the two shapes. Use "date" for an event of whole days. Use "start" for an event with a time of day. Then remove the other key.`;
		case 'end-conflict':
			return `The note holds the key "end" and the key "duration". An event takes one of the two keys. Use "end" to state when the event stops. Use "duration" to state how long the event continues. Then remove the other key.`;
		case 'anchor-missing':
			return `The note holds the key ${quote(problem.key)} and no key ${quote(problem.needs)}. Add the key ${quote(problem.needs)}, or remove the key ${quote(problem.key)}.`;
		case 'shape-mismatch':
			return shapeMismatch(problem.key, problem.held, problem.use);
		case 'not-text':
			return `The key ${quote(problem.key)} holds ${problem.found}. The plugin reads text here. Put the value in quotation marks, or write text in place of it.`;
		case 'empty-value':
			return `The key ${quote(problem.key)} holds no value. Give the key a value, or remove the key.`;
		case 'not-a-list':
			return `The key ${quote(problem.key)} holds a value that is not a list. Write each item on a line of its own below the key.`;
		case 'not-a-number':
			return `The key ${quote(problem.key)} holds ${problem.found}. The plugin reads a whole number here.`;
		case 'number-range':
			return `The key ${quote(problem.key)} holds ${String(problem.value)}. The plugin reads a whole number from ${String(problem.low)} through ${String(problem.high)} here.`;
		case 'unknown-value':
			return `The key ${quote(problem.key)} holds ${quote(problem.value)}. The key takes one of these values: ${problem.permitted.join(', ')}.`;
		case 'bad-time':
			return `The key ${quote(problem.key)} holds ${quote(problem.text)}. ${timeFault(problem.failure)}`;
		case 'time-of-day-missing':
			return `The key ${quote(problem.key)} holds ${quote(problem.text)}, which states a day and no time of day. Add the time of day, for example 2026-03-14T09:00. For an event of whole days, use the key "date" in place of the key "start".`;
		case 'time-not-text':
			return `The key ${quote(problem.key)} holds a date value, and not text. The plugin reads the text of the note here, because that text can state an offset from universal time. Put the value in quotation marks.`;
		case 'time-of-day-refused':
			return `The key ${quote(problem.key)} holds ${quote(problem.text)}, which states a time of day. An event of whole days states days only. For an event with a time of day, use the key "start" in place of the key "date".`;
		case 'bad-duration':
			return `The key ${quote(problem.key)} holds ${quote(problem.text)}. ${durationFault(problem.failure)}`;
		case 'duration-not-positive':
			return `The key ${quote(problem.key)} states a length of zero or less. State a length of more than zero.`;
		case 'end-before-start':
			return `The key ${quote(problem.end)} does not state a time after the time of the key ${quote(problem.start)}. An event stops after it starts.`;
		case 'unknown-timezone':
			return `The key ${quote(problem.key)} holds ${quote(problem.name)}. The plugin does not know this timezone. Use a name of the IANA timezone database, for example Europe/London.`;
		case 'unknown-calendar-timezone':
			return `The key "calendar" names a calendar whose default timezone is ${quote(problem.name)}. The plugin does not know this timezone. Change the default timezone of that calendar in the settings, or add the key "timezone" to the note.`;
		case 'timezone-missing':
			return `The key ${quote(problem.key)} states a time with no offset from universal time, and no timezone resolves for that time. Add the key "timezone" with the name of a timezone, or give the calendar a default timezone. The plugin never uses the timezone of this device instead.`;
	}
}

/**
 * The words for a key of one shape that stands beside the first key of
 * the other shape. The user takes one of two ways out: the key of the
 * shape that the note takes, or the first key of the other shape.
 */
function shapeMismatch(
	key: SchemaKey,
	held: SchemaKey,
	use: SchemaKey | null,
): string {
	const shape =
		held === 'date'
			? 'An event of whole days'
			: 'An event with a time of day';
	const other = held === 'date' ? 'start' : 'date';
	const remedy =
		use === null
			? `${shape} states no length. Remove the key ${quote(key)}`
			: `${shape} states its end with the key ${quote(use)}. Use the key ${quote(use)} in place of the key ${quote(key)}`;
	return `The note holds the key ${quote(key)} and the key ${quote(held)}. ${remedy}, or use the key ${quote(other)} in place of the key ${quote(held)}.`;
}

function timeFault(failure: IsoFailure): string {
	switch (failure.kind) {
		case 'empty':
			return 'The plugin reads a day as 2026-03-14, and a day with a time of day as 2026-03-14T09:00.';
		case 'shape':
			return 'The plugin reads a day as 2026-03-14, and a day with a time of day as 2026-03-14T09:00. A time of day can also state an offset from universal time, for example 2026-03-14T09:00+01:00.';
		case 'fraction':
			return 'The plugin reads whole seconds. Remove the fraction of a second.';
		case 'year-range':
			return 'The plugin reads a year from 100. Write the year with four digits.';
		case 'no-such-day':
			return 'The calendar has no such day.';
		case 'no-such-time':
			return 'The clock has no such time of day.';
		case 'offset-range':
			return `The offset ${quote(failure.text)} states more than 23 hours, or more than 59 minutes.`;
	}
}

function durationFault(failure: DurationFailure): string {
	switch (failure.kind) {
		case 'empty':
			return `${UNITS} For example, write 30m for thirty minutes, or 1h30m for one hour and thirty minutes.`;
		case 'no-unit':
			return `The count ${quote(failure.count)} states no unit of time. ${UNITS}`;
		case 'unknown-unit':
			return `${quote(failure.text)} is not a unit of time. ${UNITS}`;
		case 'no-count':
			return `The unit ${quote(failure.unit)} stands with no count in front of it. For example, write 30m for thirty minutes.`;
		case 'repeated-unit':
			return `The unit ${quote(failure.unit)} stands two times. State each unit one time.`;
		case 'unit-order':
			return `The unit ${quote(failure.unit)} stands after the unit ${quote(failure.after)}. State the longest unit first, for example 1h30m.`;
		case 'too-large':
			return `The count ${quote(failure.count)} holds more than nine digits.`;
	}
}

const UNITS =
	'The units are w for weeks, d for days, h for hours, m for minutes, and s for seconds.';

function quote(text: string): string {
	return `"${text}"`;
}
