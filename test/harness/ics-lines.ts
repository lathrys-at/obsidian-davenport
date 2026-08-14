/**
 * Reads iCalendar text one line at a time.
 *
 * iCalendar limits how long a line can be. A writer therefore splits a
 * long line across two or more lines, and starts each line after the first
 * with one space or one tab. This split is a fold. The lines that the
 * writer sends are the physical lines, and the line that the folded pieces
 * make together is the logical line. The corpus fixtures hold the octets
 * that a server sends. Every reader of a fixture must therefore know that
 * a writer folds a long line across two or more physical lines.
 *
 * The functions here take the text as it comes. A server sends CRLF at the
 * end of a line. A client can send another line ending, and a person can
 * write a fixture by hand. The split therefore accepts CRLF, a lone LF,
 * and a lone CR. `icsLogicalLines` is the one function here that refuses
 * text that is not well formed. That function throws when
 * `readIcsLogicalLines` reports a problem. Every other function here reads
 * text that is not well formed instead of refusing it, and the caller
 * decides what to do with such text. A caller that must judge whether the
 * text is well formed reports the problem itself. A caller that only wants
 * the properties gets the properties.
 */

/**
 * Every line ending that the functions here accept: CRLF, a lone LF, and a
 * lone CR.
 */
const LINE_BREAK = /\r\n|\n|\r/;

/**
 * Splits the text at each line break and returns the pieces. The function
 * keeps the piece that follows the last break, so a text that ends with a
 * break ends with an empty piece.
 *
 * A caller that joins the pieces again with one line ending gets a text in
 * which every line ending is the same. A caller that rewrites one line in
 * place needs the same line ending everywhere. If the given text mixes its
 * line endings, the joined text carries only the line ending that the
 * caller joined on.
 */
export function icsLineParts(text: string): string[] {
	return text.split(LINE_BREAK);
}

/**
 * Returns the physical lines of an iCalendar text, in order and without
 * their line breaks. A break at the end of the text closes the last line,
 * and does not start an empty line.
 */
export function icsPhysicalLines(text: string): string[] {
	const lines = icsLineParts(text);
	if (lines[lines.length - 1] === '') lines.pop();
	return lines;
}

/**
 * Returns true when the line continues the line before it, and false when
 * the line starts a logical line of its own.
 */
export function isFoldedContinuation(line: string): boolean {
	return line.startsWith(' ') || line.startsWith('\t');
}

/**
 * The problem that a text has when it starts with a folded continuation.
 * No legal iCalendar text starts this way. The message states the
 * problem, so that a caller can refuse the text.
 */
export const LEADING_CONTINUATION =
	'iCalendar text must not start with a folded continuation';

/**
 * The logical lines read from physical lines, together with the problem
 * that the reader found.
 */
export interface IcsLogicalReading {
	readonly lines: string[];
	/**
	 * The first thing in the text that no legal iCalendar text does. The
	 * value is null when the text does nothing of that kind.
	 */
	readonly problem: string | null;
}

/**
 * Reads the logical lines and refuses nothing.
 *
 * A continuation line gives up exactly one leading white-space character,
 * the one that the fold added, and joins the line that it continues. A
 * second white-space character belongs to the value, and that character
 * stays.
 *
 * A continuation line that has no line to continue keeps its white space
 * and starts a logical line of its own. The reading that the function
 * returns reports this leading continuation as the problem.
 */
export function readIcsLogicalLines(
	lines: readonly string[],
): IcsLogicalReading {
	const logical: string[] = [];
	let problem: string | null = null;
	for (const line of lines) {
		if (!isFoldedContinuation(line)) {
			logical.push(line);
			continue;
		}
		const opened = logical.pop();
		if (opened === undefined) {
			problem ??= LEADING_CONTINUATION;
			logical.push(line);
			continue;
		}
		logical.push(opened + line.slice(1));
	}
	return { lines: logical, problem };
}

/**
 * Returns the logical lines that the given physical lines encode. The
 * function throws when `readIcsLogicalLines` reports a problem. A caller
 * that asserts on well-formed text therefore says nothing about text that
 * is not well formed. A caller that must read whatever arrived calls
 * `readIcsLogicalLines` instead.
 */
export function icsLogicalLines(lines: readonly string[]): string[] {
	const reading = readIcsLogicalLines(lines);
	if (reading.problem !== null) {
		throw new Error(reading.problem);
	}
	return reading.lines;
}
