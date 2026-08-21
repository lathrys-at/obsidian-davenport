/**
 * The reader of the frontmatter, over the whole key vocabulary.
 *
 * The tests state a note as the object that the platform gives the engine,
 * which is what the reader takes. The first two tests read a note of each
 * shape, and together those two notes hold every key of the schema. A key
 * that the schema gains and these notes do not hold fails the last test of
 * the first group.
 */

import { describe, expect, it } from 'vitest';
import { SCHEMA_KEYS } from '../../../src/core/frontmatter/keys';
import { readNote } from '../../../src/core/frontmatter/parse';
import type { FrontmatterProblem } from '../../../src/core/frontmatter/problems';
import { describeProblem } from '../../../src/core/frontmatter/problems';
import { readFrontmatter } from '../../harness/obsidian-fake';

/** The first fault of a note. The helper refuses a note with no fault. */
function first(problems: readonly FrontmatterProblem[]): FrontmatterProblem {
	const problem = problems[0];
	if (problem === undefined) {
		throw new Error('the note states no fault');
	}
	return problem;
}

/** A timed note that holds every key that the timed shape permits. */
const TIMED_NOTE = {
	uid: 'ea2f1c40-3f2a-4d2b-9a1e-6c0d5f9b7a11',
	state: 'ready',
	calendar: 'Work',
	summary: 'Design review',
	start: '2026-03-14T09:00:00',
	end: '2026-03-14T10:30:00',
	timezone: 'Europe/London',
	rrule: 'FREQ=WEEKLY;BYDAY=SA',
	type: 'block',
	task: '[[Write the report]]',
	due: '2026-03-20',
	completed: '2026-03-19T18:00:00Z',
	priority: 5,
	rsvp: 'accepted',
	description: 'The team reads the draft.',
	attachments: ['[[Draft.pdf]]', 'https://example.invalid/agenda'],
	alarm: '-15m',
	location: 'Room 3',
	categories: ['work', 'design'],
	class: 'private',
	transp: 'opaque',
	status: 'confirmed',
};

/** An all-day note that holds the keys that the timed note cannot hold. */
const ALL_DAY_NOTE = {
	date: '2026-03-14',
	endDate: '2026-03-16',
	duration: '1h30m',
};

describe('FM-1 the key vocabulary', () => {
	it('FM-1: reads every key of the timed shape', () => {
		const reading = readNote(TIMED_NOTE);
		expect(reading.problems).toEqual([]);
		expect(reading.state).toBe('ready');
		expect(reading.fields).toEqual({
			summary: 'Design review',
			calendar: 'Work',
			schedule: {
				kind: 'timed',
				start: '2026-03-14T09:00:00',
				end: '2026-03-14T10:30:00',
			},
			timezone: 'Europe/London',
			rrule: 'FREQ=WEEKLY;BYDAY=SA',
			type: 'block',
			task: '[[Write the report]]',
			due: '2026-03-20',
			completed: '2026-03-19T18:00:00Z',
			priority: 5,
			rsvp: 'accepted',
			description: 'The team reads the draft.',
			attachments: ['[[Draft.pdf]]', 'https://example.invalid/agenda'],
			alarm: '-15m',
			location: 'Room 3',
			categories: ['work', 'design'],
			class: 'private',
			transp: 'opaque',
			status: 'confirmed',
		});
	});

	it('FM-1: reads the keys of the all-day shape', () => {
		const reading = readNote({ date: '2026-03-14', endDate: '2026-03-16' });
		expect(reading.problems).toEqual([]);
		expect(reading.schedule).toEqual({
			kind: 'all-day',
			date: { year: 2026, month: 3, day: 14 },
			endDate: { year: 2026, month: 3, day: 16 },
		});
		expect(reading.fields.schedule).toEqual({
			kind: 'all-day',
			date: '2026-03-14',
			endDate: '2026-03-16',
		});
	});

	it('FM-1: the two notes together hold every key of the schema', () => {
		const covered = new Set([
			...Object.keys(TIMED_NOTE),
			...Object.keys(ALL_DAY_NOTE),
		]);
		expect([...SCHEMA_KEYS].filter((key) => !covered.has(key))).toEqual([]);
	});

	it('FM-1: gives an empty note no schedule and no fault', () => {
		const reading = readNote({});
		expect(reading.problems).toEqual([]);
		expect(reading.schedule).toBeNull();
		expect(reading.state).toBeNull();
		expect(reading.fields).toEqual({ type: 'event' });
	});

	it('FM-1: passes over a key that the plugin does not own', () => {
		const reading = readNote({
			tags: ['meeting'],
			aliases: ['Review'],
			Start: '2026-03-14T09:00:00',
			Status: 'Open',
			cssclasses: [],
		});
		expect(reading.problems).toEqual([]);
		expect(reading.schedule).toBeNull();
		expect(reading.fields).toEqual({ type: 'event' });
	});
});

