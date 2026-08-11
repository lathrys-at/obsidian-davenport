/**
 * Line-level reading of iCalendar text. The corpus fixtures are stored as
 * the octets a server would send, so anything that inspects them has to
 * know that a long line is folded across several physical ones.
 *
 * The readers take text as it comes. A server sends CRLF, but a client may
 * send anything and a fixture may be written by hand, so every line ending
 * is read as one and a text that is not well formed is still read rather
 * than refused — the callers that judge well-formedness say so themselves,
 * and the ones that only want the properties get them.
 */

/** Every line ending the readers accept: CRLF, a lone LF, and a lone CR. */
const LINE_BREAK = /\r\n|\n|\r/;

/**
 * The pieces a text splits into at its line breaks, the terminator
 * included: a text ending in a break ends with an empty piece. Joining the
 * pieces back with one ending reproduces a text whose breaks all agree,
 * which is what a caller rewriting a line in place needs; a text mixing
 * its breaks comes back written with whichever one the caller joined on.
 */
export function icsLineParts(text: string): string[] {
	return text.split(LINE_BREAK);
}

/**
 * The physical lines of an iCalendar text, in order and without their line
 * breaks. The break that terminates the last line ends it rather than
 * opening an empty one.
 */
export function icsPhysicalLines(text: string): string[] {
	const lines = icsLineParts(text);
	if (lines[lines.length - 1] === '') lines.pop();
	return lines;
}

/** Whether the line continues the line before it rather than opening one. */
export function isFoldedContinuation(line: string): boolean {
	return line.startsWith(' ') || line.startsWith('\t');
}

/** What no legal iCalendar text does, stated so a caller can refuse it. */
export const LEADING_CONTINUATION =
	'iCalendar text cannot open with a folded continuation';

/** Logical lines read from physical ones, with what was wrong with them. */
export interface IcsLogicalReading {
	readonly lines: string[];
	/** The first thing no legal text would have done; null when nothing was. */
	readonly problem: string | null;
}

/**
 * Reads logical lines without refusing anything. Each continuation gives
 * up exactly one leading white-space character — the one the fold inserted
 * — and joins the line it continues; a second one belongs to the value and
 * survives. A continuation with nothing to continue keeps its white space
 * and opens a line of its own, and is reported as the problem it is.
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
 * The logical lines the given physical lines encode. Throws where the
 * reading above reports a problem, so a caller asserting on well-formed
 * text says nothing about the malformed case and a caller reading whatever
 * arrived uses the reading instead.
 */
export function icsLogicalLines(lines: readonly string[]): string[] {
	const reading = readIcsLogicalLines(lines);
	if (reading.problem !== null) {
		throw new Error(reading.problem);
	}
	return reading.lines;
}
