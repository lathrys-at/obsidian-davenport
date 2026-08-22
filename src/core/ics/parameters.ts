/**
 * The text of a parameter value, and the changes that the parse library
 * makes to it.
 *
 * The library changes the text of a parameter value in three ways. It
 * removes the quotation marks that enclose a value. It decodes the escapes
 * that the format states for a parameter: a caret and an apostrophe give a
 * quotation mark, a caret and the letter n give a line break, and two
 * carets give one caret. It then decodes the value as if the value were
 * text, which turns a backslash and a comma into a comma, a backslash and
 * a semicolon into a semicolon, two backslashes into one backslash, and a
 * backslash and the letter n into a line break.
 *
 * The first two changes keep the meaning, and the serializer writes the
 * value again in a form that carries the same meaning. The third change
 * does not: the serializer writes no backslash back, so a backslash that
 * stood before a comma is gone from the bytes. One part of the third
 * change is an exception. A backslash and the letter n, in either case, is
 * the form that one large calendar client writes for a line break, the
 * corpus holds that form, and the serializer writes the same line break
 * back as a caret and the letter n. That form therefore keeps its
 * meaning.
 *
 * The check here builds the value that the accepted changes give, and it
 * compares that value with the value that the library read. The check
 * builds two forms, one with the line-break decode and one without it,
 * because the library applies the text decode to some parameters and not
 * to others. A value that matches neither form lost bytes, and the gate
 * refuses it.
 *
 * A parameter that carries a list of values takes the same check one value
 * at a time. The reader divides the list before it decodes any value, and
 * the library decodes the whole text before it divides the list. An escape
 * of a quotation mark therefore becomes a divider in the library, and the
 * values that the library reports are then not the values that the text
 * states. A comparison that joined the values again could not see this,
 * because the divider that the join writes holds the same characters that
 * a value can hold. The check therefore compares value against value, and
 * it compares the count first.
 *
 * The VALUE parameter takes a rule of its own, because the library gives
 * that parameter a path of its own. The library turns the parameter into
 * the name of the value type of the property, and it keeps no parameter of
 * that name. The serializer then writes the name back raw: it writes no
 * escape and no quotation marks, and it raises the case of the letters. A
 * name that needed an escape or quotation marks in the text therefore
 * comes back as other bytes, or as a text that the library cannot read.
 * The rule of this parameter follows from that: the name that the library
 * reports must equal the text of the parameter, apart from the case of the
 * letters, and the name must hold no character that a parameter value
 * needs quotation marks for.
 *
 * The last check of this file reads no parameter value. That check reads
 * where the value of the property starts. The library computes that place
 * from the lengths of the parameter values, and the check computes it in
 * the same way.
 *
 * The library works like this. It takes the place where the text of the
 * last parameter starts. It adds the lengths of the values that it read for
 * that parameter. It then takes the first colon at or after the sum. A
 * parameter that writes each of its values in its own quotation marks puts
 * three characters between two values. The sum counts none of those
 * characters. The search therefore starts inside the last value, and a
 * colon that stands there becomes the start of the value of the property.
 * The library reports the parameter correctly and the value of the property
 * wrongly.
 *
 * The check builds the same sum for one parameter. The sum stops before the
 * end of the text of that parameter. The characters between the sum and that
 * end are the characters that the library does not count, and those
 * characters must hold no colon. The sum takes the lengths of the values
 * that the parser reports, because those are the lengths that the library
 * added. The check therefore needs no model of the changes that the library
 * makes to a parameter value. The sum also takes away the characters that
 * the escapes of a parameter lose. The library moves the start of the text
 * of the parameter by that same number of characters.
 *
 * The check reads every parameter of the line, and not the last one alone.
 * The canonical serializer writes the parameters in the order of their
 * names. A parameter that stands in the middle of the text can therefore
 * stand last in the canonical text. A line whose middle parameter carries
 * such a colon gives a canonical text that the boundary cannot read back.
 * The engine writes that text itself, so the boundary must refuse the line
 * that makes it.
 */

import type { JCalParameters, JCalParameterValue } from './jcal';
import type { ContentLine, ContentParameter } from './lines';

