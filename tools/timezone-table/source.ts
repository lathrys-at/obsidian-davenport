/**
 * The reader of the timezone source files that the IANA release ships.
 *
 * A release states its data in a line-based format. Three kinds of line
 * carry the data. A rule line states one seasonal clock change and the
 * span of years in which that change repeats. A zone line states the
 * standard offset of one zone, the rules that apply to it, the form of
 * its abbreviation, and the moment at which the line stops. A link line
 * gives one more name to a zone.
 *
 * This module turns those lines into values. It reads the text only. It
 * computes no instant and it applies no rule. The expansion does that
 * work.
 *
 * The reader refuses every line that it does not understand. It names the
 * file and the line number in the refusal. A silent guess here would
 * become wrong bytes in a record, and only a reader that refuses can be
 * trusted.
 *
 * The reader also refuses a field that the format allows and the pinned
 * release does not use. A field that no input exercises is a field that no
 * test covers.
 */

import type { RuleDay } from '../../src/core/timezone/calendar.ts';

export type { RuleDay as SourceDay };

/** One file of the release, with its name for the refusal messages. */
export interface SourceFile {
	readonly name: string;
	readonly text: string;
}

/** Which clock a time in the source reads. */
export type TimeBase = 'wall' | 'standard' | 'universal';

/**
 * A time of day, in seconds from the start of the day. The value can
 * reach or pass one day: the source writes `24:00` for the end of a day.
 */
export interface SourceTime {
	readonly seconds: number;
	readonly base: TimeBase;
}

/** The last year that a rule can name. The source writes `maximum`. */
export const LAST_YEAR = 9999;

/** One seasonal clock change, and the years in which it repeats. */
export interface SourceRule {
	readonly name: string;
	readonly firstYear: number;
	readonly lastYear: number;
	/** The month, from 1 for January through 12 for December. */
	readonly month: number;
	readonly day: RuleDay;
	readonly at: SourceTime;
	/** The offset that this change adds to the standard offset, in seconds. */
	readonly save: number;
	/** The text that replaces the mark in a format. Empty for none. */
	readonly letters: string;
}

/** What decides the seasonal offset over the span of one zone line. */
export type SourceRules =
	| { readonly kind: 'standard' }
	| { readonly kind: 'constant'; readonly save: number }
	| { readonly kind: 'named'; readonly name: string };

/** The moment at which a zone line stops. */
export interface SourceUntil {
	readonly year: number;
	readonly month: number;
	readonly day: RuleDay;
	readonly at: SourceTime;
}

/** One line of a zone: the offset and the rules over one span of time. */
export interface SourceZoneLine {
	readonly standardOffset: number;
	readonly rules: SourceRules;
	readonly format: string;
	/** Absent on the last line of a zone, which never stops. */
	readonly until: SourceUntil | undefined;
}

/** One zone, with its lines in the order that the file states them. */
export interface SourceZone {
	readonly name: string;
	readonly lines: readonly SourceZoneLine[];
}

/** One more name for a zone. */
export interface SourceLink {
	readonly target: string;
	readonly name: string;
}

/** Everything that the release states. */
export interface TimezoneSource {
	readonly rules: ReadonlyMap<string, readonly SourceRule[]>;
	readonly zones: readonly SourceZone[];
	readonly links: readonly SourceLink[];
}

const MONTHS: readonly string[] = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

const WEEKDAYS: readonly string[] = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
];

/** The values that the release states, read from its files. */
export function parseTimezoneSource(
	files: readonly SourceFile[],
): TimezoneSource {
	const rules = new Map<string, SourceRule[]>();
	const zones: SourceZone[] = [];
	const links: SourceLink[] = [];
	for (const file of files) {
		readFile(file, rules, zones, links);
	}
	refuseRepeatedNames(zones, links);
	return { rules, zones, links };
}

