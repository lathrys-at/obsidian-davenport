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
 */

import type { JCalParameterValue } from './jcal';
import type { ContentParameter } from './lines';

const PARAMETER_ESCAPE = /\^['n^]/g;
const PARAMETER_ESCAPE_MAP: Readonly<Record<string, string>> = {
	"^'": '"',
	'^n': '\n',
	'^^': '^',
};
const TEXT_NEWLINE = /\\[Nn]/g;

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
	const read = Array.isArray(value)
		? value.join(parameter.quoted ? '","' : ',')
		: value;
	if (typeof read !== 'string') {
		return null;
	}
	const escaped = parameter.text.replace(
		PARAMETER_ESCAPE,
		(found) => PARAMETER_ESCAPE_MAP[found] ?? found,
	);
	if (read === escaped || read === escaped.replace(TEXT_NEWLINE, '\n')) {
		return null;
	}
	return `the parameter ${parameter.name} carries ${quote(parameter.text)}, and the parser read ${quote(read)}`;
}

function quote(text: string): string {
	return JSON.stringify(text);
}