const PARAMETER_ESCAPE = /\^['n^]/g;
const PARAMETER_ESCAPE_MAP: Readonly<Record<string, string>> = {
	"^'": '"',
	'^n': '\n',
	'^^': '^',
};
const TEXT_NEWLINE = /\\[Nn]/g;

/**
 * The characters that a parameter value cannot carry without quotation
 * marks around the value. The format states the same set.
 */
const NEEDS_QUOTATION_MARKS = /[";:,]/;

/**
 * The problem with the text of a parameter value, or null when the value
 * that the parser read keeps every byte of that text. The caller gives the
 * parameter as the text writes it, and the value that the parser reports
 * for that parameter.
 */
export function parameterTextProblem(
	parameter: ContentParameter,
	value: JCalParameterValue | undefined,
): string | null {
	if (value === undefined) {
		return null;
	}
	const read = typeof value === 'string' ? [value] : value;
	if (read.length !== parameter.values.length) {
		return carries(
			parameter,
			`${String(parameter.values.length)} values, and the parser read ${String(read.length)}`,
		);
	}
	for (const [index, item] of read.entries()) {
		const written = parameter.values[index] ?? '';
		if (!keepsTheBytes(written, item)) {
			return carries(
				parameter,
				`${quote(written)}, and the parser read ${quote(item)}`,
			);
		}
	}
	return null;
}

/**
 * The problem with the text of a VALUE parameter, or null when the name of
 * the value type that the parser reports keeps every byte of that text.
 * The caller gives the parameter as the text writes it, and the name of
 * the value type that the parser gave to the property.
 */
export function valueTypeTextProblem(
	parameter: ContentParameter,
	type: string,
): string | null {
	if (parameter.values.length !== 1) {
		return carries(
			parameter,
			`${String(parameter.values.length)} values, and a value type is one name`,
		);
	}
	const written = parameter.values[0] ?? '';
	if (written.toLowerCase() !== type.toLowerCase()) {
		return carries(
			parameter,
			`${quote(written)}, and the parser read the value type ${quote(type)}`,
		);
	}
	if (NEEDS_QUOTATION_MARKS.test(type)) {
		return carries(
			parameter,
			`${quote(written)}, and the serializer cannot write that value type back`,
		);
	}
	return null;
}

/**
 * The problem with the place where the value of the property starts, or
 * null when no parameter of the line moves that place. The caller gives the
 * logical line, the reading of that line, and the parameters that the parser
 * reports for the property.
 *
 * The caller runs this check after the count of the parameters and after
 * the check of each parameter. This check rests on both of those results.
 * The count refuses a name that stands twice. The values that the parser
 * reports under one name are therefore the values of one parameter. The
 * check of the VALUE parameter refuses a name that lost bytes. The parser
 * therefore read the text of that parameter and changed nothing in it.
 */
export function valueStartProblem(
	line: string,
	content: ContentLine,
	parameters: JCalParameters,
): string | null {
	for (const parameter of content.parameters) {
		const uncounted = uncountedText(line, parameter, parameters);
		if (uncounted?.includes(':') === true) {
			return `carries the parameter ${parameter.name}, and the library does not count ${quote(uncounted)} at the end of that parameter; the library reads the colon in that text as the start of the value`;
		}
	}
	return null;
}

/**
 * The characters at the end of the text of the parameter that the library
 * leaves out of its count, or null where the parser reports no value under
 * the name of the parameter.
 *
 * The sum of the library never reaches past the end of that text, because
 * the values that the parser reports are never longer than the text they
 * came from.
 */
function uncountedText(
	line: string,
	parameter: ContentParameter,
	parameters: JCalParameters,
): string | null {
	const carried = carriedLength(parameter, parameters);
	if (carried === null) {
		return null;
	}
	const escaped = escapedText(parameter.text);
	const start =
		parameter.at + (parameter.text.length - escaped.length) + carried;
	return line.slice(start, parameter.at + parameter.text.length);
}

/**
 * The number that the library adds to the place where the text of the
 * parameter starts, or null where the parser reports no value under the
 * name of the parameter.
 *
 * The parser keeps no parameter with the name VALUE. The parser holds that
 * value as the value type of the property, and it lowers the case of the
 * letters. The check of the VALUE parameter stands before this one, and it
 * passed. The parser therefore read the text of the parameter and changed
 * no byte of it. The length of that text is the length that the library
 * added.
 */
function carriedLength(
	parameter: ContentParameter,
	parameters: JCalParameters,
): number | null {
	if (parameter.name.toUpperCase() === 'VALUE') {
		return parameter.text.length;
	}
	const read = parameters[parameter.name.toLowerCase()];
	if (read === undefined) {
		return null;
	}
	return typeof read === 'string'
		? read.length
		: read.reduce((sum, value) => sum + value.length, 0);
}

/**
 * True when the value that the parser read keeps every byte of the text
 * that the parameter writes for it.
 */
function keepsTheBytes(written: string, read: string): boolean {
	const escaped = escapedText(written);
	return read === escaped || read === escaped.replace(TEXT_NEWLINE, '\n');
}

/** The text with the escapes of a parameter value decoded. */
function escapedText(written: string): string {
	return written.replace(
		PARAMETER_ESCAPE,
		(found) => PARAMETER_ESCAPE_MAP[found] ?? found,
	);
}

function carries(parameter: ContentParameter, said: string): string {
	return `the parameter ${parameter.name} carries ${said}`;
}

function quote(text: string): string {
	return JSON.stringify(text);
}
