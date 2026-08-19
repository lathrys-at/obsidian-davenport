/**
 * The offset fixture of the timezone table.
 *
 * The fixture states what one zone answers at one instant. The answers
 * come from `zic`, the compiler that the timezone project ships, over the
 * files that `tools/timezone-table/vendor/` holds. The tests of the table
 * therefore compare the plugin against a second reader of one release,
 * and not against the plugin itself.
 *
 * `tools/timezone-table/oracle.mjs` writes the fixture. The README of
 * that directory states when to write it again.
 *
 * The form of the file: a line with no indent states the name of a zone,
 * and each line under it states one answer. An answer is the instant in
 * seconds from the start of 1970, the offset from universal time in
 * seconds, then 1 for a daylight offset or 0 for a standard offset, then
 * the abbreviation.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One answer of one zone. */
export interface TimezoneOffsetRow {
	/** The instant, in seconds from the start of 1970. */
	readonly at: number;
	/** The offset from universal time, in seconds. */
	readonly offset: number;
	readonly isDaylight: boolean;
	readonly abbreviation: string;
}

/** One zone of the fixture, with its answers in order. */
export interface TimezoneOffsetZone {
	readonly name: string;
	readonly rows: readonly TimezoneOffsetRow[];
}

const FIXTURE = join(import.meta.dirname, 'timezone-offsets.txt');

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Every zone of the fixture, in the order of the file. */
export function timezoneOffsetFixture(): readonly TimezoneOffsetZone[] {
	const zones: { name: string; rows: TimezoneOffsetRow[] }[] = [];
	for (const line of utf8.decode(readFileSync(FIXTURE)).split('\n')) {
		if (line.length === 0) {
			continue;
		}
		if (!line.startsWith('\t')) {
			zones.push({ name: line, rows: [] });
			continue;
		}
		const zone = zones[zones.length - 1];
		if (zone === undefined) {
			throw new Error(
				`the offset fixture states an answer before it states a zone: ${line}`,
			);
		}
		const parts = line.slice(1).split(' ');
		if (parts.length !== 4) {
			throw new Error(
				`the offset fixture states a damaged answer: ${line}`,
			);
		}
		zone.rows.push({
			at: Number(parts[0]),
			offset: Number(parts[1]),
			isDaylight: parts[2] === '1',
			abbreviation: parts[3] ?? '',
		});
	}
	return zones;
}

/** The count of the answers that the fixture holds. */
export function timezoneOffsetRowCount(): number {
	return timezoneOffsetFixture().reduce(
		(total, zone) => total + zone.rows.length,
		0,
	);
}
