/**
 * The reader of the bundled timezone table.
 *
 * The plugin ships one table of timezone rules. Every device that runs
 * one build of the plugin holds the same table, and every computation
 * whose result can reach the bytes of a record reads it. The database of
 * the operating system is a different dataset: it differs from device to
 * device, and a byte of a record must never follow from it.
 *
 * The generator under `tools/timezone-table/` writes the table from one
 * release of the timezone database. This module reads the table back.
 *
 * The form of a line of the table:
 *
 *     <name>|<types>|<initial>|<changes>|<terminal>
 *     <name>=<name>
 *
 * The second form states that this identifier holds the same clock as the
 * identifier on the right. The reader keeps the name that the caller
 * asked for, and never the name on the right. The release gives more than
 * one name to one zone, and the name that a user wrote is the name that
 * the plugin stores.
 *
 * - `<types>` states the states of the clock, with a semicolon between
 *   them. Each state is the offset from universal time in seconds, then 1
 *   for a daylight offset or 0 for a standard offset, then the
 *   abbreviation, with a comma between the three.
 * - `<initial>` is the place of the state that holds at the start of
 *   1970, counted from 0.
 * - `<changes>` states the changes after the start of 1970, with a
 *   semicolon between them. Each change is the count of minutes from the
 *   change before it in base 36, then a comma, then the place of the
 *   state that the change gives. The first change counts from the start
 *   of 1970. A change that does not fall on a whole minute carries a full
 *   stop and the seconds after the count of minutes.
 * - `<terminal>` states the pair of changes that the zone repeats every
 *   year after its last change, or a dash where the zone repeats no such
 *   pair. The pair is the place of the standard state, the place of the
 *   daylight state, the change that starts the daylight offset, and the
 *   change that ends it, with a comma between them. Each change is a
 *   month from 1, then the day, then the time of the change in seconds
 *   from the start of the local day, with a colon between them. The local
 *   day reads the clock that runs before the change.
 *
 * The reader reads no clock and it reads no file. It decodes one zone at
 * the first request for that zone, and it keeps the result.
 */

import type { RuleDay } from './calendar';
import { TIMEZONE_TABLE, TIMEZONE_TABLE_RELEASE } from './table-data';

export { TIMEZONE_TABLE_RELEASE };
export type { RuleDay };

/** One state of the clock of a zone. */
export interface TimezoneState {
	/** The offset from universal time, in seconds. */
	readonly offset: number;
	readonly isDaylight: boolean;
	readonly abbreviation: string;
}

/** One change of the clock of a zone. */
export interface TimezoneChange {
	/** The instant of the change, in seconds from the start of 1970. */
	readonly at: number;
	readonly state: TimezoneState;
}

/** One of the two changes that a zone repeats every year. */
export interface TerminalChange {
	/** The month, from 1 for January through 12 for December. */
	readonly month: number;
	readonly day: RuleDay;
	/**
	 * The time of the change, in seconds from the start of the local day.
	 * The local day reads the clock that runs before the change.
	 */
	readonly wallSeconds: number;
}

/** The pair of changes that a zone repeats every year. */
export interface TerminalRule {
	readonly standard: TimezoneState;
	readonly daylight: TimezoneState;
	readonly start: TerminalChange;
	readonly end: TerminalChange;
}

/** The rules of one zone. */
export interface TimezoneRules {
	/** The name that the caller asked for, and never another name. */
	readonly name: string;
	/** The state of the clock at the start of 1970. */
	readonly initial: TimezoneState;
	/** The changes after the start of 1970, in order. */
	readonly changes: readonly TimezoneChange[];
	/** Absent where the zone repeats no pair of changes. */
	readonly terminal: TerminalRule | undefined;
}

/** A reader over one table text. */
export interface TimezoneTable {
	/** The rules of one zone, or nothing where the table holds no such name. */
	rules(name: string): TimezoneRules | undefined;
	/** Every identifier that the table holds, in order. */
	names(): readonly string[];
	/** True when the table holds the given identifier. */
	has(name: string): boolean;
}

/**
 * A reader over the given table text. The reader decodes one zone at the
 * first request for that zone, and it keeps the result.
 */
export function readTimezoneTable(text: string): TimezoneTable {
	const lines = new Map<string, string>();
	for (const line of text.split('\n')) {
		if (line.length === 0) {
			continue;
		}
		const cut = firstSeparator(line);
		if (cut === -1) {
			throw new Error(`the timezone table holds a line with no name`);
		}
		lines.set(line.slice(0, cut), line.slice(cut));
	}
	const decoded = new Map<string, TimezoneRules>();
	return {
		names: () => [...lines.keys()],
		has: (name) => lines.has(name),
		rules(name) {
			const known = decoded.get(name);
			if (known !== undefined) {
				return known;
			}
			const body = bodyOf(lines, name);
			if (body === undefined) {
				return undefined;
			}
			const rules = { name, ...decodeBody(body, name) };
			decoded.set(name, rules);
			return rules;
		},
	};
}

