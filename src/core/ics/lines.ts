/**
 * The lines of an iCalendar text, as the parse boundary reads them.
 *
 * A writer splits a long line across two physical lines or more, and it
 * starts each line after the first with one space or one tab. The split is
 * a fold, and the line that the pieces make together is a logical line.
 * The functions here join the pieces again and then split one logical line
 * into the name, the parameters, and the value.
 *
 * The parse boundary reads the text a second time in this way, beside the
 * parse library, so that the boundary can compare the text with what the
 * library reports. The split of one line therefore follows the rule of the
 * library and not the rule of the format. A double quote opens a quoted
 * parameter value only where the double quote comes directly after the
 * equals sign that starts that value. Everywhere else a double quote is
 * one more character of the value. The format gives the same rule, and a
 * reader that treats every double quote as a delimiter disagrees with the
 * library on a value that holds an inch mark.
 *
 * One divergence stands: `logicalLines` removes an empty physical line
 * before it joins the folds, and the library removes an empty line only
 * after it. A fold that comes after an empty line therefore joins a line
 * here that it does not join in the library. The two readings then
 * disagree, and the gate refuses the text. No legal text puts a fold after
 * an empty line, and a refusal keeps the damaged reading out of a record.
 */

/** One parameter of a content line, as the text writes it. */
export interface ContentParameter {
	readonly name: string;
	/** The text of the value. A quoted value loses its quotation marks. */
	readonly text: string;
	/** True when quotation marks enclose the value in the text. */
	readonly quoted: boolean;
}

/** The name, the parameters and the value of one logical line. */
export interface ContentLine {
	readonly name: string;
	readonly parameters: readonly ContentParameter[];
	readonly value: string;
}

/** What a read of one logical line gives back. */
export type ContentLineReading =
	| { readonly ok: true; readonly line: ContentLine }
	| { readonly ok: false; readonly problem: string };

const LINE_BREAK = /\r\n|\n|\r/;

/**
 * The logical lines of the text. The function joins each folded piece to
 * the line that the piece continues, and it drops the one space or tab
 * that the fold added. The function gives null back when the text starts
 * with such a continuation, because no legal text starts that way.
 */
export function logicalLines(text: string): string[] | null {
	const lines: string[] = [];
	for (const physical of text.split(LINE_BREAK)) {
		if (physical === '') {
			continue;
		}
		if (physical.startsWith(' ') || physical.startsWith('\t')) {
			const opened = lines.pop();
			if (opened === undefined) {
				return null;
			}
			lines.push(opened + physical.slice(1));
			continue;
		}
		lines.push(physical);
	}
	return lines;
}

/**
 * Splits one logical line into the name, the parameters and the value.
 *
 * The read fails when the library and this reader cannot agree on the
 * line. Four lines fail: a line with no colon and no semicolon, a line
 * with a parameter that has no name, a line whose quoted parameter value
 * has no closing quotation mark, and a line that holds text between its
 * last parameter and its value. The library throws on the first three. On
 * the fourth the library drops that text, so a refusal is the safe answer.
 */
export function readContentLine(line: string): ContentLineReading {
	const nameEnd = firstDelimiter(line);
	if (nameEnd < 0) {
		return {
			ok: false,
			problem: 'holds no colon and no semicolon',
		};
	}
	const name = line.slice(0, nameEnd);
	if (line.charAt(nameEnd) === ':') {
		return {
			ok: true,
			line: { name, parameters: [], value: line.slice(nameEnd + 1) },
		};
	}
	const parameters: ContentParameter[] = [];
	let index = nameEnd;
	while (line.charAt(index) === ';') {
		const equals = line.indexOf('=', index + 1);
		if (equals < 0) {
			break;
		}
		const parameter = readParameter(line, index, equals);
		if (!parameter.ok) {
			return parameter;
		}
		parameters.push(parameter.value.value);
		index = parameter.value.next;
	}
	if (line.charAt(index) !== ':') {
		return {
			ok: false,
			problem: 'holds text between its last parameter and its value',
		};
	}
	return {
		ok: true,
		line: { name, parameters, value: line.slice(index + 1) },
	};
}

/**
 * True when the line holds a character that iCalendar forbids. The format
 * permits the horizontal tab, and it forbids every other control
 * character.
 */
export function hasControlCharacter(line: string): boolean {
	for (const character of line) {
		const code = character.codePointAt(0) ?? 0;
		if (code === 0x09) {
			continue;
		}
		if (code < 0x20 || code === 0x7f) {
			return true;
		}
	}
	return false;
}

/** One parameter, and the index at which the reader continues. */
interface ParameterReading {
	readonly value: ContentParameter;
	readonly next: number;
}

type ParameterResult =
	| { readonly ok: true; readonly value: ParameterReading }
	| { readonly ok: false; readonly problem: string };

function readParameter(
	line: string,
	start: number,
	equals: number,
): ParameterResult {
	const name = line.slice(start + 1, equals);
	if (name === '') {
		return { ok: false, problem: 'holds a parameter with no name' };
	}
	if (line.charAt(equals + 1) === '"') {
		return readQuotedParameter(line, name, equals);
	}
	const valueStart = equals + 1;
	const semicolon = line.indexOf(';', valueStart);
	const colon = line.indexOf(':', valueStart);
	const end = stopsHere(semicolon, colon)
		? colon < 0
			? line.length
			: colon
		: semicolon;
	return {
		ok: true,
		value: {
			value: { name, text: line.slice(valueStart, end), quoted: false },
			next: end,
		},
	};
}

function readQuotedParameter(
	line: string,
	name: string,
	equals: number,
): ParameterResult {
	const unclosed = {
		ok: false,
		problem:
			'holds a quoted parameter value with no closing quotation mark',
	} as const;
	const valueStart = equals + 2;
	let close = line.indexOf('"', valueStart);
	if (close < 0) {
		return unclosed;
	}
	// A parameter that carries more than one value writes each value in its
	// own quotation marks. The library reads across the comma between two
	// such values, so this reader does the same. Where the library reads
	// only the first value, the two readings of the text differ and the
	// gate reports the difference.
	while (line.charAt(close + 1) === ',' && line.charAt(close + 2) === '"') {
		const next = line.indexOf('"', close + 3);
		if (next < 0) {
			return unclosed;
		}
		close = next;
	}
	const text = line.slice(valueStart, close);
	const semicolon = line.indexOf(';', close);
	const colon = line.indexOf(':', close);
	return {
		ok: true,
		value: {
			value: { name, text, quoted: true },
			next: stopsHere(semicolon, colon) ? close + 1 : semicolon,
		},
	};
}

/** True when the parameter list ends here, and the value follows. */
function stopsHere(semicolon: number, colon: number): boolean {
	return semicolon < 0 || (colon >= 0 && semicolon > colon);
}

function firstDelimiter(line: string): number {
	const semicolon = line.indexOf(';');
	const colon = line.indexOf(':');
	if (semicolon < 0) {
		return colon;
	}
	if (colon < 0) {
		return semicolon;
	}
	return Math.min(semicolon, colon);
}
