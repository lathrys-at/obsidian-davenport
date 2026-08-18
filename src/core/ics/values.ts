/**
 * The lexical rules of the iCalendar value types, and the check that reads
 * the text of a value against them.
 *
 * The parse library gives a meaning to a value even when the text of that
 * value disobeys the rules of its type. It reads an integer out of text
 * that holds no number, and it reads a date-time out of text that holds no
 * time. The check here refuses such text, so that the invented meaning
 * never reaches a record.
 *
 * A type that the library passes through unchanged needs no rule here,
 * because the library invents no meaning for it.
 */

import type { JCalRecur, JCalValue } from './jcal';

const DURATION_TIME = '(?:\\d+H(?:\\d+M(?:\\d+S)?)?|\\d+M(?:\\d+S)?|\\d+S)';
const DURATION = new RegExp(
	`^[+-]?P(?:\\d+W|\\d+D(?:T${DURATION_TIME})?|T${DURATION_TIME})$`,
);
const DATE_TIME = /^\d{8}T\d{6}Z?$/;

const VALUE_RULES: ReadonlyMap<string, RegExp> = new Map([
	['boolean', /^(?:TRUE|FALSE)$/i],
	['date', /^\d{8}$/],
	['date-time', DATE_TIME],
	['duration', DURATION],
	['float', /^[+-]?\d+(?:\.\d+)?$/],
	['integer', /^[+-]?\d+$/],
	['recur', /^[A-Za-z0-9-]+=[^;]*(?:;[A-Za-z0-9-]+=[^;]*)*$/],
	['time', /^\d{6}Z?$/],
	['utc-offset', /^[+-]\d{4}(?:\d{2})?$/],
]);

/**
 * The problem with the text of a value, or null when the text obeys the
 * rules of its type. The caller gives the value type that the parser
 * chose, the text that stands after the colon, and the values that the
 * parser read out of that text. The message names what the property
 * carries, so the caller writes the name of the property in front of it.
 */
export function valueTextProblem(
	type: string,
	text: string,
	values: readonly JCalValue[],
): string | null {
	if (type !== 'period' && !VALUE_RULES.has(type)) {
		return null;
	}
	// A value of one of these types holds no comma of its own. A repeat
	// rule is the exception, and the parser always reports a repeat rule as
	// one value.
	const parts = values.length > 1 ? text.split(',') : [text];
	if (parts.length !== values.length) {
		return `carries ${String(parts.length)} values, and the parser reports ${String(values.length)}`;
	}
	for (const [index, part] of parts.entries()) {
		const problem = partProblem(type, part, values[index]);
		if (problem !== null) {
			return problem;
		}
	}
	return null;
}

function partProblem(
	type: string,
	part: string,
	value: JCalValue | undefined,
): string | null {
	if (type === 'period') {
		return periodProblem(part);
	}
	const rule = VALUE_RULES.get(type);
	if (rule === undefined) {
		return null;
	}
	// A structured value holds its parts in an array, and a semicolon
	// separates those parts in the text.
	const structured = isValueArray(value);
	const pieces = structured ? part.split(';') : [part];
	if (structured && pieces.length !== value.length) {
		return `carries ${String(pieces.length)} parts in ${quote(part)}, and the parser reports ${String(value.length)}`;
	}
	for (const piece of pieces) {
		if (!rule.test(piece)) {
			return `carries ${quote(piece)}, and this text is not a ${type}`;
		}
	}
	if (type === 'recur' && isRecurRecord(value)) {
		const written = part.split(';').length;
		const reported = Object.keys(value).length;
		if (written !== reported) {
			return `carries ${String(written)} rule parts, and the parser reports ${String(reported)}`;
		}
	}
	return null;
}

function periodProblem(part: string): string | null {
	const [start, end, ...rest] = part.split('/');
	if (start === undefined || end === undefined || rest.length > 0) {
		return `carries ${quote(part)}, and a period holds a start and an end`;
	}
	if (!DATE_TIME.test(start)) {
		return `carries the period start ${quote(start)}, and this text is not a date-time`;
	}
	if (!DATE_TIME.test(end) && !DURATION.test(end)) {
		return `carries the period end ${quote(end)}, and this text is neither a date-time nor a duration`;
	}
	return null;
}

// Array.isArray gives the type any[] to its argument, and every read of an
// item then has the type any. This guard states the element type, so the
// reads above keep their types.
function isValueArray(
	value: JCalValue | undefined,
): value is readonly JCalValue[] {
	return Array.isArray(value);
}

function isRecurRecord(value: JCalValue | undefined): value is JCalRecur {
	return typeof value === 'object' && !isValueArray(value);
}

function quote(text: string): string {
	return JSON.stringify(text);
}