/** The rules of one zone, or nothing where the table holds no such name. */
export function timezoneRules(name: string): TimezoneRules | undefined {
	return bundled().rules(name);
}

/** Every identifier that the bundled table holds, in order. */
export function timezoneNames(): readonly string[] {
	return bundled().names();
}

/** True when the bundled table holds the given identifier. */
export function isTimezoneName(name: string): boolean {
	return bundled().has(name);
}

let bundled_: TimezoneTable | undefined;

function bundled(): TimezoneTable {
	bundled_ ??= readTimezoneTable(TIMEZONE_TABLE);
	return bundled_;
}

/**
 * The place of the character that ends the name of a line. A name holds
 * neither of the two characters that can stand there.
 */
function firstSeparator(line: string): number {
	const bar = line.indexOf('|');
	const equals = line.indexOf('=');
	if (bar === -1) {
		return equals;
	}
	if (equals === -1) {
		return bar;
	}
	return Math.min(bar, equals);
}

/** The body of a line, with a name that points at another name followed. */
function bodyOf(
	lines: ReadonlyMap<string, string>,
	name: string,
): string | undefined {
	const tail = lines.get(name);
	if (tail === undefined) {
		return undefined;
	}
	if (tail.startsWith('|')) {
		return tail.slice(1);
	}
	const target = lines.get(tail.slice(1));
	if (!target?.startsWith('|')) {
		throw new Error(
			`the timezone table points ${name} at a name that holds no rules`,
		);
	}
	return target.slice(1);
}

function decodeBody(body: string, name: string): Omit<TimezoneRules, 'name'> {
	const parts = body.split('|');
	if (parts.length !== 4) {
		throw new Error(`the timezone table holds a damaged line for ${name}`);
	}
	const states = (parts[0] ?? '').split(';').map((text) => state(text, name));
	const at = (place: string): TimezoneState => {
		const found = states[Number(place)];
		if (found === undefined) {
			throw new Error(
				`the timezone table names a state that ${name} does not hold`,
			);
		}
		return found;
	};
	const initial = at(parts[1] ?? '');
	const changesText = parts[2] ?? '';
	const changes: TimezoneChange[] = [];
	let previous = 0;
	if (changesText.length > 0) {
		for (const text of changesText.split(';')) {
			const comma = text.lastIndexOf(',');
			previous += seconds(text.slice(0, comma));
			changes.push({ at: previous, state: at(text.slice(comma + 1)) });
		}
	}
	const terminalText = parts[3] ?? '';
	return {
		initial,
		changes,
		terminal:
			terminalText === '-' ? undefined : terminal(terminalText, at, name),
	};
}

function state(text: string, name: string): TimezoneState {
	const first = text.indexOf(',');
	const second = text.indexOf(',', first + 1);
	if (first === -1 || second === -1) {
		throw new Error(`the timezone table holds a damaged state for ${name}`);
	}
	return {
		offset: Number(text.slice(0, first)),
		isDaylight: text.slice(first + 1, second) === '1',
		abbreviation: text.slice(second + 1),
	};
}

/** The seconds that a count of minutes in base 36 states. */
function seconds(text: string): number {
	const stop = text.indexOf('.');
	if (stop === -1) {
		return Number.parseInt(text, 36) * 60;
	}
	return (
		Number.parseInt(text.slice(0, stop), 36) * 60 +
		Number(text.slice(stop + 1))
	);
}

function terminal(
	text: string,
	at: (place: string) => TimezoneState,
	name: string,
): TerminalRule {
	const parts = text.split(',');
	if (parts.length !== 4) {
		throw new Error(
			`the timezone table holds a damaged repeating pair for ${name}`,
		);
	}
	return {
		standard: at(parts[0] ?? ''),
		daylight: at(parts[1] ?? ''),
		start: terminalChange(parts[2] ?? '', name),
		end: terminalChange(parts[3] ?? '', name),
	};
}

function terminalChange(text: string, name: string): TerminalChange {
	const parts = text.split(':');
	if (parts.length !== 3) {
		throw new Error(
			`the timezone table holds a damaged repeating change for ${name}`,
		);
	}
	return {
		month: Number(parts[0]),
		day: terminalDay(parts[1] ?? '', name),
		wallSeconds: Number(parts[2]),
	};
}

function terminalDay(text: string, name: string): RuleDay {
	const mark = text.slice(0, 1);
	const rest = text.slice(1);
	if (mark === 'd') {
		return { kind: 'fixed', day: Number(rest) };
	}
	if (mark === 'l') {
		return { kind: 'last', weekday: Number(rest) };
	}
	const stop = rest.indexOf('.');
	if ((mark === 'a' || mark === 'b') && stop !== -1) {
		const weekday = Number(rest.slice(0, stop));
		const day = Number(rest.slice(stop + 1));
		return mark === 'a'
			? { kind: 'onOrAfter', weekday, day }
			: { kind: 'onOrBefore', weekday, day };
	}
	throw new Error(`the timezone table holds a damaged day for ${name}`);
}