describe('FM-1 the duration forms', () => {
	it.each([
		['30m', { minutes: 30 }],
		['1h30m', { hours: 1, minutes: 30 }],
		['1h', { hours: 1 }],
		['45s', { seconds: 45 }],
		['2d3h', { days: 2, hours: 3 }],
		['1w', { weeks: 1 }],
		['1w2d3h4m5s', { weeks: 1, days: 2, hours: 3, minutes: 4, seconds: 5 }],
		['1H30M', { hours: 1, minutes: 30 }],
		['+30m', { minutes: 30 }],
	])('FM-1: reads the length %s', (text, counts) => {
		const reading = readNote({
			start: '2026-03-14T09:00:00',
			duration: text,
		});
		expect(reading.problems).toEqual([]);
		expect(reading.schedule).toEqual({
			kind: 'timed',
			start: {
				kind: 'date-time',
				date: { year: 2026, month: 3, day: 14 },
				time: { hour: 9, minute: 0, second: 0 },
				offsetSeconds: null,
			},
			end: null,
			duration: {
				negative: false,
				weeks: 0,
				days: 0,
				hours: 0,
				minutes: 0,
				seconds: 0,
				...counts,
			},
		});
	});

	it.each([
		['30', 'no-unit'],
		['30x', 'unknown-unit'],
		['1.5h', 'unknown-unit'],
		['h', 'no-count'],
		['1h1h', 'repeated-unit'],
		['30m1h', 'unit-order'],
		['1234567890s', 'too-large'],
		['-', 'empty'],
		['30 m', 'unknown-unit'],
	])('FM-1: refuses the length %s', (text, kind) => {
		const reading = readNote({
			start: '2026-03-14T09:00:00',
			duration: text,
		});
		const problem = first(reading.problems);
		expect(problem).toMatchObject({
			kind: 'bad-duration',
			key: 'duration',
			failure: { kind },
		});
		expect(describeProblem(problem)).toContain('"duration"');
	});

	it('FM-1: refuses a length of zero', () => {
		const reading = readNote({
			start: '2026-03-14T09:00:00',
			duration: '0m',
		});
		expect(reading.problems).toEqual([
			{
				kind: 'duration-not-positive',
				keys: ['duration'],
				key: 'duration',
			},
		]);
	});

	it('FM-1: refuses a length below zero', () => {
		const reading = readNote({
			start: '2026-03-14T09:00:00',
			duration: '-30m',
		});
		expect(reading.problems).toEqual([
			{
				kind: 'duration-not-positive',
				keys: ['duration'],
				key: 'duration',
			},
		]);
	});

	it('FM-1: reads a reminder that stands before the start', () => {
		const reading = readNote({ alarm: '-15m' });
		expect(reading.problems).toEqual([]);
		expect(reading.fields.alarm).toBe('-15m');
	});
});

