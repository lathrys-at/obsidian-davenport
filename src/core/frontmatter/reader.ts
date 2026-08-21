/**
 * The reader of one key of the frontmatter.
 *
 * The reader takes the object that the platform gives for one note, and it
 * reads one key of that object at a time. Each method states what the key
 * holds, or it keeps a fault and gives nothing back. The reader therefore
 * finds every fault of a note, and it never stops at the first one.
 *
 * The reader gives a value together with the text that the value came
 * from. The engine computes with the value, and the note keeps the text.
 * One read gives both, so the two always agree.
 *
 * The reader reads no timezone name and it reads no clock. It reports the
 * offset that a value states, and it leaves every zone to the resolution
 * order.
 *
 * The parser of the note editor decides the type of each value, and that
 * parser can give a date value in place of text. The YAML 1.1 family does
 * this for `2026-03-14` and for a time of day that states its seconds. The
 * reader therefore takes a date value under the keys of whole days, and it
 * reads the day of that value in universal time. That reading is
 * deterministic. A note that writes a plain day gets that day. A timestamp
 * with an offset can also reach this path, when the parser reduces the
 * timestamp to midnight in universal time. The reader then gives the day
 * in universal time, and a negative offset makes that day differ from the
 * day that the note states. The reader cannot tell the two shapes apart,
 * because the parser gives one value for both.
 *
 * A key that states a time of day is the other case, and the reader
 * refuses a date value there. Such a value holds one instant. It does not
 * hold the offset from universal time that the note stated, and the
 * resolution order gives that offset a meaning. A reader that took the
 * instant would put a time in another zone than the note states. The
 * refusal names the remedy: quotation marks around the value make the
 * parser of the note editor give the text of the note.
 */

import type { CivilDate, IsoValue } from './datetime';
import { parseIsoValue } from './datetime';
import type { Duration } from './duration';
import { parseDuration } from './duration';
import type { SchemaKey } from './keys';
import type { FrontmatterProblem } from './problems';

/** The keys of one note, as the platform gives them. */
export type Raw = Readonly<Record<string, unknown>>;

/** A day with a time of day, as the note states it. */
export type DateTimeValue = Extract<IsoValue, { readonly kind: 'date-time' }>;

/**
 * A key of a schedule, and the keys that decide what the reader says
 * about it. The key needs `anchor`, which is the first key of its own
 * shape. The key `other` is the first key of the other shape. The key
 * `use` is the key of that other shape for the same purpose, and it is
 * null where that shape has no such key.
 */
export interface AnchorRule {
	readonly key: SchemaKey;
	readonly anchor: SchemaKey;
	readonly other: SchemaKey;
	readonly use: SchemaKey | null;
}

/** One value that the reader read, together with the text it read it from. */
export interface Read<T> {
	readonly value: T;
	readonly text: string;
}

/** The reader of one note. It collects the faults that it finds. */
export class Reader {
	constructor(
		private readonly raw: Raw,
		private readonly problems: FrontmatterProblem[],
	) {}

	/** Keeps one fault. The reader states every fault that it finds. */
	report(problem: FrontmatterProblem): void {
		this.problems.push(problem);
	}

	/** True when the key holds a value that the reader can read. */
	holds(key: SchemaKey): boolean {
		const value = this.raw[key];
		return value !== undefined && value !== null && value !== '';
	}

	/**
	 * Reports a key that stands with no key that it needs. Where the note
	 * holds the first key of the other shape in place of that key, the
	 * report names that shape: a message that asked the user to add the
	 * missing key would ask for a note that states two shapes.
	 */
	needs(rule: AnchorRule): void {
		if (!this.holds(rule.key) || this.holds(rule.anchor)) {
			return;
		}
		if (this.holds(rule.other)) {
			this.report({
				kind: 'shape-mismatch',
				keys: [rule.key, rule.other],
				key: rule.key,
				held: rule.other,
				use: rule.use,
			});
			return;
		}
		this.report({
			kind: 'anchor-missing',
			keys: [rule.key, rule.anchor],
			key: rule.key,
			needs: rule.anchor,
		});
	}

