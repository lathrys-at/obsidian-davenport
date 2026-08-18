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
 * The library also puts every number through the number type of the
 * language, which holds fewer digits than an iCalendar integer permits. A
 * text that names a number too large for that type comes back as a
 * different number. The check therefore reads the number back to text and
 * compares it with the text that the property carries. The comparison
 * first removes the spellings that keep the value: a leading plus sign,
 * leading zeros, and trailing zeros after a decimal point.
 *
 * A repeat rule holds parts, and each part has a name and a value. The
 * library validates the value of some parts and invents a meaning for
 * others. The check here reads every part against the rules of the format,
 * so that a part gets the same treatment as a property of the same type. A
 * part whose name no standard states keeps its text in the library, so the
 * check gives it no rule.
 *
 * A type that the library passes through unchanged needs no rule here,
 * because the library invents no meaning for it.
 */

import type { JCalRecur, JCalRecurPart, JCalValue } from './jcal';

const DURATION_TIME = '(?:\\d+H(?:\\d+M(?:\\d+S)?)?|\\d+M(?:\\d+S)?|\\d+S)';
const DURATION = new RegExp(
	`^[+-]?P(?:\\d+W|\\d+D(?:T${DURATION_TIME})?|T${DURATION_TIME})$`,
);
const DATE = /^\d{8}$/;
const DATE_TIME = /^\d{8}T\d{6}Z?$/;

const VALUE_RULES: ReadonlyMap<string, RegExp> = new Map([
	['boolean', /^(?:TRUE|FALSE)$/i],
	['date', DATE],
	['date-time', DATE_TIME],
	['duration', DURATION],
	['float', /^[+-]?\d+(?:\.\d+)?$/],
	['integer', /^[+-]?\d+$/],
	['recur', /^[A-Za-z0-9-]+=[^;]*(?:;[A-Za-z0-9-]+=[^;]*)*$/],
	['time', /^\d{6}Z?$/],
	['utc-offset', /^[+-]\d{4}(?:\d{2})?$/],
]);