describe('FM-1 the ISO 8601 variants', () => {
	it.each([
		['2026-03-14T09:00', 9, 0, 0, null],
		['2026-03-14T09:00:30', 9, 0, 30, null],
		['2026-03-14T09:00:00Z', 9, 0, 0, 0],
		['2026-03-14t09:00:00z', 9, 0, 0, 0],
		['2026-03-14T09:00+01:00', 9, 0, 0, 3600],
		['2026-03-14T09:00:00+0900', 9, 0, 0, 32400],
		['2026-03-14T09:00:00+09', 9, 0, 0, 32400],
		['2026-03-14T09:00:00-05:00', 9, 0, 0, -18000],
		['2026-03-14T09:00:00-00:00', 9, 0, 0, 0],
		['2026-03-14T23:59:59+14:00', 23, 59, 59, 50400],
	])(
		'FM-1: reads the start %s',
		(text, hour, minute, second, offsetSeconds) => {
			const reading = readNote({ start: text });
			expect(reading.problems).toEqual([]);
			expect(reading.schedule).toEqual({
				kind: 'timed',
				start: {
					kind: 'date-time',
					date: { year: 2026, month: 3, day: 14 },
					time: { hour, minute, second },
					offsetSeconds,
				},
				end: null,
				duration: null,
			});
		},
	);

	it.each([
		['14/03/2026', 'shape'],
		['2026-03-14 09:00', 'shape'],
		['2026-3-14T09:00', 'shape'],
		['2026-03-14T09', 'shape'],
		['2026-03-14T09:00:00.500', 'fraction'],
		['0099-03-14T09:00', 'year-range'],
		['2026-02-30T09:00', 'no-such-day'],
		['2026-13-01T09:00', 'no-such-day'],
		['2026-00-10T09:00', 'no-such-day'],
		['2026-03-00T09:00', 'no-such-day'],
		['2026-03-14T24:00', 'no-such-time'],
		['2026-03-14T09:60', 'no-such-time'],
		['2026-03-14T09:00:60', 'no-such-time'],
		['2026-03-14T09:00+24:00', 'offset-range'],
		['2026-03-14T09:00+01:60', 'offset-range'],
	])('FM-1: refuses the start %s', (text, kind) => {
		const reading = readNote({ start: text });
		const problem = first(reading.problems);
		expect(problem).toMatchObject({
			kind: 'bad-time',
			key: 'start',
			text,
			failure: { kind },
		});
		expect(describeProblem(problem)).toContain('"start"');
		expect(reading.schedule).toBeNull();
	});

	it('FM-1: reads the last day of a leap year', () => {
		const reading = readNote({ date: '2028-02-29' });
		expect(reading.problems).toEqual([]);
		expect(reading.schedule).toEqual({
			kind: 'all-day',
			date: { year: 2028, month: 2, day: 29 },
			endDate: null,
		});
	});

	it('FM-1: refuses the 29th of February in a year of 365 days', () => {
		const reading = readNote({ date: '2026-02-29' });
		expect(reading.problems[0]).toMatchObject({
			kind: 'bad-time',
			key: 'date',
			failure: { kind: 'no-such-day' },
		});
	});

	it('FM-1: refuses a day with a time of day under the all-day shape', () => {
		const reading = readNote({ date: '2026-03-14T09:00' });
		const problem = first(reading.problems);
		expect(problem).toMatchObject({
			kind: 'time-of-day-refused',
			key: 'date',
		});
		expect(describeProblem(problem)).toContain('"start"');
	});

	it('FM-1: refuses a day with no time of day under the timed shape', () => {
		const reading = readNote({ start: '2026-03-14' });
		const problem = first(reading.problems);
		expect(problem).toMatchObject({
			kind: 'time-of-day-missing',
			key: 'start',
		});
		expect(describeProblem(problem)).toContain('"date"');
	});
});

