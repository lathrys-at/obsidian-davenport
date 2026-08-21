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

	// A message that asked for the missing anchor would ask the user for a
	// note that states two shapes, and the next read of that note would
	// state the conflict of the two shapes.
	it.each([
		[
			{ date: '2026-03-14', end: '2026-03-14T10:00' },
			{ key: 'end', held: 'date', use: 'endDate' },
		],
		[
			{ date: '2026-03-14', duration: '1h' },
			{ key: 'duration', held: 'date', use: null },
		],
		[
			{ start: '2026-03-14T09:00', endDate: '2026-03-16' },
			{ key: 'endDate', held: 'start', use: 'end' },
		],
	])(
		'FM-2: a key beside the first key of the other shape names both shapes',
		(note, expected) => {
			const reading = readNote(note);
			expect(reading.problems).toEqual([
				{
					kind: 'shape-mismatch',
					keys: [expected.key, expected.held],
					...expected,
				},
			]);
			const message = firstMessage(reading.problems);
			expect(message).toContain(`"${expected.key}"`);
			expect(message).toContain(`"${expected.held}"`);
			expect(message).not.toContain('Add the key');
		},
	);

	it('FM-2: the note that names both shapes states no shape conflict', () => {
		const reading = readNote({
			date: '2026-03-14',
			end: '2026-03-14T10:00',
		});
		expect(reading.problems.map((problem) => problem.kind)).toEqual([
			'shape-mismatch',
		]);
		expect(reading.schedule).toMatchObject({ kind: 'all-day' });
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

	// The end of the timed shape is the first instant after the event, and
	// the format states that such an end stands after the start. The last
	// day of the all-day shape is part of the event, so that day can equal
	// the first day. The two rules are different for that reason.
	it('FM-2: an end that equals the start fails', () => {
		const reading = readNote({
			start: '2026-03-14T09:00',
			end: '2026-03-14T09:00',
		});
		expect(reading.problems).toEqual([
			{
				kind: 'end-before-start',
				keys: ['start', 'end'],
				start: 'start',
				end: 'end',
			},
		]);
		expect(firstMessage(reading.problems)).toContain(
			'does not state a time after',
		);
	});

	it('FM-2: a last day that equals the first day is one whole day', () => {
		const reading = readNote({ date: '2026-03-14', endDate: '2026-03-14' });
		expect(reading.problems).toEqual([]);
		expect(reading.schedule).toEqual({
			kind: 'all-day',
			date: { year: 2026, month: 3, day: 14 },
			endDate: { year: 2026, month: 3, day: 14 },
		});
	});

	it('FM-2: the offsets decide the order where both times state one', () => {
		const reading = readNote({
			start: '2026-03-14T09:00:00+01:00',
			end: '2026-03-14T08:30:00Z',
		});
		expect(reading.problems).toEqual([]);
	});

	// The two times state opposite offsets, so the end stands 21 hours before
	// the start. The three notes below put that pair inside one month, across
	// the end of a month, and across the end of a year. A comparison that
	// counted the days with an ordering key would pass the second note and
	// the third note.
	it.each([
		['2026-03-14T22:00:00-11:00', '2026-03-15T00:00:00+12:00'],
		['2026-03-31T22:00:00-11:00', '2026-04-01T00:00:00+12:00'],
		['2026-12-31T22:00:00-11:00', '2027-01-01T00:00:00+12:00'],
	])('FM-2: an end 21 hours before the start of %s fails', (start, end) => {
		const reading = readNote({ start, end });
		expect(reading.problems).toEqual([
			{
				kind: 'end-before-start',
				keys: ['start', 'end'],
				start: 'start',
				end: 'end',
			},
		]);
	});

	it('FM-2: an end one minute after the start across the end of a month passes', () => {
		const reading = readNote({
			start: '2026-03-31T23:59:00+00:00',
			end: '2026-04-01T00:00:00+00:00',
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
