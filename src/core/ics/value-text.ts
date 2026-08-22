/**
 * The values that the text of a property states, and the comparison of
 * those values with the values that the parse library read.
 *
 * The file values.ts reads the text of a value against the lexical rules
 * of its type. Those rules cover the types that hold a number, a date, a
 * time or a repeat rule. They cover no type that holds text, because text
 * obeys no lexical rule. A property of such a type therefore reached the
 * gate with no comparison at all, and two defects of the library came
 * through it.
 *
 * The first defect divides the values of a property. The library treats a
 * backslash before a divider as an escape of that divider, and it asks for
 * no more than one backslash. The format asks for an odd number of them: a
 * value that ends with the escape of a backslash therefore ends, and the
 * divider after it divides. `CATEGORIES:a\\,b` states two categories, and
 * the library reports one that holds the comma. A whole value is then gone
 * from the record, and the bytes of the canonical text stay still, so
 * nothing else sees the loss.
 *
 * The second defect moves the start of the value of the property. The
 * library counts the length of the values of the last parameter, and it
 * leaves the characters between two of those values out of that count. It
 * then looks for the colon of the property from a place inside the last
 * value, and it finds a colon that stands there. The value of the property
 * that it reports then holds the tail of a parameter.
 *
 * The check here reads the text of the value the way the format reads it,
 * and it compares the result with what the library reported. The check
 * covers two groups of types.
 *
 * - The type text. The library divides the text at the dividers of the
 *   property, and it then decodes the escapes of each piece: two
 *   backslashes give one backslash, a backslash and a comma give a comma,
 *   a backslash and a semicolon give a semicolon, and a backslash and the
 *   letter n, in either case, gives a line break. The check divides the
 *   text with the rule of the format and decodes each piece in the same
 *   way. Where the two readings differ, the text lost a value, a part or
 *   the bytes of one of them.
 * - The types that the library carries with no change: the type of a value
 *   that no property states a type for, a reference, a binary value, and
 *   the address of a person. The value that the library reports must equal
 *   the text, character for character. The check reads such a type only
 *   where the property divides its text at nothing, because the format
 *   states no escape outside a text value and the two readings of a
 *   divided text would then rest on nothing.
 *
 * Every other type keeps the treatment that values.ts gives it.
 */

import type { JCalDividers, JCalValue } from './jcal';

/** The types whose text the library gives back with no change. */
const CARRIED_TYPES: ReadonlySet<string> = new Set([
	'unknown',
	'uri',
	'binary',
	'cal-address',
]);

const TEXT_ESCAPE = /\\\\|\\;|\\,|\\[Nn]/g;
const TEXT_ESCAPE_MAP: Readonly<Record<string, string>> = {
	'\\\\': '\\',
	'\\;': ';',
	'\\,': ',',
	'\\n': '\n',
	'\\N': '\n',
};

/**
 * The problem with the values that the parser read, or null when those
 * values are the values that the text states. The caller gives the value
 * type that the parser chose, the text that stands after the colon, the
 * values that the parser read out of that text, and the dividers of the
 * property. The message names what the property carries, so the caller
 * writes the name of the property in front of it.
 */
export function valueContentProblem(
	type: string,
	text: string,
	values: readonly JCalValue[],
	dividers: JCalDividers,
): string | null {
	if (type === 'text') {
		return textProblem(text, values, dividers);
	}
	if (!CARRIED_TYPES.has(type)) {
		return null;
	}
	if (dividers.between !== null || dividers.inside !== null) {
		return null;
	}
	const only = values[0];
	if (values.length !== 1 || typeof only !== 'string') {
		return null;
	}
	return only === text ? null : readAs(text, only);
}

function textProblem(
	text: string,
	values: readonly JCalValue[],
	dividers: JCalDividers,
): string | null {
	const written = divided(text, dividers.between);
	if (written.length !== values.length) {
		return `carries ${String(written.length)} values, and the parser reports ${String(values.length)}`;
	}
	for (const [index, piece] of written.entries()) {
		const problem = pieceProblem(piece, values[index], dividers.inside);
		if (problem !== null) {
			return problem;
		}
	}
	return null;
}

function pieceProblem(
	piece: string,
	value: JCalValue | undefined,
	inside: string | null,
): string | null {
	const parts = divided(piece, inside);
	// The library gives a structured value that holds one part back as
	// that one part, and not as a list of one.
	if (parts.length === 1) {
		return sameText(piece, value) ? null : readAs(piece, value);
	}
	if (!isValueArray(value) || value.length !== parts.length) {
		return `carries ${String(parts.length)} parts in ${quote(piece)}, and the parser reports ${quote(value)}`;
	}
	for (const [index, part] of parts.entries()) {
		if (!sameText(part, value[index])) {
			return readAs(part, value[index]);
		}
	}
	return null;
}

/**
 * The pieces of the text, divided at every divider that the text itself
 * states. A backslash takes away the meaning of the character that stands
 * after it, so a divider that an odd number of backslashes stands before
 * is one character of a value and no divider. The function gives the whole
 * text back as one piece where the property divides its text at nothing.
 */
function divided(text: string, divider: string | null): readonly string[] {
	if (divider === null) {
		return [text];
	}
	const pieces: string[] = [];
	let start = 0;
	let at = 0;
	while (at < text.length) {
		const character = text[at];
		if (character === '\\') {
			at += 2;
			continue;
		}
		if (character === divider) {
			pieces.push(text.slice(start, at));
			start = at + 1;
		}
		at += 1;
	}
	pieces.push(text.slice(start));
	return pieces;
}

/** True when the value that the parser read is the text that the piece states. */
function sameText(piece: string, value: JCalValue | undefined): boolean {
	return typeof value === 'string' && decoded(piece) === value;
}

function decoded(piece: string): string {
	return piece.replace(
		TEXT_ESCAPE,
		(found) => TEXT_ESCAPE_MAP[found] ?? found,
	);
}

function readAs(piece: string, value: JCalValue | undefined): string {
	return `carries ${quote(piece)}, and the parser read ${quote(value)}`;
}

// Array.isArray gives the type any[] to its argument, and every read of an
// item then has the type any. This guard states the element type, so the
// reads above keep their types.
function isValueArray(
	value: JCalValue | undefined,
): value is readonly JCalValue[] {
	return Array.isArray(value);
}

function quote(value: unknown): string {
	return JSON.stringify(value) ?? 'nothing';
}