	/** The text of a key. An empty value is a fault under every key. */
	text(key: SchemaKey): string | null {
		const value = this.raw[key];
		if (value === undefined) {
			return null;
		}
		if (typeof value === 'string') {
			if (value === '') {
				this.report({ kind: 'empty-value', keys: [key], key });
				return null;
			}
			return value;
		}
		if (value === null) {
			this.report({ kind: 'empty-value', keys: [key], key });
			return null;
		}
		this.report({
			kind: 'not-text',
			keys: [key],
			key,
			found: found(value),
		});
		return null;
	}

	/** One word of a list of words that the key takes. */
	word<T extends string>(key: SchemaKey, permitted: readonly T[]): T | null {
		const value = this.text(key);
		if (value === null) {
			return null;
		}
		const word = permitted.find((candidate) => candidate === value);
		if (word === undefined) {
			this.report({
				kind: 'unknown-value',
				keys: [key],
				key,
				value,
				permitted,
			});
			return null;
		}
		return word;
	}

	/** A list of text. One value that stands alone is a fault here. */
	list(key: SchemaKey): readonly string[] | null {
		const value = this.raw[key];
		if (value === undefined) {
			return null;
		}
		if (value === null) {
			this.report({ kind: 'empty-value', keys: [key], key });
			return null;
		}
		if (!isList(value)) {
			this.report({ kind: 'not-a-list', keys: [key], key });
			return null;
		}
		const items: string[] = [];
		for (const item of value) {
			if (typeof item !== 'string') {
				this.report({
					kind: 'not-text',
					keys: [key],
					key,
					found: found(item),
				});
				return null;
			}
			items.push(item);
		}
		return items;
	}

	/** A whole number from `low` through `high`. */
	wholeNumber(key: SchemaKey, low: number, high: number): number | null {
		const value = this.raw[key];
		if (value === undefined) {
			return null;
		}
		if (value === null) {
			this.report({ kind: 'empty-value', keys: [key], key });
			return null;
		}
		if (typeof value !== 'number' || !Number.isInteger(value)) {
			this.report({
				kind: 'not-a-number',
				keys: [key],
				key,
				found: found(value),
			});
			return null;
		}
		if (value < low || value > high) {
			this.report({
				kind: 'number-range',
				keys: [key],
				key,
				value,
				low,
				high,
			});
			return null;
		}
		return value;
	}

	/**
	 * A day with a time of day. A day alone is a fault under such a key,
	 * and a date value is a fault under such a key.
	 */
	dateTime(key: SchemaKey): Read<DateTimeValue> | null {
		const value = this.raw[key];
		if (value instanceof Date) {
			return this.refuseDate(key, value);
		}
		const read = this.timeText(key);
		if (read === null) {
			return null;
		}
		if (read.value.kind === 'date') {
			this.report({
				kind: 'time-of-day-missing',
				keys: [key],
				key,
				text: read.text,
			});
			return null;
		}
		return { value: read.value, text: read.text };
	}

	/**
	 * A day. A day with a time of day is a fault under such a key. A date
	 * value reads as the day that it states in universal time.
	 */
	date(key: SchemaKey): Read<CivilDate> | null {
		const value = this.raw[key];
		const read =
			value instanceof Date
				? this.dateValue(key, value)
				: this.timeText(key);
		if (read === null) {
			return null;
		}
		if (read.value.kind === 'date-time') {
			this.report({
				kind: 'time-of-day-refused',
				keys: [key],
				key,
				text: read.text,
			});
			return null;
		}
		return { value: read.value.date, text: read.text };
	}

