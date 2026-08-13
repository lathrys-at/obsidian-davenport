/**
 * Writes iCalendar text: the octets that a feed generator sends to a client.
 * The functions here obey three rules of the iCalendar format:
 *
 * 1. A content line that is longer than 75 octets folds into more than one
 *    physical line.
 * 2. Each physical line ends with a carriage return and a line feed (CRLF).
 * 3. A text value escapes the characters that iCalendar reserves.
 *
 * The two stamp functions take the time as `epochMs`, the number of
 * milliseconds after 1970-01-01 00:00:00 UTC. The caller gives this number.
 * Therefore no function here reads the system clock.
 */

import { ICS_LINE_OCTET_LIMIT, octetLength } from '../ics-octets';

/**
 * Escapes the characters that iCalendar reserves inside a TEXT value. The
 * function puts a backslash in front of each backslash, each semicolon, and
 * each comma. The function changes each line break into a backslash and the
 * letter n.
 */
export function escapeIcsText(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r\n|[\n\r]/g, '\\n');
}

/**
 * The physical lines that one content line folds into. Each physical line
 * after the first one is a continuation, and a continuation starts with one
 * space. This space counts towards the octet limit. A fold falls between two
 * whole characters. Therefore a fold never divides the octets of one
 * character across two lines.
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

/**
 * The iCalendar text for the given content lines. A content line that is too
 * long folds first. Each physical line then ends with CRLF.
 */
export function icsText(lines: readonly string[]): string {
	return lines
		.flatMap(foldIcsLine)
		.map((line) => `${line}\r\n`)
		.join('');
}

function pad(value: number, width: number): string {
	return value.toString().padStart(width, '0');
}

/**
 * The iCalendar UTC date-time text for the given time, for example
 * `20260810T093005Z`.
 */
export function icsUtcStamp(epochMs: number): string {
	const at = new Date(epochMs);
	const date = `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1, 2)}${pad(at.getUTCDate(), 2)}`;
	const time = `${pad(at.getUTCHours(), 2)}${pad(at.getUTCMinutes(), 2)}${pad(at.getUTCSeconds(), 2)}`;
	return `${date}T${time}Z`;
}

/**
 * The iCalendar date text for an all-day event, for example `20260810`. The
 * date is the UTC date of the given time.
 */
export function icsDateStamp(epochMs: number): string {
	const at = new Date(epochMs);
	return `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1, 2)}${pad(at.getUTCDate(), 2)}`;
}
