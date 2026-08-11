/**
 * Just enough iCalendar reading for the mock to answer queries and to
 * decide whether a write would notify attendees: the component type, UID,
 * attendee addresses, and the start and end a time-range filter compares.
 *
 * Boundaries the mock accepts deliberately: date-time values are compared
 * lexically after normalization, TZID is not resolved, DURATION is not
 * added to DTSTART, and RRULE is not expanded — a recurring event is
 * matched on its first instance only.
 */

import { icsPhysicalLines, readIcsLogicalLines } from '../ics-lines';
import { ICS_LINE_OCTET_LIMIT, octetLength } from '../ics-octets';

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface IcsFacts {
	/** The first component inside VCALENDAR that is not a VTIMEZONE. */
	readonly component: string | null;
	readonly uid: string | null;
	readonly attendees: readonly string[];
	/** Normalized comparison key, or null where the property is absent. */
	readonly start: string | null;
	readonly end: string | null;
}

/**
 * The content lines of a stored or submitted resource. A client sends what
 * it likes, so the shared reader is used in the form that takes text of
 * any shape: the mock answers a request about a malformed body rather than
 * failing the run that sent it.
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
 * What an event with no stated end covers. An all-day event — a DATE
 * DTSTART with no DTEND — spans the whole day, so a query over any part of
 * that day finds it; a timed event with no end is the instant it starts.
 */
function impliedEnd(start: string | null, startIsDate: boolean): string | null {
	if (start === null || !startIsDate) {
		return start;
	}
	return nextDayStamp(start);
}

/** A DATE value is eight digits; a DATE-TIME carries the time as well. */
function isDateValue(value: string): boolean {
	return /^\d{8}$/.test(value);
}

/** The same comparison key one day later, leaving the time of day alone. */
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
 * Comparison key for a DATE or DATE-TIME value: the zone designator is
 * dropped and a date is widened to midnight, so values sort as text.
 */
export function normalizeStamp(value: string): string {
	const bare = value.endsWith('Z') ? value.slice(0, -1) : value;
	return bare.length === 8 ? `${bare}T000000` : bare;
}

/**
 * A server that re-serializes rather than storing bytes: property names
 * uppercased, continuation lines rebuilt at 75 octets, CRLF endings. The
 * transformation is fixed, so the same input always yields the same
 * output.
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
	// The continuation space counts toward the octet budget, so every line
	// after the first has one octet less room for content.
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
