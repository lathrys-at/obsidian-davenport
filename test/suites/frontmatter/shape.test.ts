/**
 * The two shapes of a schedule, and the rule that a note takes one of the
 * two.
 *
 * The point of these tests is the pair of keys in each failure. A user who
 * sees one of these failures must see which two keys disagree, because the
 * plugin refuses to choose one of the two for the user.
 */

import { describe, expect, it } from 'vitest';
import { readNote } from '../../../src/core/frontmatter/parse';
import type { FrontmatterProblem } from '../../../src/core/frontmatter/problems';
import { describeProblem } from '../../../src/core/frontmatter/problems';

/** The words of the first fault of a note. */
function firstMessage(problems: readonly FrontmatterProblem[]): string {
	const problem = problems[0];
	if (problem === undefined) {
		throw new Error('the note states no fault');
	}
	return describeProblem(problem);
}

describe('FM-2 the shapes contradict each other', () => {
	it('FM-2: date together with start fails and names both keys', () => {
		const reading = readNote({
			date: '2026-03-14',
			start: '2026-03-14T09:00',
		});
		expect(reading.problems).toEqual([
			{ kind: 'shape-conflict', keys: ['date', 'start'] },
		]);
		const message = firstMessage(reading.problems);
		expect(message).toContain('"date"');
		expect(message).toContain('"start"');
	});

	it('FM-2: the note that states both shapes gets no schedule', () => {
		const reading = readNote({
			date: '2026-03-14',
			endDate: '2026-03-15',
			start: '2026-03-14T09:00',
			end: '2026-03-14T10:00',
		});
		expect(reading.schedule).toBeNull();
		expect(reading.fields.schedule).toBeUndefined();
		expect(reading.problems).toEqual([
			{ kind: 'shape-conflict', keys: ['date', 'start'] },
		]);
	});

	it('FM-2: end together with duration fails and names both keys', () => {
		const reading = readNote({
			start: '2026-03-14T09:00',
			end: '2026-03-14T10:00',
			duration: '1h',
		});
		expect(reading.problems).toEqual([
			{ kind: 'end-conflict', keys: ['end', 'duration'] },
		]);
		const message = firstMessage(reading.problems);
		expect(message).toContain('"end"');
		expect(message).toContain('"duration"');
	});

	it('FM-2: the note that states the end two times keeps its start and neither end', () => {
		const reading = readNote({
			start: '2026-03-14T09:00',
			end: '2026-03-14T10:00',
			duration: '1h',
		});
		expect(reading.schedule).toMatchObject({
			kind: 'timed',
			duration: null,
		});
		expect(reading.schedule).toMatchObject({ end: null });
		expect(reading.fields.schedule).toEqual({
			kind: 'timed',
			start: '2026-03-14T09:00',
		});
	});

	it('FM-2: an empty key of the other shape is not a contradiction', () => {
		const reading = readNote({ start: '2026-03-14T09:00', date: null });
		expect(reading.problems).toEqual([
			{ kind: 'empty-value', keys: ['date'], key: 'date' },
		]);
		expect(reading.schedule).toMatchObject({ kind: 'timed' });
	});
});

describe('FM-2 a key that stands without the key it needs', () => {
	it.each([
		['end', '2026-03-14T10:00', 'start'],
		['duration', '1h', 'start'],
		['endDate', '2026-03-16', 'date'],
	])('FM-2: %s without %s fails and names both keys', (key, value, needs) => {
		const reading = readNote({ [key]: value });
		expect(reading.problems).toEqual([
			{ kind: 'anchor-missing', keys: [key, needs], key, needs },
		]);
		const message = firstMessage(reading.problems);
		expect(message).toContain(`"${key}"`);
		expect(message).toContain(`"${needs}"`);
	});

	it('FM-2: an end of one shape beside the anchor of the other shape names the anchor it needs', () => {
		const reading = readNote({
			date: '2026-03-14',
			end: '2026-03-14T10:00',
		});
		expect(reading.problems).toEqual([
			{
				kind: 'anchor-missing',
				keys: ['end', 'start'],
				key: 'end',
				needs: 'start',
			},
		]);
	});
});

describe('FM-2 the end stands after the start', () => {
	it('FM-2: an end before the start fails and names both keys', () => {
		const reading = readNote({
			start: '2026-03-14T09:00',
			end: '2026-03-14T08:00',
		});
		expect(reading.problems).toEqual([
			{
				kind: 'end-before-start',
				keys: ['start', 'end'],
				start: 'start',
				end: 'end',
			},
		]);
		const message = firstMessage(reading.problems);
		expect(message).toContain('"start"');
		expect(message).toContain('"end"');
	});

	it('FM-2: a last day before the first day fails and names both keys', () => {
		const reading = readNote({ date: '2026-03-14', endDate: '2026-03-13' });
		expect(reading.problems).toEqual([
			{
				kind: 'end-before-start',
				keys: ['date', 'endDate'],
				start: 'date',
				end: 'endDate',
			},
		]);
	});

	it('FM-2: an end that equals the start is not a fault', () => {
		const reading = readNote({
			start: '2026-03-14T09:00',
			end: '2026-03-14T09:00',
		});
		expect(reading.problems).toEqual([]);
	});

	it('FM-2: the offsets decide the order where both times state one', () => {
		const reading = readNote({
			start: '2026-03-14T09:00:00+01:00',
			end: '2026-03-14T08:30:00Z',
		});
		expect(reading.problems).toEqual([]);
	});

	it('FM-2: the reader compares no time that states an offset with a time that states none', () => {
		const reading = readNote({
			start: '2026-03-14T09:00:00Z',
			end: '2026-03-14T08:00',
		});
		expect(reading.problems).toEqual([]);
		expect(reading.schedule).toMatchObject({ kind: 'timed' });
	});
});