function readFile(
	file: SourceFile,
	rules: Map<string, SourceRule[]>,
	zones: SourceZone[],
	links: SourceLink[],
): void {
	// A zone continues over the lines that follow it while each line
	// states a moment at which it stops. The line that states no such
	// moment is the last line of that zone.
	let open: { name: string; lines: SourceZoneLine[] } | undefined;
	const closeZone = (): void => {
		if (open !== undefined) {
			zones.push({ name: open.name, lines: open.lines });
			open = undefined;
		}
	};
	const lines = file.text.split('\n');
	for (const [index, raw] of lines.entries()) {
		const where = `${file.name}:${String(index + 1)}`;
		const fields = fieldsOf(raw);
		if (fields.length === 0) {
			continue;
		}
		const keyword = fields[0];
		if (keyword === 'Rule') {
			closeZone();
			const rule = readRule(fields, where);
			const kin = rules.get(rule.name);
			if (kin === undefined) {
				rules.set(rule.name, [rule]);
			} else {
				kin.push(rule);
			}
		} else if (keyword === 'Link') {
			closeZone();
			links.push(readLink(fields, where));
		} else if (keyword === 'Zone') {
			closeZone();
			if (fields.length < 5) {
				throw new Error(`${where}: a zone line states too few fields`);
			}
			const line = readZoneLine(fields.slice(2), where);
			open = { name: field(fields, 1, where), lines: [line] };
			if (line.until === undefined) {
				closeZone();
			}
		} else if (open !== undefined) {
			const line = readZoneLine(fields, where);
			open.lines.push(line);
			if (line.until === undefined) {
				closeZone();
			}
		} else {
			throw new Error(`${where}: the reader does not know this line`);
		}
	}
	closeZone();
}

/** The fields of one line, with the comment and the spacing removed. */
function fieldsOf(raw: string): readonly string[] {
	const hash = raw.indexOf('#');
	const body = hash === -1 ? raw : raw.slice(0, hash);
	return body.split(/[ \t\r]+/).filter((piece) => piece.length > 0);
}

function field(
	fields: readonly string[],
	index: number,
	where: string,
): string {
	const value = fields[index];
	if (value === undefined) {
		throw new Error(
			`${where}: the line stops before field ${String(index + 1)}`,
		);
	}
	return value;
}

function readRule(fields: readonly string[], where: string): SourceRule {
	if (fields.length !== 10) {
		throw new Error(
			`${where}: a rule line states ${String(fields.length)} fields, and the reader wants 10`,
		);
	}
	const firstYear = readYear(field(fields, 2, where), where);
	const toField = field(fields, 3, where);
	const lastYear = toField === 'only' ? firstYear : readYear(toField, where);
	const kind = field(fields, 4, where);
	if (kind !== '-') {
		throw new Error(
			`${where}: the fifth field of a rule line is ${kind}, and the reader wants a dash`,
		);
	}
	const letters = field(fields, 9, where);
	return {
		name: field(fields, 1, where),
		firstYear,
		lastYear,
		month: readMonth(field(fields, 5, where), where),
		day: readDay(field(fields, 6, where), where),
		at: readTime(field(fields, 7, where), where),
		save: readOffset(field(fields, 8, where), where),
		letters: letters === '-' ? '' : letters,
	};
}

function readLink(fields: readonly string[], where: string): SourceLink {
	if (fields.length !== 3) {
		throw new Error(
			`${where}: a link line states ${String(fields.length)} fields, and the reader wants 3`,
		);
	}
	return { target: field(fields, 1, where), name: field(fields, 2, where) };
}

function readZoneLine(
	fields: readonly string[],
	where: string,
): SourceZoneLine {
	if (fields.length < 3 || fields.length > 7) {
		throw new Error(
			`${where}: a zone line states ${String(fields.length)} fields, and the reader wants 3 to 7`,
		);
	}
	return {
		standardOffset: readOffset(field(fields, 0, where), where),
		rules: readRules(field(fields, 1, where), where),
		format: field(fields, 2, where),
		until:
			fields.length > 3 ? readUntil(fields.slice(3), where) : undefined,
	};
}

function readRules(text: string, where: string): SourceRules {
	if (text === '-') {
		return { kind: 'standard' };
	}
	// A rule name never starts with a digit or a sign, and a constant
	// offset always does. The two forms therefore never collide.
	if (/^[-+0-9]/.test(text)) {
		return { kind: 'constant', save: readOffset(text, where) };
	}
	return { kind: 'named', name: text };
}

