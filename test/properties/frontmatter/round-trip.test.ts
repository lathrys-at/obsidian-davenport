/**
 * The rules of the frontmatter reader and the frontmatter writer, over
 * generated notes.
 *
 * The reader takes the keys of a note as the app hands them over. Every
 * value in that map comes from a person who typed it, so the reader meets
 * every kind of value that a person can write. Two rules hold over that
 * whole space:
 *
 * - A note that the reader accepts goes back into a note. The writer puts
 *   the schedule back, the reader reads it again, and the schedule is the
 *   same schedule with the same text.
 * - A note that the reader refuses states why. The reader never throws an
 *   error, it states one fault or more, and each fault names the key that
 *   holds it.
 *
 * The existing tests of the reader hold these rules against notes that a
 * person wrote. These tests hold them against notes that a generator
 * draws.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	SCHEMA_KEYS,
	isSchemaKey,
	ALL_DAY_KEYS,
	TIMED_KEYS,
} from '../../../src/core/frontmatter/keys';
import { readNote } from '../../../src/core/frontmatter/parse';
import { describeProblem } from '../../../src/core/frontmatter/problems';
import type { FrontmatterProblem } from '../../../src/core/frontmatter/problems';
import type { Raw } from '../../../src/core/frontmatter/reader';
import { validateNote } from '../../../src/core/frontmatter/validate';
import { applyPatch, schedulePatch } from '../../../src/core/frontmatter/write';
import {
	READ_KEYS,
	noteWithContradiction,
	noteWithOneFault,
	validNote,
} from '../../harness/arbitraries/frontmatter';
import { assertProperty } from '../../harness/arbitraries/seed';

/** The text of the faults of a note, for a failure report. */
function said(problems: readonly FrontmatterProblem[]): string {
	return problems.map(describeProblem).join(' / ');
}

/** The note that a write of this schedule makes, on its own. */
function writtenBack(raw: Raw): Record<string, unknown> {
	const reading = readNote(raw);
	const schedule = reading.fields.schedule;
	if (schedule === undefined) {
		throw new Error(
			`the note states no schedule: ${said(reading.problems)}`,
		);
	}
	const written: Record<string, unknown> = {};
	applyPatch(written, schedulePatch(schedule));
	return written;
}

describe('a note that the reader accepts', () => {
	it('states no fault', () => {
		assertProperty(
			fc.property(validNote(), (raw) => {
				const reading = readNote(raw);
				expect(said(reading.problems)).toBe('');
			}),
			300,
		);
	});

	it('states a schedule in one of the two shapes', () => {
		assertProperty(
			fc.property(validNote(), (raw) => {
				const reading = readNote(raw);
				expect(reading.schedule).not.toBeNull();
				expect(reading.fields.schedule).toBeDefined();
			}),
			300,
		);
	});

	it('gives the same schedule back after a write and a read', () => {
		assertProperty(
			fc.property(validNote(), (raw) => {
				const before = readNote(raw);
				const after = readNote(writtenBack(raw));
				expect(said(after.problems)).toBe('');
				expect(after.fields.schedule).toEqual(before.fields.schedule);
				expect(after.schedule).toEqual(before.schedule);
			}),
			300,
		);
	});

	it('gives the same note back after a second write and read', () => {
		assertProperty(
			fc.property(validNote(), (raw) => {
				const once = writtenBack(raw);
				expect(writtenBack(once)).toEqual(once);
			}),
			300,
		);
	});
});

describe('the write that puts a schedule into a note', () => {
	it('names every key of a schedule one time, and no other key', () => {
		assertProperty(
			fc.property(validNote(), (raw) => {
				const reading = readNote(raw);
				const schedule = reading.fields.schedule;
				expect(schedule).toBeDefined();
				if (schedule === undefined) {
					return;
				}
				const patch = schedulePatch(schedule);
				const set = patch.set.map(([key]) => key);
				const named = [...set, ...patch.remove];
				expect([...named].sort()).toEqual(
					[...TIMED_KEYS, ...ALL_DAY_KEYS].sort(),
				);
				expect(set.filter((key) => patch.remove.includes(key))).toEqual(
					[],
				);
			}),
			300,
		);
	});
});

describe('a note that the reader refuses', () => {
	it('states a fault that names the key of a faulty value', () => {
		assertProperty(
			fc.property(noteWithOneFault(), (faulty) => {
				const { problems } = readNote(faulty.raw);
				expect(problems.length).toBeGreaterThan(0);
				const named = problems.some((problem) =>
					problem.keys.includes(faulty.names),
				);
				expect(named, `${faulty.why}: ${said(problems)}`).toBe(true);
			}),
			400,
		);
	});

	it('states a fault that names the key of a contradiction', () => {
		assertProperty(
			fc.property(noteWithContradiction(), (faulty) => {
				const { problems } = readNote(faulty.raw);
				const named = problems.some((problem) =>
					problem.keys.includes(faulty.names),
				);
				expect(named, `${faulty.why}: ${said(problems)}`).toBe(true);
			}),
			300,
		);
	});

	it('names only keys that the schema holds, and describes each fault', () => {
		assertProperty(
			fc.property(noteWithOneFault(), (faulty) => {
				for (const problem of readNote(faulty.raw).problems) {
					expect(problem.keys.length).toBeGreaterThan(0);
					for (const key of problem.keys) {
						expect(isSchemaKey(key)).toBe(true);
					}
					expect(describeProblem(problem).length).toBeGreaterThan(0);
				}
			}),
			300,
		);
	});
});

describe('the reader over a map of any values', () => {
	const anyNote = fc
		.dictionary(fc.constantFrom(...SCHEMA_KEYS), fc.anything(), {
			maxKeys: 6,
		})
		.map((entries): Raw => entries);

	it('reads the map and throws no error', () => {
		assertProperty(
			fc.property(anyNote, (raw) => {
				const reading = readNote(raw);
				expect(Array.isArray(reading.problems)).toBe(true);
			}),
			500,
		);
	});

	it('names a key of the schema in every fault that it states', () => {
		assertProperty(
			fc.property(anyNote, (raw) => {
				for (const problem of readNote(raw).problems) {
					expect(problem.keys.length).toBeGreaterThan(0);
					for (const key of problem.keys) {
						expect(isSchemaKey(key)).toBe(true);
					}
					expect(describeProblem(problem).length).toBeGreaterThan(0);
				}
			}),
			500,
		);
	});

	it('states at least the faults of the read when it checks the zones', () => {
		assertProperty(
			fc.property(anyNote, fc.option(fc.string()), (raw, zone) => {
				const read = readNote(raw);
				const checked = validateNote(raw, {
					calendarTimezone: zone ?? undefined,
				});
				expect(checked.problems.slice(0, read.problems.length)).toEqual(
					read.problems,
				);
			}),
			400,
		);
	});
});

describe('the key that the reader passes over', () => {
	it('states no fault for a value under uid', () => {
		assertProperty(
			fc.property(fc.anything(), (value) => {
				expect(readNote({ uid: value }).problems).toEqual([]);
			}),
			200,
		);
	});

	it('reads every other key of the schema', () => {
		expect(READ_KEYS.length).toBe(SCHEMA_KEYS.length - 1);
	});
});
