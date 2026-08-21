/**
 * The generators of notes must reach the whole schema. A generator that
 * drew only a summary would leave every other key untested, and the round
 * trip of a schedule would never run at all.
 *
 * These cases read a sample of each generator. They ask whether the sample
 * reaches every key, both shapes of a schedule, and every kind of fault
 * that the generator states.
 */

import { describe, expect, it } from 'vitest';
import { SCHEMA_KEYS } from '../../../src/core/frontmatter/keys';
import { readNote } from '../../../src/core/frontmatter/parse';
import {
	READ_KEYS,
	alarmText,
	dayText,
	durationText,
	noteWithContradiction,
	noteWithOneFault,
	stampText,
	validNote,
} from './frontmatter';
import { samples } from './seed';

const SAMPLE = 600;

describe('the keys that the reader reads', () => {
	it('holds every key of the schema but the one that nothing reads', () => {
		expect([...READ_KEYS, 'uid'].sort()).toEqual([...SCHEMA_KEYS].sort());
	});
});

describe('a note that the reader accepts', () => {
	const drawn = samples(validNote(), SAMPLE);

	it('reaches every key of the schema', () => {
		const seen = new Set(drawn.flatMap((note) => Object.keys(note)));
		for (const key of SCHEMA_KEYS) {
			expect(seen.has(key)).toBe(true);
		}
	});

	it('reaches both shapes of a schedule', () => {
		expect(drawn.some((note) => 'start' in note)).toBe(true);
		expect(drawn.some((note) => 'date' in note)).toBe(true);
	});

	it('reaches a start with an end and a start with a length of time', () => {
		expect(drawn.some((note) => 'end' in note)).toBe(true);
		expect(drawn.some((note) => 'duration' in note)).toBe(true);
	});

	it('never states an end and a length of time together', () => {
		for (const note of drawn) {
			expect('end' in note && 'duration' in note).toBe(false);
		}
	});

	it('never states a key of each shape together', () => {
		for (const note of drawn) {
			expect('start' in note && 'date' in note).toBe(false);
		}
	});

	it('reaches a note that holds the schedule and nothing else', () => {
		expect(drawn.some((note) => Object.keys(note).length === 1)).toBe(true);
	});
});

describe('the texts that a note carries', () => {
	it('states a day in the shape that the schema takes', () => {
		for (const text of samples(dayText(), 200)) {
			expect(text).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		}
	});

	it('reaches a time of day with an offset, with Z, and with neither', () => {
		const drawn = samples(stampText(), SAMPLE);
		expect(drawn.some((text) => text.endsWith('Z'))).toBe(true);
		expect(drawn.some((text) => /[+-]\d{2}(?::?\d{2})?$/.test(text))).toBe(
			true,
		);
		expect(
			drawn.some((text) => /T\d{2}:\d{2}(?::\d{2})?$/.test(text)),
		).toBe(true);
	});

	it('states a length of time with the units in one order', () => {
		for (const text of samples(durationText(), 200)) {
			expect(text).toMatch(
				/^(?:\d+w)?(?:\d+d)?(?:\d+h)?(?:\d+m)?(?:\d+s)?$/,
			);
			expect(text.length).toBeGreaterThan(0);
		}
	});

	it('reaches a reminder before the start and one after it', () => {
		const drawn = samples(alarmText(), 200);
		expect(drawn.some((text) => text.startsWith('-'))).toBe(true);
		expect(drawn.some((text) => text.startsWith('+'))).toBe(true);
	});
});

describe('a note that holds one faulty value', () => {
	const drawn = samples(noteWithOneFault(), SAMPLE);

	it('reaches every key that the reader reads for a value', () => {
		const seen = new Set(drawn.map((faulty) => faulty.names));
		const missing = READ_KEYS.filter(
			(key) =>
				key !== 'date' &&
				key !== 'endDate' &&
				key !== 'end' &&
				!seen.has(key),
		);
		expect(missing).toEqual([]);
	});

	it('always makes the reader state a fault', () => {
		for (const faulty of drawn) {
			expect(readNote(faulty.raw).problems.length).toBeGreaterThan(0);
		}
	});
});

describe('a note whose keys contradict each other', () => {
	const drawn = samples(noteWithContradiction(), SAMPLE);

	it('reaches every kind of contradiction', () => {
		const seen = new Set(drawn.map((faulty) => faulty.why));
		expect(seen.size).toBe(7);
	});

	it('always makes the reader state a fault', () => {
		for (const faulty of drawn) {
			expect(readNote(faulty.raw).problems.length).toBeGreaterThan(0);
		}
	});
});
