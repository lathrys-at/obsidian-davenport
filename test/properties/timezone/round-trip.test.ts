/**
 * The synthesised definition of every zone goes through the parse boundary
 * and comes back unchanged.
 *
 * The plugin writes a timezone definition of its own when a record names a
 * zone that the bundled table holds. That definition then travels: it goes
 * into the base snapshot of a record, a device reads the record again, and
 * a server can send the same definition back. Every step of that travel
 * goes through the parse boundary. A definition that the boundary refuses,
 * or that the boundary reads differently, would stop the record from
 * reaching a steady state.
 *
 * The table holds many zones, and only a few of them appear in the golden
 * corpus. These tests therefore read the whole table. The first group is
 * exhaustive: every name of the table, in batches. The second group draws
 * a zone and one change that keeps the meaning, and it asks whether the
 * canonical text stays where it was.
 *
 * The synthesiser reads no clock. It takes a name, and it reads the
 * bundled table. Therefore these tests need no controlled clock, and the
 * poison of the ambient time functions stays in place for the whole run.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { JCalComponent } from '../../../src/core/ics/jcal';
import { parseIcs } from '../../../src/core/ics/parse';
import { serializeCalendar } from '../../../src/core/ics/serializer';
import { definitionsOf } from '../../../src/core/ics/zones';
import { synthesiseTimezone } from '../../../src/core/timezone/synthesiser';
import { timezoneNames } from '../../../src/core/timezone/table';
import { icsMutation } from '../../harness/arbitraries/ics-mutations';
import { assertProperty } from '../../harness/arbitraries/seed';

/**
 * The number of zones that one test reads.
 *
 * The two whole-table checks beside the synthesiser read a batch of
 * twenty-five, because each of them expands the repeat rules of a
 * definition out to the next century. This check expands no rule: it
 * writes text, reads the text, and compares bytes. The whole table costs a
 * fraction of a second here, so a batch holds four times as many zones and
 * the report stays short.
 */
const ZONES_IN_A_BATCH = 100;

interface ZoneBatch {
	readonly first: string;
	readonly last: string;
	readonly names: readonly string[];
}

function zoneBatches(names: readonly string[]): readonly ZoneBatch[] {
	const batches: ZoneBatch[] = [];
	for (let start = 0; start < names.length; start += ZONES_IN_A_BATCH) {
		const batch = names.slice(start, start + ZONES_IN_A_BATCH);
		batches.push({
			first: batch[0] ?? '',
			last: batch[batch.length - 1] ?? '',
			names: batch,
		});
	}
	return batches;
}

/** The definition of the zone, as the synthesiser writes it. */
function definitionOf(name: string): JCalComponent {
	const result = synthesiseTimezone(name);
	if (!result.ok) {
		throw new Error(`the table holds no zone named ${name}`);
	}
	return result.component;
}

/** A calendar that holds the given text of a definition. */
function calendarAround(definition: string): string {
	return [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Davenport//timezone property//EN',
		definition.trimEnd(),
		'END:VCALENDAR',
		'',
	].join('\r\n');
}

/**
 * The definition that a calendar text holds under the given name, read
 * through the parse boundary and written again.
 */
function readBack(text: string, name: string): string {
	const parsed = parseIcs(text);
	if (!parsed.ok) {
		throw new Error(
			`the boundary refused the definition of ${name}: ${parsed.failure.message}`,
		);
	}
	const [definition, ...rest] = definitionsOf(parsed.calendar, name);
	if (definition === undefined) {
		throw new Error(`the text holds no definition that states ${name}`);
	}
	expect(rest).toEqual([]);
	return serializeCalendar(definition);
}

const NAMES = timezoneNames();

describe('the definition of every zone of the table', () => {
	it('reads a table that holds zones', () => {
		expect(NAMES.length).toBeGreaterThan(0);
	});

	it.each(zoneBatches(NAMES))(
		'goes through the boundary unchanged, from $first to $last',
		({ names }) => {
			for (const name of names) {
				const text = serializeCalendar(definitionOf(name));
				expect(readBack(calendarAround(text), name)).toBe(text);
			}
		},
	);
});

describe('a change that keeps the meaning of a definition', () => {
	it('leaves the canonical text of a drawn zone where it was', () => {
		assertProperty(
			fc.property(
				fc.constantFrom(...NAMES),
				icsMutation(),
				(name, mutation) => {
					const text = serializeCalendar(definitionOf(name));
					const whole = calendarAround(text);
					expect(readBack(mutation.apply(whole), name)).toBe(text);
				},
			),
			200,
		);
	});
});
