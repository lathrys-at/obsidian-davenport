/**
 * Writing iCalendar text: the octets a feed generator puts on the wire.
 * Content lines end in CRLF and fold at 75 octets, text values escape the
 * characters iCalendar reserves, and stamps are formatted from an explicit
 * epoch so nothing here reads the ambient clock.
 */

import { ICS_LINE_OCTET_LIMIT, octetLength } from '../ics-octets';

/** Escapes the characters iCalendar reserves inside a TEXT value. */
export function escapeIcsText(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r\n|[\n\r]/g, '\\n');
}

/**
 * The physical lines a content line folds into. A continuation opens with one
 * space, which counts against the octet limit, and a fold falls between whole
 * characters so no multi-byte sequence is split across lines.
 */
export function foldIcsLine(line: string): string[] {
	const physical: string[] = [];
	let current = '';
	let octets = 0;
	for (const character of line) {
		const size = octetLength(character);
		if (octets + size > ICS_LINE_OCTET_LIMIT) {
			physical.push(current);
			current = ' ';
			octets = 1;
		}
		current += character;
		octets += size;
	}
	physical.push(current);
	return physical;
}

/** The iCalendar text for the given content lines: folded, CRLF-terminated. */
export function icsText(lines: readonly string[]): string {
	return lines
		.flatMap(foldIcsLine)
		.map((line) => `${line}\r\n`)
		.join('');
}

function pad(value: number, width: number): string {
	return value.toString().padStart(width, '0');
}

/** ICS UTC date-time text for the given epoch milliseconds. */
export function icsUtcStamp(epochMs: number): string {
	const at = new Date(epochMs);
	const date = `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1, 2)}${pad(at.getUTCDate(), 2)}`;
	const time = `${pad(at.getUTCHours(), 2)}${pad(at.getUTCMinutes(), 2)}${pad(at.getUTCSeconds(), 2)}`;
	return `${date}T${time}Z`;
}

/** ICS all-day date text for the given epoch milliseconds. */
export function icsDateStamp(epochMs: number): string {
	const at = new Date(epochMs);
	return `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1, 2)}${pad(at.getUTCDate(), 2)}`;
}