	/** A length of time, with a sign or with no sign. */
	duration(key: SchemaKey): Read<Duration> | null {
		const text = this.text(key);
		if (text === null) {
			return null;
		}
		const result = parseDuration(text);
		if (!result.ok) {
			this.report({
				kind: 'bad-duration',
				keys: [key],
				key,
				text,
				failure: result.failure,
			});
			return null;
		}
		return { value: result.value, text };
	}

	/** A day, or a day with a time of day. */
	time(key: SchemaKey): Read<IsoValue> | null {
		const value = this.raw[key];
		if (value instanceof Date) {
			return isMidnight(value)
				? this.dateValue(key, value)
				: this.refuseDate(key, value);
		}
		return this.timeText(key);
	}

	/**
	 * The text of a time, read as a day or as a day with a time of day. A
	 * date value never reaches this method.
	 */
	private timeText(key: SchemaKey): Read<IsoValue> | null {
		const text = this.text(key);
		if (text === null) {
			return null;
		}
		const result = parseIsoValue(text);
		if (!result.ok) {
			this.report({
				kind: 'bad-time',
				keys: [key],
				key,
				text,
				failure: result.failure,
			});
			return null;
		}
		return { value: result.value, text };
	}

	/**
	 * The day, or the day and the time of day, of a date value. The reader
	 * writes the text of that value in universal time, and it then reads
	 * that text under the rules of every other value.
	 */
	private dateValue(key: SchemaKey, value: Date): Read<IsoValue> | null {
		if (Number.isNaN(value.getTime())) {
			this.report({
				kind: 'not-text',
				keys: [key],
				key,
				found: 'a date that the plugin cannot read',
			});
			return null;
		}
		const text = isMidnight(value) ? dayText(value) : stampText(value);
		const result = parseIsoValue(text);
		if (!result.ok) {
			this.report({
				kind: 'bad-time',
				keys: [key],
				key,
				text,
				failure: result.failure,
			});
			return null;
		}
		return { value: result.value, text };
	}

	/**
	 * Refuses a date value under a key that states a time of day. An
	 * unreadable date value gets the same fault under every key.
	 */
	private refuseDate(key: SchemaKey, value: Date): null {
		if (Number.isNaN(value.getTime())) {
			this.report({
				kind: 'not-text',
				keys: [key],
				key,
				found: 'a date that the plugin cannot read',
			});
			return null;
		}
		this.report({ kind: 'time-not-text', keys: [key], key });
		return null;
	}
}

/** The word that names what a value is, for a message to the user. */
function found(value: unknown): string {
	if (value === null) {
		return 'no value';
	}
	if (isList(value)) {
		return 'a list';
	}
	if (value instanceof Date) {
		return 'a date';
	}
	switch (typeof value) {
		case 'number':
			return 'a number';
		case 'boolean':
			return 'a true or false value';
		case 'string':
			return 'text';
		default:
			return 'a value of another kind';
	}
}

// Array.isArray gives the type any[] to its argument, and every read of an
// item then has the type any. This guard states the element type, so the
// reads above keep their types.
function isList(value: unknown): value is readonly unknown[] {
	return Array.isArray(value);
}

/** True when the value states the start of a day in universal time. */
function isMidnight(value: Date): boolean {
	return (
		value.getUTCHours() === 0 &&
		value.getUTCMinutes() === 0 &&
		value.getUTCSeconds() === 0 &&
		value.getUTCMilliseconds() === 0
	);
}

/** The day of a date value, in universal time. */
function dayText(value: Date): string {
	return `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1, 2)}-${pad(value.getUTCDate(), 2)}`;
}

/** The day and the time of day of a date value, in universal time. */
function stampText(value: Date): string {
	return `${dayText(value)}T${pad(value.getUTCHours(), 2)}:${pad(value.getUTCMinutes(), 2)}:${pad(value.getUTCSeconds(), 2)}Z`;
}

function pad(value: number, width: number): string {
	return String(value).padStart(width, '0');
}
