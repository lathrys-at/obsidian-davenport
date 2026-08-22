/**
 * The readers of one field of one settings entry.
 *
 * The settings arrive as data of an unknown shape. Each reader below takes
 * that data, reads one field, and gives the value of that field back. A
 * reader that cannot read the field puts a fault in the list that the
 * caller holds, and gives null back. The caller then knows that the entry
 * is not complete, and the caller knows which field to name.
 */

import type { EntryField, FieldFault } from './problems';

export type UnknownMap = Readonly<Record<string, unknown>>;

/** True where the value is a set of named fields. */
export function isMap(value: unknown): value is UnknownMap {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a field that must hold text with at least one character. Gives
 * null back where the entry has no such field, where the field holds a
 * value that is not text, or where the text has no characters.
 */
export function requiredText(
	entry: UnknownMap,
	field: EntryField,
	faults: FieldFault[],
): string | null {
	const value = entry[field];
	if (value === undefined || value === null) {
		faults.push({ kind: 'missing', field });
		return null;
	}
	if (typeof value !== 'string') {
		faults.push({ kind: 'not-text', field });
		return null;
	}
	if (value === '') {
		faults.push({ kind: 'empty', field });
		return null;
	}
	return value;
}

/**
 * Reads a field that the entry can leave out. Gives undefined back where
 * the entry has no such field. Gives null back where the field holds a
 * value that the reader refuses.
 */
export function optionalText(
	entry: UnknownMap,
	field: EntryField,
	faults: FieldFault[],
): string | null | undefined {
	if (entry[field] === undefined || entry[field] === null) {
		return undefined;
	}
	return requiredText(entry, field, faults);
}

/**
 * Reads a field that must hold one word of a list of words. Gives null
 * back where the field holds another value.
 */
export function requiredWord<T extends string>(
	entry: UnknownMap,
	field: EntryField,
	permitted: readonly T[],
	faults: FieldFault[],
): T | null {
	const value = requiredText(entry, field, faults);
	if (value === null) {
		return null;
	}
	const word = permitted.find((item) => item === value);
	if (word === undefined) {
		faults.push({ kind: 'unknown-value', field, value, permitted });
		return null;
	}
	return word;
}

/**
 * Reads a field that must hold a list of words, where each word comes
 * from a list of words. Gives null back where the field holds another
 * value, and where one item of the list is not one of those words.
 */
export function requiredWordList<T extends string>(
	entry: UnknownMap,
	field: EntryField,
	permitted: readonly T[],
	faults: FieldFault[],
): readonly T[] | null {
	const value = entry[field];
	if (value === undefined || value === null) {
		faults.push({ kind: 'missing', field });
		return null;
	}
	if (!Array.isArray(value)) {
		faults.push({ kind: 'not-a-list', field });
		return null;
	}
	const items: readonly unknown[] = value;
	const words: T[] = [];
	for (const item of items) {
		if (typeof item !== 'string') {
			faults.push({ kind: 'not-text', field });
			return null;
		}
		const word = permitted.find((candidate) => candidate === item);
		if (word === undefined) {
			faults.push({
				kind: 'unknown-value',
				field,
				value: item,
				permitted,
			});
			return null;
		}
		words.push(word);
	}
	return words;
}