describe('FM-1 the values that a key refuses', () => {
	it.each([
		['summary', 42, 'a number'],
		['summary', true, 'a true or false value'],
		['calendar', ['Work'], 'a list'],
		['description', { text: 'x' }, 'a value of another kind'],
	])('FM-1: refuses %s that holds %s', (key, value, found) => {
		const reading = readNote({ [key]: value });
		const problem = first(reading.problems);
		expect(problem).toMatchObject({ kind: 'not-text', key, found });
		expect(describeProblem(problem)).toContain(`"${key}"`);
	});

	it.each([
		['summary', ''],
		['summary', null],
		['start', ''],
		['attachments', null],
	])('FM-1: reports the empty value of %s', (key, value) => {
		const reading = readNote({ [key]: value });
		expect(reading.problems).toEqual([
			{ kind: 'empty-value', keys: [key], key },
		]);
	});

	it('FM-1: refuses a list of values that are not text', () => {
		const reading = readNote({ categories: ['work', 7] });
		expect(reading.problems).toEqual([
			{
				kind: 'not-text',
				keys: ['categories'],
				key: 'categories',
				found: 'a number',
			},
		]);
	});

	it('FM-1: refuses a list that holds an item with no value', () => {
		const reading = readNote({ categories: ['work', null] });
		expect(reading.problems).toEqual([
			{
				kind: 'not-text',
				keys: ['categories'],
				key: 'categories',
				found: 'no value',
			},
		]);
	});

	it('FM-1: reports the priority that holds no value', () => {
		const reading = readNote({ priority: null });
		expect(reading.problems).toEqual([
			{ kind: 'empty-value', keys: ['priority'], key: 'priority' },
		]);
	});

	it('FM-1: refuses one value where the key holds a list', () => {
		const reading = readNote({ attachments: '[[Draft.pdf]]' });
		expect(reading.problems).toEqual([
			{ kind: 'not-a-list', keys: ['attachments'], key: 'attachments' },
		]);
	});

	it.each([
		['state', 'done', ['draft', 'ready']],
		['type', 'meeting', ['event', 'task', 'block']],
		['rsvp', 'maybe', ['accepted', 'declined', 'tentative']],
		['class', 'secret', ['public', 'private', 'confidential']],
		['transp', 'clear', ['opaque', 'transparent']],
		['status', 'Cancelled', ['tentative', 'confirmed', 'cancelled']],
	])(
		'FM-1: refuses the value of %s that no list holds',
		(key, value, permitted) => {
			const reading = readNote({ [key]: value });
			expect(reading.problems).toEqual([
				{ kind: 'unknown-value', keys: [key], key, value, permitted },
			]);
			const message = describeProblem(first(reading.problems));
			for (const word of permitted) {
				expect(message).toContain(word);
			}
		},
	);

	it('FM-1: gives the default type to a note that states a type it cannot read', () => {
		const reading = readNote({ type: 'meeting' });
		expect(reading.fields.type).toBe('event');
	});

	it.each([
		['priority', 12],
		['priority', -1],
	])('FM-1: refuses the number of %s outside its range', (key, value) => {
		const reading = readNote({ [key]: value });
		expect(reading.problems).toEqual([
			{ kind: 'number-range', keys: [key], key, value, low: 0, high: 9 },
		]);
	});

	it.each([
		['5', 'text'],
		[5.5, 'a number'],
	])('FM-1: refuses the priority %s', (value, found) => {
		const reading = readNote({ priority: value });
		expect(reading.problems).toEqual([
			{
				kind: 'not-a-number',
				keys: ['priority'],
				key: 'priority',
				found,
			},
		]);
	});

	it('FM-1: reports every fault of a note, and not the first fault alone', () => {
		const reading = readNote({
			start: '14/03/2026',
			duration: 'soon',
			status: 'open',
			priority: 12,
		});
		expect(reading.problems.map((problem) => problem.kind)).toEqual([
			'bad-time',
			'bad-duration',
			'unknown-value',
			'number-range',
		]);
	});
});