function readUntil(fields: readonly string[], where: string): SourceUntil {
	const year = readYear(field(fields, 0, where), where);
	const month =
		fields.length > 1 ? readMonth(field(fields, 1, where), where) : 1;
	const day: RuleDay =
		fields.length > 2
			? readDay(field(fields, 2, where), where)
			: { kind: 'fixed', day: 1 };
	const at: SourceTime =
		fields.length > 3
			? readTime(field(fields, 3, where), where)
			: { seconds: 0, base: 'wall' };
	return { year, month, day, at };
}

function readYear(text: string, where: string): number {
	if (isPrefixOf(text, 'maximum')) {
		return LAST_YEAR;
	}
	if (!/^[0-9]{1,4}$/.test(text)) {
		throw new Error(`${where}: the reader does not know the year ${text}`);
	}
	return Number(text);
}

function readMonth(text: string, where: string): number {
	const index = MONTHS.findIndex((month) => isPrefixOf(text, month));
	if (index === -1) {
		throw new Error(`${where}: the reader does not know the month ${text}`);
	}
	return index + 1;
}

function readWeekday(text: string, where: string): number {
	const index = WEEKDAYS.findIndex((weekday) => isPrefixOf(text, weekday));
	if (index === -1) {
		throw new Error(
			`${where}: the reader does not know the weekday ${text}`,
		);
	}
	return index;
}

function readDay(text: string, where: string): RuleDay {
	if (/^[0-9]{1,2}$/.test(text)) {
		return { kind: 'fixed', day: Number(text) };
	}
	const last = /^last(.+)$/.exec(text);
	if (last !== null) {
		return { kind: 'last', weekday: readWeekday(last[1] ?? '', where) };
	}
	const compared = /^(.+?)(>=|<=)([0-9]{1,2})$/.exec(text);
	if (compared !== null) {
		const weekday = readWeekday(compared[1] ?? '', where);
		const day = Number(compared[3]);
		return compared[2] === '>='
			? { kind: 'onOrAfter', weekday, day }
			: { kind: 'onOrBefore', weekday, day };
	}
	throw new Error(`${where}: the reader does not know the day ${text}`);
}

function readTime(text: string, where: string): SourceTime {
	const marked = /^(.*?)([a-zA-Z])$/.exec(text);
	if (marked === null) {
		return { seconds: readOffset(text, where), base: 'wall' };
	}
	return {
		seconds: readOffset(marked[1] ?? '', where),
		base: readTimeBase(marked[2] ?? '', where),
	};
}

function readTimeBase(mark: string, where: string): TimeBase {
	// The format gives the universal clock three marks and the wall clock
	// one. The release uses two of the four, and the reader takes all of
	// them, because each one has one meaning in the format.
	if (mark === 'w') {
		return 'wall';
	}
	if (mark === 's') {
		return 'standard';
	}
	if (mark === 'u' || mark === 'g' || mark === 'z') {
		return 'universal';
	}
	throw new Error(`${where}: the reader does not know the time mark ${mark}`);
}

/**
 * The seconds of an offset. The source writes an offset as hours, then
 * minutes, then seconds, and it can leave out the parts that are zero.
 */
function readOffset(text: string, where: string): number {
	const parts =
		/^([-+]?)([0-9]{1,3})(?::([0-9]{1,2}))?(?::([0-9]{1,2}))?$/.exec(text);
	if (parts === null) {
		throw new Error(
			`${where}: the reader does not know the offset ${text}`,
		);
	}
	const hours = Number(parts[2]);
	const minutes = Number(parts[3] ?? '0');
	const seconds = Number(parts[4] ?? '0');
	const size = hours * 3600 + minutes * 60 + seconds;
	return parts[1] === '-' ? -size : size;
}

/**
 * True when the text names the word. The format lets a file shorten a
 * name to any prefix that stays unique, and the release shortens every
 * month and every weekday to three letters.
 */
function isPrefixOf(text: string, word: string): boolean {
	return (
		text.length > 0 &&
		text.length <= word.length &&
		word.slice(0, text.length).toLowerCase() === text.toLowerCase()
	);
}

function refuseRepeatedNames(
	zones: readonly SourceZone[],
	links: readonly SourceLink[],
): void {
	const seen = new Set<string>();
	for (const name of [
		...zones.map((zone) => zone.name),
		...links.map((link) => link.name),
	]) {
		if (seen.has(name)) {
			throw new Error(`the release states the name ${name} two times`);
		}
		seen.add(name);
	}
}
