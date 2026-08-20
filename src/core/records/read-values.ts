/**
 * The readers of one value out of the frontmatter of a record.
 *
 * Each function takes the entries of one map and the name of one key. It
 * gives back the value, or the reason that the value disagrees with the
 * schema. A caller collects the reasons of a whole block, and it reports
 * them together. Nothing here throws, and nothing here repairs a value.
 *
 * Two rules of the schema live here. The first rule: a key that the
 * schema does not hold is a refusal, and never a value that a reader
 * passes over. The second rule: an empty list reads back as an absent
 * list, because the emitter writes those two states the same way.
 */

import type { Loaded } from './loader';

/** One value, or the reason that the value disagrees with the schema. */
export type Read<T> =
	| { readonly ok: true; readonly value: T | undefined }
	| { readonly ok: false; readonly message: string };

/**
 * The value of one read. A read that refused puts its reason on the list
 * and gives back nothing.
 */
export function collect<T>(read: Read<T>, problems: string[]): T | undefined {
	if (!read.ok) {
		problems.push(read.message);
		return undefined;
	}
	return read.value;
}

/**
 * An entry for the key when the value is there, and no entry at all when
 * the value is absent. The record types state an absent field as a field
 * that is not there, and not as a field that holds nothing.
 */
export function maybe<K extends string, T>(
	key: K,
	value: T | undefined,
): Partial<Record<K, T>> {
	return value === undefined ? {} : ({ [key]: value } as Record<K, T>);
}

/** The name of the first key that the schema does not hold, or nothing. */
export function unknownKey(
	entries: ReadonlyMap<string, Loaded>,
	allowed: readonly string[],
): string | null {
	for (const key of entries.keys()) {
		if (!allowed.includes(key)) {
			return `the schema of a record holds no key named ${key}`;
		}
	}
	return null;
}

/** The text under the key. The key must be there. */
export function requiredText(
	entries: ReadonlyMap<string, Loaded>,
	key: string,
): Read<string> {
	const found = entries.get(key);
	if (found === undefined) {
		return { ok: false, message: `the record states no ${key}` };
	}
	return found.kind === 'text'
		? { ok: true, value: found.value }
		: { ok: false, message: `the value of ${key} is not a text` };
}

/** The text under the key, where the key can be absent. */
export function optionalText(
	entries: ReadonlyMap<string, Loaded>,
	key: string,
): Read<string> {
	return entries.has(key)
		? requiredText(entries, key)
		: { ok: true, value: undefined };
}

/** The whole number under the key, where the key can be absent. */
export function optionalInteger(
	entries: ReadonlyMap<string, Loaded>,
	key: string,
): Read<number> {
	const found = entries.get(key);
	if (found === undefined) {
		return { ok: true, value: undefined };
	}
	return found.kind === 'integer'
		? { ok: true, value: found.value }
		: { ok: false, message: `the value of ${key} is not a whole number` };
}

/**
 * The list of texts under the key. An empty list gives nothing back, and
 * so does an absent key.
 */
export function optionalTexts(
	entries: ReadonlyMap<string, Loaded>,
	key: string,
): Read<readonly string[]> {
	const found = entries.get(key);
	if (found === undefined) {
		return { ok: true, value: undefined };
	}
	if (found.kind !== 'texts') {
		return { ok: false, message: `the value of ${key} is not a list` };
	}
	return found.values.length === 0
		? { ok: true, value: undefined }
		: { ok: true, value: found.values };
}

/** The text under the key, where the schema permits a fixed set of texts. */
export function optionalOneOf<T extends string>(
	entries: ReadonlyMap<string, Loaded>,
	key: string,
	permitted: readonly T[],
): Read<T> {
	const read = optionalText(entries, key);
	if (!read.ok) {
		return { ok: false, message: read.message };
	}
	if (read.value === undefined) {
		return { ok: true, value: undefined };
	}
	const value = read.value as T;
	return permitted.includes(value)
		? { ok: true, value }
		: {
				ok: false,
				message: `the value of ${key} is ${read.value}, and the schema permits ${permitted.join(', ')}`,
			};
}

/** The map under the key, where the key can be absent. */
export function optionalMap(
	node: Loaded | undefined,
	key: string,
): Read<ReadonlyMap<string, Loaded>> {
	if (node === undefined) {
		return { ok: true, value: undefined };
	}
	return node.kind === 'map'
		? { ok: true, value: node.entries }
		: { ok: false, message: `the value of ${key} is not a map` };
}