// The parser of the note editor decides the type of each value. The
// dialect below is YAML 1.1, which is what the parser family that the note
// editor bundles reads under its default configuration. Under that dialect
// a day is a date value, and so is a time of day that states its seconds.
// The first test of this group states those types, so a change of the
// dialect cannot pass here unnoticed.
describe('FM-1 the values that the parser of the note editor types', () => {
	/** The keys of a note, as the parser of the note editor types them. */
	function typed(...lines: readonly string[]): Record<string, unknown> {
		const content = ['---', ...lines, '---', ''].join('\n');
		const read = readFrontmatter(content, 'timestamp');
		if (read.kind !== 'mapping') {
			throw new Error('the note holds no block that the parser reads');
		}
		return read.data;
	}

	function typeOf(value: unknown): string {
		return value instanceof Date ? 'Date' : typeof value;
	}

	it.each([
		['date: 2026-03-14', 'date', 'Date'],
		['endDate: 2026-03-17', 'endDate', 'Date'],
		['due: 2026-03-14', 'due', 'Date'],
		['start: 2026-03-14T09:00:00', 'start', 'Date'],
		['start: 2026-03-14T09:00:00+01:00', 'start', 'Date'],
		['start: 2026-03-14T09:00', 'start', 'string'],
		['summary: 2026', 'summary', 'number'],
		['duration: 30m', 'duration', 'string'],
		['timezone: Europe/London', 'timezone', 'string'],
	])('FM-1: the line %s gives %s the type %s', (line, key, expected) => {
		expect(typeOf(typed(line)[key])).toBe(expected);
	});

	it('FM-1: the all-day note of the schema reads with no fault', () => {
		const reading = readNote(
			typed('date: 2026-03-14', 'endDate: 2026-03-17'),
		);
		expect(reading.problems).toEqual([]);
		expect(reading.schedule).toEqual({
			kind: 'all-day',
			date: { year: 2026, month: 3, day: 14 },
			endDate: { year: 2026, month: 3, day: 17 },
		});
		expect(reading.fields.schedule).toEqual({
			kind: 'all-day',
			date: '2026-03-14',
			endDate: '2026-03-17',
		});
	});

	it('FM-1: a day under a task key reads as that day', () => {
		const reading = readNote(typed('due: 2026-03-14'));
		expect(reading.problems).toEqual([]);
		expect(reading.fields.due).toBe('2026-03-14');
	});

	// A date value holds one instant. It does not hold the offset that the
	// note stated, and the resolution order gives that offset a meaning. The
	// two lines below state two different times and give one date value.
	it.each([
		'start: 2026-03-14T09:00:00',
		'start: 2026-03-14T09:00:00+01:00',
		'start: 2026-03-14T09:00:00Z',
		'end: 2026-03-14T10:30:00',
		'completed: 2026-03-19T18:00:00Z',
	])(
		'FM-1: the date value of %s is a fault that names the remedy',
		(line) => {
			const key = line.slice(0, line.indexOf(':'));
			const reading = readNote(typed(line));
			const problem = first(reading.problems);
			expect(problem).toEqual({
				kind: 'time-not-text',
				keys: [key],
				key,
			});
			const message = describeProblem(problem);
			expect(message).toContain(`"${key}"`);
			expect(message).toContain('quotation marks');
			expect(message).not.toContain('Write the value as text');
		},
	);

	it('FM-1: the remedy that the message names makes the note read', () => {
		const reading = readNote(typed('start: "2026-03-14T09:00:00+01:00"'));
		expect(reading.problems).toEqual([]);
		expect(reading.schedule).toMatchObject({
			start: {
				offsetSeconds: 3600,
				time: { hour: 9, minute: 0, second: 0 },
			},
		});
	});

	it('FM-1: a time of day with no seconds needs no quotation marks', () => {
		const reading = readNote(typed('start: 2026-03-14T09:00'));
		expect(reading.problems).toEqual([]);
		expect(reading.schedule).toMatchObject({
			start: {
				offsetSeconds: null,
				time: { hour: 9, minute: 0, second: 0 },
			},
		});
	});

	it('FM-1: a date value with a time of day under the all-day shape is a fault', () => {
		const reading = readNote(typed('date: 2026-03-14T09:00:00'));
		const problem = first(reading.problems);
		expect(problem).toMatchObject({
			kind: 'time-of-day-refused',
			key: 'date',
			text: '2026-03-14T09:00:00Z',
		});
	});

	// The reader states every fault of the note. The date value under
	// `start` is one fault, and the two shapes together are another.
	it('FM-1: two date values of the two shapes state the shape conflict', () => {
		const reading = readNote(
			typed('date: 2026-03-14', 'start: 2026-03-14T09:00:00'),
		);
		expect(reading.problems).toEqual([
			{ kind: 'time-not-text', keys: ['start'], key: 'start' },
			{ kind: 'shape-conflict', keys: ['date', 'start'] },
		]);
		expect(reading.schedule).toBeNull();
	});

	it('FM-1: a number under a text key names what it found', () => {
		const reading = readNote(typed('summary: 2026'));
		expect(reading.problems).toEqual([
			{
				kind: 'not-text',
				keys: ['summary'],
				key: 'summary',
				found: 'a number',
			},
		]);
	});

	it('FM-1: a date value under a text key names what it found', () => {
		const reading = readNote(typed('summary: 2026-03-14'));
		expect(reading.problems).toEqual([
			{
				kind: 'not-text',
				keys: ['summary'],
				key: 'summary',
				found: 'a date',
			},
		]);
	});

	// A date value obeys the same rules as the text of a day. The reader
	// writes the day of that value in universal time and reads that text.
	it('FM-1: a date value of a year that the plugin refuses is a fault', () => {
		const value = new Date(0);
		value.setUTCFullYear(50, 0, 1);
		const reading = readNote({ date: value });
		expect(reading.problems).toEqual([
			{
				kind: 'bad-time',
				keys: ['date'],
				key: 'date',
				text: '0050-01-01',
				failure: { kind: 'year-range', year: 50 },
			},
		]);
	});

	it.each(['date', 'start', 'due'])(
		'FM-1: a date value that the plugin cannot read is a fault under %s',
		(key) => {
			const reading = readNote({ [key]: new Date(Number.NaN) });
			expect(reading.problems).toEqual([
				{
					kind: 'not-text',
					keys: [key],
					key,
					found: 'a date that the plugin cannot read',
				},
			]);
		},
	);
});
