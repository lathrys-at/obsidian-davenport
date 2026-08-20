/**
 * The golden corpus of the timezone synthesiser.
 *
 * The gate holds the synthesiser to the bytes that it writes for a fixed
 * set of zones. Each zone of the set reaches at least one rule of the
 * synthesiser that no smaller zone reaches. The list below states which
 * rule each zone reaches. A rule that no zone of the set reaches can change
 * without a failure here. A new rule of the synthesiser therefore lands
 * together with a zone that reaches the rule.
 *
 * The bytes of a definition follow from two things: the release of the
 * bundled table, and the code that writes a definition from it. The
 * timezone component of the normalization stamp covers both. A change to
 * either one therefore moves that component, and this gate holds the two
 * together.
 *
 * Each set of golden files sits in a directory. The name of the directory
 * carries the value of the timezone component of the normalization stamp.
 * The directory `timezone-1/` therefore holds the bytes that the
 * synthesiser wrote while that component was 1. The layout ties a change of
 * the bytes to a change of the component in three ways.
 *
 * - A change to the synthesiser or to the table that does not raise the
 *   component reads the directory of the old value. The bytes in that
 *   directory differ from the new bytes, and the test fails and names the
 *   component.
 * - A change that raises the component finds no directory for the new
 *   value. The test then names the directory to write.
 * - A set that an earlier value wrote stays in the tree. The closure test
 *   reads every set, so an old set keeps its work after the synthesiser
 *   moves past it.
 *
 * The canonical serializer writes the text of each golden file. The
 * synthesiser writes a component that already stands in the canonical
 * order, so the serializer changes nothing in that component. A change to
 * the rules of the serializer can still change how a definition renders.
 * Such a change moves the core component of the stamp, and it does not
 * move the timezone component. The failure message of the gate states that
 * cause beside the other two.
 *
 * The environment variable `DAVENPORT_WRITE_TIMEZONE_GOLDENS` makes the
 * test write the set of the current component. The test then fails, so a
 * run that writes a set never reports success.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/** One zone of the gate, with the rule that the zone reaches. */
export interface TimezoneGoldenZone {
	/** The file name of the golden, without its extension. */
	readonly id: string;
	/** The zone name, as a user writes it. */
	readonly name: string;
	/** The rule of the synthesiser that this zone reaches. */
	readonly reaches: string;
}

/**
 * The zones of the gate. Each entry states the rule that the zone reaches.
 * The zones stand in the order of the size of their definitions, from the
 * smallest, so a reader meets the simple shapes first.
 */
export const TIMEZONE_GOLDEN_ZONES: readonly TimezoneGoldenZone[] = [
	{
		id: 'UTC',
		name: 'UTC',
		reaches:
			'A zone that never changes its clock. The definition holds the one observance that states the state at the start of 1970.',
	},
	{
		id: 'Asia-Calcutta',
		name: 'Asia/Calcutta',
		reaches:
			'An offset that is not a whole number of hours. The definition writes the minutes of the offset. The table holds the rules of this zone under this name.',
	},
	{
		id: 'Asia-Kolkata',
		name: 'Asia/Kolkata',
		reaches:
			'A name that the table points at another name. The definition takes the name that the caller wrote and the rules of the other name.',
	},
	{
		id: 'Africa-Monrovia',
		name: 'Africa/Monrovia',
		reaches:
			'An offset that is not a whole number of minutes. The definition writes the seconds of the offset. The zone also holds a history and no repeating pair.',
	},
	{
		id: 'Antarctica-Troll',
		name: 'Antarctica/Troll',
		reaches:
			'A repeating pair that names the last weekday of a month. The definition writes that day in the short form of the format. This is the smallest zone that holds an observance of each kind, so it also holds the order of the two kinds.',
	},
	{
		id: 'Pacific-Apia',
		name: 'Pacific/Apia',
		reaches:
			'A change that moves the zone across the date line. The wall clock of the zone therefore steps over a whole day, and the onsets of two observances stand more than a day apart in one step.',
	},
	{
		id: 'Europe-Dublin',
		name: 'Europe/Dublin',
		reaches:
			'A zone whose daylight offset stands behind its standard offset. The definition writes the winter state as the daylight observance, because the observance follows the state and not the season.',
	},
	{
		id: 'America-New_York',
		name: 'America/New_York',
		reaches:
			'A repeating pair that names the first weekday on or after a day of the month. The definition writes a window of seven days beside the weekday.',
	},
	{
		id: 'America-Scoresbysund',
		name: 'America/Scoresbysund',
		reaches:
			'A repeating change whose onset falls on the day before the day of the rule, and whose first occurrence follows an offset that the pair does not state. The definition writes that occurrence on its own and starts the rule after it.',
	},
	{
		id: 'Africa-Cairo',
		name: 'Africa/Cairo',
		reaches:
			'A repeating change whose onset falls on the day after the day of the rule and can cross the end of the month. The definition writes one rule for each month that the onset reaches.',
	},
	{
		id: 'Pacific-Easter',
		name: 'Pacific/Easter',
		reaches:
			'A repeating change whose onset falls on the day before the day of a window rule. The zone also stands in a daylight state at the start of 1970, so its first observance is a daylight observance.',
	},
	{
		id: 'Asia-Gaza',
		name: 'Asia/Gaza',
		reaches:
			'A repeating pair that names the last weekday on or before a day of the month. This is also the longest definition of the release.',
	},
];

