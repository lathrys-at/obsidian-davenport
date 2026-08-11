/**
 * Line-level reading of iCalendar text. The corpus fixtures are stored as the
 * octets a server would send, so anything that inspects them has to know that
 * lines end in CRLF and that a long line is folded across several of them.
 */

const encoder = new TextEncoder();

/** The octet count a physical line may reach, its line break excluded. */
export const ICS_LINE_OCTET_LIMIT = 75;

/** The number of octets the text occupies encoded as UTF-8. */
export function octetLength(text: string): number {
	return encoder.encode(text).length;
}

/**
 * The physical lines of an iCalendar text, in order and without their line
 * breaks. The CRLF that terminates the last line ends it rather than opening
 * an empty one; any other line break is left inside the line it appears in,
 * where a caller checking well-formedness will see it.
 */
export function icsPhysicalLines(text: string): string[] {
	const lines = text.split('\r\n');
	if (lines[lines.length - 1] === '') lines.pop();
	return lines;
}

/** Whether the line continues the line before it rather than opening one. */
export function isFoldedContinuation(line: string): boolean {
	return line.startsWith(' ') || line.startsWith('\t');
}

/**
 * The logical lines the given physical lines encode. Each continuation gives
 * up exactly one leading white-space character — the one the fold inserted —
 * and joins the line it continues; a second one belongs to the value and
 * survives. Throws when the first line is a continuation, which no legal
 * iCalendar text produces.
 */
export function icsLogicalLines(lines: readonly string[]): string[] {
	const logical: string[] = [];
	for (const line of lines) {
		if (!isFoldedContinuation(line)) {
			logical.push(line);
			continue;
		}
		const opened = logical.pop();
		if (opened === undefined) {
			throw new Error(
				'iCalendar text cannot open with a folded continuation',
			);
		}
		logical.push(opened + line.slice(1));
	}
	return logical;
}
