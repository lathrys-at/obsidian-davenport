/**
 * The writer of the timezone table.
 *
 * The table is text. One line states one timezone identifier, and the
 * lines take the order of their identifiers. A change of the release
 * therefore gives a difference that a person can read: the line of a zone
 * that changed, and no other line.
 *
 * A line takes one of two forms.
 *
 *     <name>|<types>|<initial>|<changes>|<terminal>
 *     <name>=<name>
 *
 * The second form states that this identifier holds the same clock as the
 * identifier on the right. The release gives more than one name to one
 * zone, and two zones of the release can also hold the same clock from
 * 1970. The reader keeps the name that it received in both conditions.
 * The table never replaces one name with another.
 *
 * The parts of the first form:
 *
 * - `<types>` states the states of the clock, one after the other, with a
 *   semicolon between them. Each state is the offset from universal time
 *   in seconds, then 1 for a daylight offset or 0 for a standard offset,
 *   then the abbreviation. A comma stands between the three.
 * - `<initial>` is the place of the state that holds at the start of
 *   1970, counted from 0.
 * - `<changes>` states the changes after the start of 1970, one after the
 *   other, with a semicolon between them. Each change is the count of
 *   minutes from the change before it, in base 36, then a comma, then the
 *   place of the state that the change gives. The first change counts
 *   from the start of 1970. The part is empty where the zone has no
 *   change. A change that does not fall on a whole minute carries a full
 *   stop and the seconds after the count of minutes. The release holds
 *   one such change. Base 36 and minutes hold these counts in about four
 *   characters, and the counts are most of the table.
 * - `<terminal>` states the pair of changes that the zone repeats every
 *   year after its last change. The part is a dash where the zone repeats
 *   no such pair, and the last state then holds for all the time after
 *   the last change. The pair is the place of the standard state, the
 *   place of the daylight state, the change that starts the daylight
 *   offset, and the change that ends it, with a comma between them. Each
 *   change is a month from 1, then the day, then the time of the change
 *   in seconds from the start of the local day, with a colon between
 *   them. The local day reads the clock that runs before the change. The
 *   day takes one of four forms, and a weekday is 0 for Sunday through 6
 *   for Saturday:
 *
 *       d<day>              that day of the month
 *       l<weekday>          the last such weekday of the month
 *       a<weekday>.<day>    that weekday, on or after that day
 *       b<weekday>.<day>    that weekday, on or before that day
 *
 * The writer refuses a value that the form cannot hold. A silent escape
 * or a silent loss here would put wrong bytes in a record.
 */

import type { RuleDay } from '../../src/core/timezone/calendar.ts';
import type {
	ExpandedZone,
	TerminalChange,
	TerminalRule,
	ZoneType,
} from './zone.ts';

/** The characters that keep the parts of a line apart. */
const SEPARATORS = '|;,:=';

/** The table text for the given zones and names. */
export function encodeTable(
	zones: readonly ExpandedZone[],
	names: readonly TableName[],
): string {
	const bodies = new Map<string, string>();
	const byName = new Map(zones.map((zone) => [zone.name, zone]));
	const lines: string[] = [];
	for (const name of [...names].sort(compareNames)) {
		const zone = byName.get(name.zone);
		if (zone === undefined) {
			throw new Error(
				`the name ${name.name} points at the zone ${name.zone}, and the release states no such zone`,
			);
		}
		refuseSeparators(name.name, 'a timezone identifier');
		const body = encodeZone(zone);
		const first = bodies.get(body);
		if (first === undefined) {
			bodies.set(body, name.name);
			lines.push(`${name.name}|${body}`);
		} else {
			lines.push(`${name.name}=${first}`);
		}
	}
	return `${lines.join('\n')}\n`;
}

/** One identifier of the release, and the zone whose clock it holds. */
export interface TableName {
	readonly name: string;
	readonly zone: string;
}

/** Every identifier of the release: the zones and then the links. */
export function tableNames(source: {
	readonly zones: readonly { readonly name: string }[];
	readonly links: readonly {
		readonly target: string;
		readonly name: string;
	}[];
}): readonly TableName[] {
	return [
		...source.zones.map((zone) => ({ name: zone.name, zone: zone.name })),
		...source.links.map((link) => ({
			name: link.name,
			zone: link.target,
		})),
	];
}

function encodeZone(zone: ExpandedZone): string {
	const types: ZoneType[] = [];
	const placeOf = (type: ZoneType): number => {
		const place = types.findIndex(
			(other) =>
				other.offset === type.offset &&
				other.isDaylight === type.isDaylight &&
				other.abbreviation === type.abbreviation,
		);
		if (place !== -1) {
			return place;
		}
		refuseSeparators(type.abbreviation, 'a timezone abbreviation');
		types.push(type);
		return types.length - 1;
	};
	const initial = placeOf(zone.initial);
	let previous = 0;
	const changes = zone.changes.map((change) => {
		const delta = change.at - previous;
		if (delta <= 0) {
			throw new Error(
				`the zone ${zone.name} states two changes at one instant, or states them out of order`,
			);
		}
		previous = change.at;
		const minutes = Math.floor(delta / 60);
		const seconds = delta - minutes * 60;
		const count =
			seconds === 0
				? minutes.toString(36)
				: `${minutes.toString(36)}.${String(seconds)}`;
		return `${count},${String(placeOf(change.type))}`;
	});
	const terminal =
		zone.terminal === undefined
			? '-'
			: encodeTerminal(zone.terminal, placeOf);
	const encodedTypes = types
		.map(
			(type) =>
				`${String(type.offset)},${type.isDaylight ? '1' : '0'},${type.abbreviation}`,
		)
		.join(';');
	return `${encodedTypes}|${String(initial)}|${changes.join(';')}|${terminal}`;
}

function encodeTerminal(
	terminal: TerminalRule,
	placeOf: (type: ZoneType) => number,
): string {
	const standard = placeOf(terminal.standard);
	const daylight = placeOf(terminal.daylight);
	return [
		String(standard),
		String(daylight),
		encodeTerminalChange(terminal.start),
		encodeTerminalChange(terminal.end),
	].join(',');
}

function encodeTerminalChange(change: TerminalChange): string {
	return `${String(change.month)}:${encodeDay(change.day)}:${String(change.wallSeconds)}`;
}

function encodeDay(day: RuleDay): string {
	if (day.kind === 'fixed') {
		return `d${String(day.day)}`;
	}
	if (day.kind === 'last') {
		return `l${String(day.weekday)}`;
	}
	const mark = day.kind === 'onOrAfter' ? 'a' : 'b';
	return `${mark}${String(day.weekday)}.${String(day.day)}`;
}

function refuseSeparators(value: string, what: string): void {
	for (const character of SEPARATORS) {
		if (value.includes(character)) {
			throw new Error(
				`${what} holds the character ${character}, and the table keeps the parts of a line apart with it: ${value}`,
			);
		}
	}
	if (value.includes('\n')) {
		throw new Error(`${what} holds a line break: ${value}`);
	}
}

function compareNames(left: TableName, right: TableName): number {
	if (left.name < right.name) {
		return -1;
	}
	return left.name > right.name ? 1 : 0;
}
