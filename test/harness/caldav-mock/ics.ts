/**
 * Reads only the iCalendar data that the mock needs. The mock needs this
 * data to answer queries, and to decide whether a write would notify the
 * attendees. The data is the component type, the UID, the attendee
 * addresses, and the start and the end that a time-range filter compares.
 *
 * The mock accepts these limits on purpose. The mock compares date-time
 * values as text after the mock normalizes them. The mock does not
 * resolve TZID. The mock does not add DURATION to DTSTART. The mock does
 * not expand RRULE, and thus the mock matches a recurring event on the
 * first instance only.
 */

import { icsPhysicalLines, readIcsLogicalLines } from '../ics-lines';
import { ICS_LINE_OCTET_LIMIT, octetLength } from '../ics-octets';

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface IcsFacts {
	/** The first component inside VCALENDAR that is not a VTIMEZONE. */
	readonly component: string | null;
	readonly uid: string | null;
	readonly attendees: readonly string[];
	/** The normalized comparison key, or null when the property is absent. */
	readonly start: string | null;
	readonly end: string | null;
}

/**
 * Returns the content lines of a resource that the server keeps, or of a
 * resource that a client sends. A client can send any text. Therefore
 * this function calls the shared reader in the form that accepts text of
 * any shape: the mock answers a request that carries a malformed body,
 * and the mock does not make the run that sent the request fail.
 */
function contentLines(ics: string): readonly string[] {
	return readIcsLogicalLines(icsPhysicalLines(ics)).lines;
}

export function readIcs(ics: string): IcsFacts {
	const stack: string[] = [];
	const attendees: string[] = [];
	let component: string | null = null;
	let uid: string | null = null;
	let start: string | null = null;
	let end: string | null = null;
	let startIsDate = false;

	for (const line of contentLines(ics)) {
		const { name, value } = splitLine(line);
		if (name === 'BEGIN') {
			stack.push(value);
			if (
				component === null &&
				stack.length === 2 &&
				stack[0] === 'VCALENDAR' &&
				value !== 'VTIMEZONE'
			) {
				component = value;
			}
			continue;
		}
		if (name === 'END') {
			stack.pop();
			continue;
		}
		if (
			component === null ||
			stack.length !== 2 ||
			stack[1] !== component
		) {
			continue;
		}
		if (name === 'UID' && uid === null) {
			uid = value;
		} else if (name === 'ATTENDEE') {
			attendees.push(value);
		} else if (name === 'DTSTART' && start === null) {
			start = normalizeStamp(value);
			startIsDate = isDateValue(value);
		} else if (name === 'DTEND' && end === null) {
			end = normalizeStamp(value);
		} else if (name === 'DUE' && end === null) {
			end = normalizeStamp(value);
		}
	}

	return {
		component,
		uid,
		attendees,
		start: start ?? end,
		end: end ?? impliedEnd(start, startIsDate),
	};
}

/**
 * Returns the end of an event that states no end. An all-day event is an
 * event with a DATE DTSTART and no DTEND. An all-day event covers the
 * full day, and thus a query over any part of that day finds the event.
 * An event that has a time and no end covers only the instant where the
 * event starts.
 */
function impliedEnd(start: string | null, startIsDate: boolean): string | null {
	if (start === null || !startIsDate) {
		return start;
	}
	return nextDayStamp(start);
}

/**
 * A DATE value has eight digits. A DATE-TIME value also carries the time.
 */
function isDateValue(value: string): boolean {
	return /^\d{8}$/.test(value);
}

/**
 * Returns the same comparison key one day later. The time of day does not
 * change.
 */
function nextDayStamp(stamp: string): string {
	const year = Number(stamp.slice(0, 4));
	const month = Number(stamp.slice(4, 6));
	const day = Number(stamp.slice(6, 8));
	if (day < daysInMonth(year, month)) {
		return `${stamp.slice(0, 6)}${pad(day + 1)}${stamp.slice(8)}`;
	}
	if (month < 12) {
		return `${stamp.slice(0, 4)}${pad(month + 1)}01${stamp.slice(8)}`;
	}
	return `${String(year + 1)}0101${stamp.slice(8)}`;
}

function daysInMonth(year: number, month: number): number {
	if (month === 2) {
		return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
			? 29
			: 28;
	}
	return MONTH_LENGTHS[month - 1] ?? 31;
}

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

/**
 * Builds the comparison key for a DATE value or a DATE-TIME value. This
 * function removes the zone designator. This function also extends a DATE
 * value to midnight of that date. Thus the values sort as text.
 */
export function normalizeStamp(value: string): string {
	const bare = value.endsWith('Z') ? value.slice(0, -1) : value;
	return bare.length === 8 ? `${bare}T000000` : bare;
}

/**
 * Writes the resource again, in the way of a server that does not keep
 * the bytes that the client sent. This function puts the property names
 * in upper case, builds the continuation lines again at 75 octets, and
 * uses CRLF line endings. These changes are fixed, and thus the same
 * input always gives the same output.
 */
export function reserialize(ics: string): string {
	const rebuilt: string[] = [];
	for (const line of contentLines(ics)) {
		const marker = nameEnd(line);
		const upper =
			marker === -1
				? line
				: line.slice(0, marker).toUpperCase() + line.slice(marker);
		rebuilt.push(...foldLine(upper));
	}
	return rebuilt.length === 0 ? '' : `${rebuilt.join('\r\n')}\r\n`;
}

function foldLine(line: string): string[] {
	if (octetLength(line) <= ICS_LINE_OCTET_LIMIT) {
		return [line];
	}
	const pieces: string[] = [];
	let current = '';
	let width = 0;
	// The space at the start of a continuation line counts against the
	// octet budget, so every line after the first line has one octet less
	// space for content.
	let budget = ICS_LINE_OCTET_LIMIT;
	for (const character of line) {
		const size = octetLength(character);
		if (width + size > budget) {
			pieces.push(current);
			current = '';
			width = 0;
			budget = ICS_LINE_OCTET_LIMIT - 1;
		}
		current += character;
		width += size;
	}
	pieces.push(current);
	return pieces.map((piece, index) => (index === 0 ? piece : ` ${piece}`));
}

function splitLine(line: string): { name: string; value: string } {
	const marker = nameEnd(line);
	if (marker === -1) {
		return { name: line.toUpperCase(), value: '' };
	}
	const colon = valueStart(line);
	return {
		name: line.slice(0, marker).toUpperCase(),
		value: colon === -1 ? '' : line.slice(colon + 1),
	};
}

/** Index of the first `;` or `:` outside a quoted parameter value. */
function nameEnd(line: string): number {
	let quoted = false;
	for (let index = 0; index < line.length; index += 1) {
		const character = line[index];
		if (character === '"') {
			quoted = !quoted;
		} else if (!quoted && (character === ';' || character === ':')) {
			return index;
		}
	}
	return -1;
}

function valueStart(line: string): number {
	let quoted = false;
	for (let index = 0; index < line.length; index += 1) {
		const character = line[index];
		if (character === '"') {
			quoted = !quoted;
		} else if (!quoted && character === ':') {
			return index;
		}
	}
	return -1;
}