const FREQUENCY = /^(?:SECONDLY|MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY)$/;
const WEEKDAY = /^(?:SU|MO|TU|WE|TH|FR|SA)$/;
const WEEKDAY_ITEM = /^[+-]?\d{0,2}(?:SU|MO|TU|WE|TH|FR|SA)$/;
const DIGITS = /^\d+$/;
const SIGNED_DIGITS = /^[+-]?\d+$/;
const NUMBER_PARTS: ReadonlySet<string> = new Set([
	'BYSECOND',
	'BYMINUTE',
	'BYHOUR',
	'BYMONTHDAY',
	'BYYEARDAY',
	'BYWEEKNO',
	'BYMONTH',
	'BYSETPOS',
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
	for (const [index, piece] of pieces.entries()) {
		if (!rule.test(piece)) {
			return typeProblem(piece, type);
		}
		const problem = numberProblem(piece, structured ? value[index] : value);
		if (problem !== null) {
			return problem;
		}
	}
	if (type === 'recur') {
		return recurProblem(part, value);
	}
	return null;
}

function recurProblem(
	text: string,
	value: JCalValue | undefined,
): string | null {
	if (!isRecurRecord(value)) {
		return null;
	}
	const parts = text.split(';');
	const names = Object.keys(value);
	if (parts.length !== names.length) {
		return `carries ${String(parts.length)} rule parts, and the parser reports ${String(names.length)}`;
	}
	for (const part of parts) {
		const problem = rulePartProblem(part, value);
		if (problem !== null) {
			return problem;
		}
	}
	return null;
}

function rulePartProblem(part: string, rule: JCalRecur): string | null {
	const equals = part.indexOf('=');
	if (equals < 0) {
		return `carries the rule part ${quote(part)}, and a rule part holds a name and a value`;
	}
	const name = part.slice(0, equals).toUpperCase();
	const text = part.slice(equals + 1);
	const read = rule[name.toLowerCase()];
	if (name === 'FREQ') {
		return FREQUENCY.test(text)
			? null
			: rulePartIs(name, text, 'frequency');
	}
	if (name === 'WKST') {
		return WEEKDAY.test(text) ? null : rulePartIs(name, text, 'weekday');
	}
	if (name === 'UNTIL') {
		return DATE.test(text) || DATE_TIME.test(text)
			? null
			: rulePartIs(name, text, 'date and no date-time');
	}
	if (name === 'COUNT' || name === 'INTERVAL') {
		if (!DIGITS.test(text)) {
			return rulePartIs(name, text, 'whole number');
		}
		return numberProblem(text, read);
	}
	if (name === 'BYDAY') {
		return listProblem(name, text, read, WEEKDAY_ITEM, 'weekday');
	}
	if (NUMBER_PARTS.has(name)) {
		return listProblem(name, text, read, SIGNED_DIGITS, 'whole number');
	}
	return null;
}

function listProblem(
	name: string,
	text: string,
	read: JCalRecurPart | undefined,
	rule: RegExp,
	kind: string,
): string | null {
	const items = text.split(',');
	const list = isPartArray(read) ? read : undefined;
	const reported = list?.length ?? 1;
	if (items.length !== reported) {
		return `carries ${String(items.length)} values in the rule part ${name}, and the parser reports ${String(reported)}`;
	}
	for (const [index, item] of items.entries()) {
		if (!rule.test(item)) {
			return rulePartIs(name, item, kind);
		}
		const problem = numberProblem(
			item,
			list === undefined ? read : list[index],
		);
		if (problem !== null) {
			return problem;
		}
	}
	return null;
}

/**
 * The problem with a number that the text writes and the parser read, or
 * null when the two agree. The check removes the spellings that keep the
 * value and then compares what remains with the number that the parser
 * built.
 */
function numberProblem(text: string, value: unknown): string | null {
	if (typeof value !== 'number') {
		return null;
	}
	if (plainNumber(text) === String(value)) {
		return null;
	}
	return `carries ${quote(text)}, and the parser read the number ${String(value)}`;
}

function plainNumber(text: string): string {
	let sign = '';
	let digits = text;
	if (digits.startsWith('+')) {
		digits = digits.slice(1);
	} else if (digits.startsWith('-')) {
		sign = '-';
		digits = digits.slice(1);
	}
	if (digits.includes('.')) {
		digits = digits.replace(/0+$/, '');
		if (digits.endsWith('.')) {
			digits = digits.slice(0, -1);
		}
	}
	return sign + digits.replace(/^0+(?=\d)/, '');
}

function periodProblem(part: string): string | null {
	const [start, end, ...rest] = part.split('/');
	if (start === undefined || end === undefined || rest.length > 0) {
		return `carries ${quote(part)}, and a period holds a start and an end`;
	}
	if (!DATE_TIME.test(start)) {
		return `carries the period start ${quote(start)}, and that value is not a date-time`;
	}
	if (!DATE_TIME.test(end) && !DURATION.test(end)) {
		return `carries the period end ${quote(end)}, and that value is neither a date-time nor a duration`;
	}
	return null;
}

function typeProblem(piece: string, type: string): string {
	return `carries ${quote(piece)}, and that value does not obey the rules of the type ${type}`;
}

function rulePartIs(name: string, text: string, kind: string): string {
	return `carries ${quote(text)} in the rule part ${name}, and that value is not a ${kind}`;
}

// Array.isArray gives the type any[] to its argument, and every read of an
// item then has the type any. This guard states the element type, so the
// reads above keep their types.
function isValueArray(
	value: JCalValue | undefined,
): value is readonly JCalValue[] {
	return Array.isArray(value);
}

function isPartArray(
	value: JCalRecurPart | undefined,
): value is readonly (string | number)[] {
	return Array.isArray(value);
}

function isRecurRecord(value: JCalValue | undefined): value is JCalRecur {
	return typeof value === 'object' && !isValueArray(value);
}

function quote(text: string): string {
	return JSON.stringify(text);
}
