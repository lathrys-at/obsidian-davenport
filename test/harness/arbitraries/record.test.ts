/**
 * The generator of a record must reach every key that a record can hold,
 * and it must reach the characters that make an emitter or a reader fail.
 * A generator that drew a record of two keys and plain letters would let
 * every rule of inversion pass over an input that says nothing.
 *
 * These cases read a sample of the generator and ask what the sample
 * covers. They also hold the two limits that the generator states at its
 * head: a base snapshot in the canonical form, and a list or a map that is
 * absent or holds something.
 */

import { describe, expect, it } from 'vitest';
import { parseIcs } from '../../../src/core/ics/parse';
import { serializeCalendar } from '../../../src/core/ics/serializer';
import { recordData, recordText } from './record';
import { samples } from './seed';

const SAMPLE = 400;

/** The characters that a text of a record must reach over a sample. */
const REACHED_CHARACTERS: readonly string[] = [
	'"',
	'\\',
	'\n',
	'\r',
	'\t',
	'\u0001',
	'\u007f',
	'\u2028',
	'\uFEFF',
	'😀',
	'\uD800',
	': ',
	'`',
	'---',
];

/** Every key that a record can carry, at the top and inside the fields. */
const TOP_KEYS: readonly string[] = [
	'identity',
	'resourceHref',
	'etag',
	'fields',
	'baseIcs',
	'venue',
	'materialization',
	'renderHashes',
	'tombstone',
	'normalizationVersion',
	'checksum',
];

const FIELD_KEYS: readonly string[] = [
	'summary',
	'schedule',
	'timezone',
	'rrule',
	'type',
	'task',
	'due',
	'completed',
	'priority',
	'rsvp',
	'description',
	'attachments',
	'alarm',
	'location',
	'categories',
	'class',
	'transp',
	'status',
];

describe('the texts of a record', () => {
	const drawn = samples(recordText(), SAMPLE);

	it.each(REACHED_CHARACTERS)('reaches the text %j', (fragment) => {
		expect(drawn.some((value) => value.includes(fragment))).toBe(true);
	});

	it('reaches an empty text', () => {
		expect(drawn).toContain('');
	});
});

describe('the content of a record', () => {
	const drawn = samples(recordData(), SAMPLE);

	it('reaches every key that a record can hold', () => {
		const seen = new Set(drawn.flatMap((data) => Object.keys(data)));
		for (const key of TOP_KEYS) {
			expect(seen.has(key)).toBe(true);
		}
	});

	it('reaches every field that a record can state', () => {
		const seen = new Set(drawn.flatMap((data) => Object.keys(data.fields)));
		for (const key of FIELD_KEYS) {
			expect(seen.has(key)).toBe(true);
		}
	});

	it('reaches a record that holds the smallest set of keys', () => {
		expect(drawn.some((data) => Object.keys(data).length === 5)).toBe(true);
	});

	it('reaches both shapes of a schedule', () => {
		const shapes = drawn
			.map((data) => data.fields.schedule?.kind)
			.filter((kind) => kind !== undefined);
		expect(shapes).toContain('timed');
		expect(shapes).toContain('all-day');
	});

	it('reaches a mark that says the event is gone, with a successor', () => {
		expect(
			drawn.some((data) => data.tombstone?.annotation !== undefined),
		).toBe(true);
	});

	it('never states an empty list and never an empty map', () => {
		for (const data of drawn) {
			expect(data.fields.attachments?.length ?? 1).toBeGreaterThan(0);
			expect(data.fields.categories?.length ?? 1).toBeGreaterThan(0);
			expect(
				Object.keys(data.materialization ?? { one: 1 }).length,
			).toBeGreaterThan(0);
			expect(
				Object.keys(data.renderHashes ?? { one: 1 }).length,
			).toBeGreaterThan(0);
		}
	});

	it('states a base snapshot in the canonical form', () => {
		for (const data of drawn) {
			const parsed = parseIcs(data.baseIcs);
			expect(parsed.ok).toBe(true);
			if (parsed.ok) {
				expect(serializeCalendar(parsed.calendar)).toBe(data.baseIcs);
			}
		}
	});

	it('states a checksum in the alphabet that the checksum line takes', () => {
		for (const data of drawn) {
			expect(data.checksum).toMatch(/^[0-9a-f]*$/);
		}
	});
});