/** One committed set of golden files. */
export interface TimezoneGoldenSet {
	/** The value of the timezone component that wrote this set. */
	readonly timezone: number;
	/** The path of the directory that holds the set. */
	readonly path: string;
	/** The file names in the set, in sorted order. */
	readonly ids: readonly string[];
}

/** The text of one golden file, with its CRLF line endings. */
export interface TimezoneGoldenEntry {
	readonly id: string;
	readonly text: string;
}

const GOLDEN_ROOT = join(import.meta.dirname, 'timezone-synthesiser');
const SET_PREFIX = 'timezone-';
const EXTENSION = '.ics';
const WRITE_VARIABLE = 'DAVENPORT_WRITE_TIMEZONE_GOLDENS';

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Every committed set, from the oldest component to the newest. */
export function timezoneGoldenSets(): readonly TimezoneGoldenSet[] {
	if (!existsSync(GOLDEN_ROOT)) {
		return [];
	}
	return readdirSync(GOLDEN_ROOT, { withFileTypes: true })
		.filter(
			(entry) => entry.isDirectory() && entry.name.startsWith(SET_PREFIX),
		)
		.map((entry) => readSet(entry.name))
		.sort((left, right) => left.timezone - right.timezone);
}

/** The set of one component value, or nothing when no set carries it. */
export function timezoneGoldenSet(
	timezone: number,
): TimezoneGoldenSet | undefined {
	return timezoneGoldenSets().find((set) => set.timezone === timezone);
}

/** The path that a set of the given component value takes. */
export function timezoneGoldenSetPath(timezone: number): string {
	return join(GOLDEN_ROOT, `${SET_PREFIX}${String(timezone)}`);
}

/** The text of one file of a set. */
export function timezoneGoldenText(set: TimezoneGoldenSet, id: string): string {
	return utf8.decode(readFileSync(join(set.path, `${id}${EXTENSION}`)));
}

/** True when the environment asks the test to write the set. */
export function timezoneGoldenWriteRequested(): boolean {
	return process.env[WRITE_VARIABLE] !== undefined;
}

/** Writes one set. The function replaces every file that the set holds. */
export function writeTimezoneGoldenSet(
	timezone: number,
	entries: readonly TimezoneGoldenEntry[],
): string {
	const path = timezoneGoldenSetPath(timezone);
	mkdirSync(path, { recursive: true });
	for (const entry of entries) {
		writeFileSync(
			join(path, `${entry.id}${EXTENSION}`),
			entry.text,
			'utf8',
		);
	}
	return path;
}

function readSet(directory: string): TimezoneGoldenSet {
	const path = join(GOLDEN_ROOT, directory);
	return {
		timezone: Number(directory.slice(SET_PREFIX.length)),
		path,
		ids: readdirSync(path)
			.filter((file) => file.endsWith(EXTENSION))
			.map((file) => file.slice(0, -EXTENSION.length))
			.sort(),
	};
}
