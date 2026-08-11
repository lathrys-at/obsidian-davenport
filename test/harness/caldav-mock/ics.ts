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

const FOLD_WIDTH = 75;

export interface IcsFacts {
	/** The first component inside VCALENDAR that is not a VTIMEZONE. */
	readonly component: string | null;
	readonly uid: string | null;
	readonly attendees: readonly string[];
	/** Normalized comparison key, or null where the property is absent. */
	readonly start: string | null;
	readonly end: string | null;
}

/** Splits on any line ending and rejoins folded continuation lines. */
export function unfoldLines(ics: string): string[] {
	const lines: string[] = [];
	for (const raw of ics.split(/\r\n|\n|\r/)) {
		const continuation = raw.startsWith(' ') || raw.startsWith('\t');
		const previous = lines.length - 1;
		const head = lines[previous];
		if (continuation && head !== undefined) {
			lines[previous] = head + raw.slice(1);
		} else {
			lines.push(raw);
		}
	}
	while (lines.length > 0 && lines[lines.length - 1] === '') {
		lines.pop();
	}
	return lines;
}

export function readIcs(ics: string): IcsFacts {
	const stack: string[] = [];
	const attendees: string[] = [];
	let component: string | null = null;
	let uid: string | null = null;
	let start: string | null = null;
	let end: string | null = null;

	for (const line of unfoldLines(ics)) {
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
		end: end ?? start,
	};
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
	for (const line of unfoldLines(ics)) {
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
	const encoder = new TextEncoder();
	if (encoder.encode(line).length <= FOLD_WIDTH) {
		return [line];
	}
	const pieces: string[] = [];
	let current = '';
	let width = 0;
	// The continuation space counts toward the octet budget, so every line
	// after the first has one octet less room for content.
	let budget = FOLD_WIDTH;
	for (const character of line) {
		const size = encoder.encode(character).length;
		if (width + size > budget) {
			pieces.push(current);
			current = '';
			width = 0;
			budget = FOLD_WIDTH - 1;
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
