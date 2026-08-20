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

	/** Reports a key that stands with no key that it needs. */
	needs(key: SchemaKey, anchor: SchemaKey): void {
		if (this.holds(key) && !this.holds(anchor)) {
			this.report({
				kind: 'anchor-missing',
				keys: [key, anchor],
				key,
				needs: anchor,
			});
		}
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

	/** A day with a time of day. A day alone is a fault under such a key. */
	dateTime(key: SchemaKey): Read<DateTimeValue> | null {
		const read = this.time(key);
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

	/** A day. A day with a time of day is a fault under such a key. */
	date(key: SchemaKey): Read<CivilDate> | null {
		const read = this.time(key);
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
}

/** The word that names what a value is, for a message to the user. */
function found(value: unknown): string {
	if (value === null) {
		return 'no value';
	}
	if (isList(value)) {
		return 'a list';
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
