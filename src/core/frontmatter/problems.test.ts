import { describe, expect, it } from 'vitest';
import type { DurationFailure } from './duration';
import type { IsoFailure } from './datetime';
import type { FrontmatterProblem } from './problems';
import { describeProblem } from './problems';

/**
 * One sample of every kind of fault. The type of this table names every
 * kind, so a kind that arrives with no sample here fails the type check.
 */
const SAMPLES: {
	[K in FrontmatterProblem['kind']]: Extract<
		FrontmatterProblem,
		{ readonly kind: K }
	>;
} = {
	'shape-conflict': { kind: 'shape-conflict', keys: ['date', 'start'] },
	'end-conflict': { kind: 'end-conflict', keys: ['end', 'duration'] },
	'anchor-missing': {
		kind: 'anchor-missing',
		keys: ['endDate', 'date'],
		key: 'endDate',
		needs: 'date',
	},
	'shape-mismatch': {
		kind: 'shape-mismatch',
		keys: ['end', 'date'],
		key: 'end',
		held: 'date',
		use: 'endDate',
	},
	'not-text': {
		kind: 'not-text',
		keys: ['summary'],
		key: 'summary',
		found: 'a number',
	},
	'empty-value': { kind: 'empty-value', keys: ['summary'], key: 'summary' },
	'not-a-list': {
		kind: 'not-a-list',
		keys: ['attachments'],
		key: 'attachments',
	},
	'not-a-number': {
		kind: 'not-a-number',
		keys: ['priority'],
		key: 'priority',
		found: 'text',
	},
	'number-range': {
		kind: 'number-range',
		keys: ['priority'],
		key: 'priority',
		value: 12,
		low: 0,
		high: 9,
	},
	'unknown-value': {
		kind: 'unknown-value',
		keys: ['status'],
		key: 'status',
		value: 'open',
		permitted: ['tentative', 'confirmed', 'cancelled'],
	},
	'bad-time': {
		kind: 'bad-time',
		keys: ['start'],
		key: 'start',
		text: '14/03/2026',
		failure: { kind: 'shape' },
	},
	'time-of-day-missing': {
		kind: 'time-of-day-missing',
		keys: ['start'],
		key: 'start',
		text: '2026-03-14',
	},
	'time-not-text': { kind: 'time-not-text', keys: ['start'], key: 'start' },
	'time-of-day-refused': {
		kind: 'time-of-day-refused',
		keys: ['date'],
		key: 'date',
		text: '2026-03-14T09:00',
	},
	'bad-duration': {
		kind: 'bad-duration',
		keys: ['duration'],
		key: 'duration',
		text: '30',
		failure: { kind: 'no-unit', count: '30' },
	},
	'duration-not-positive': {
		kind: 'duration-not-positive',
		keys: ['duration'],
		key: 'duration',
	},
	'end-before-start': {
		kind: 'end-before-start',
		keys: ['start', 'end'],
		start: 'start',
		end: 'end',
	},
	'unknown-timezone': {
		kind: 'unknown-timezone',
		keys: ['timezone'],
		key: 'timezone',
		name: 'Mars/Olympus',
	},
	'unknown-calendar-timezone': {
		kind: 'unknown-calendar-timezone',
		keys: ['calendar'],
		name: 'Mars/Olympus',
	},
	'timezone-missing': {
		kind: 'timezone-missing',
		keys: ['start'],
		key: 'start',
	},
};

const TIME_FAULTS: readonly IsoFailure[] = [
	{ kind: 'empty' },
	{ kind: 'shape' },
	{ kind: 'fraction' },
	{ kind: 'year-range', year: 999 },
	{ kind: 'no-such-day', date: { year: 2026, month: 2, day: 30 } },
	{ kind: 'no-such-time', time: { hour: 24, minute: 0, second: 0 } },
	{ kind: 'offset-range', text: '+25:00' },
];

const DURATION_FAULTS: readonly DurationFailure[] = [
	{ kind: 'empty' },
	{ kind: 'no-unit', count: '30' },
	{ kind: 'unknown-unit', text: 'y' },
	{ kind: 'no-count', unit: 'h' },
	{ kind: 'repeated-unit', unit: 'h' },
	{ kind: 'unit-order', unit: 'h', after: 'm' },
	{ kind: 'too-large', count: '1000000000' },
];

describe('the words of a fault', () => {
	it.each(Object.entries(SAMPLES))(
		'states the fault %s',
		(_kind, problem) => {
			const message = describeProblem(problem);
			expect(message.length).toBeGreaterThan(0);
			expect(message.endsWith('.')).toBe(true);
			expect(message).not.toContain('  ');
		},
	);

	it.each(Object.entries(SAMPLES))(
		'names every key of the fault %s',
		(_kind, problem) => {
			const message = describeProblem(problem);
			for (const key of problem.keys) {
				expect(message).toContain(`"${key}"`);
			}
		},
	);

	it.each(TIME_FAULTS.map((failure) => [failure.kind, failure] as const))(
		'states the time fault %s and names its key',
		(_kind, failure) => {
			const message = describeProblem({
				kind: 'bad-time',
				keys: ['start'],
				key: 'start',
				text: '2026-03-14T09:00',
				failure,
			});
			expect(message.startsWith('The key "start" holds')).toBe(true);
			expect(message.endsWith('.')).toBe(true);
		},
	);

	it.each(DURATION_FAULTS.map((failure) => [failure.kind, failure] as const))(
		'states the length fault %s and names its key',
		(_kind, failure) => {
			const message = describeProblem({
				kind: 'bad-duration',
				keys: ['duration'],
				key: 'duration',
				text: '30',
				failure,
			});
			expect(message.startsWith('The key "duration" holds')).toBe(true);
			expect(message.endsWith('.')).toBe(true);
		},
	);

	it.each([
		[
			'end',
			'date',
			'endDate',
			'An event of whole days states its end with the key "endDate".',
		],
		[
			'endDate',
			'start',
			'end',
			'An event with a time of day states its end with the key "end".',
		],
	] as const)(
		'names the shape that the note takes for %s beside %s',
		(key, held, use, sentence) => {
			const message = describeProblem({
				kind: 'shape-mismatch',
				keys: [key, held],
				key,
				held,
				use,
			});
			expect(message).toContain(sentence);
			expect(message).toContain(`"${key}"`);
			expect(message).toContain(`"${held}"`);
		},
	);

	it('states the remedy for a length that stands beside a day', () => {
		const message = describeProblem({
			kind: 'shape-mismatch',
			keys: ['duration', 'date'],
			key: 'duration',
			held: 'date',
			use: null,
		});
		expect(message).toContain('An event of whole days states no length.');
		expect(message).toContain('Remove the key "duration"');
		expect(message).toContain(
			'use the key "start" in place of the key "date"',
		);
	});

	it('states the two keys of a shape that contradicts itself', () => {
		expect(describeProblem(SAMPLES['shape-conflict'])).toContain(
			'The note holds the key "date" and the key "start".',
		);
		expect(describeProblem(SAMPLES['end-conflict'])).toContain(
			'The note holds the key "end" and the key "duration".',
		);
	});

	it('states that the plugin never puts the zone of the device in place of a zone', () => {
		expect(describeProblem(SAMPLES['timezone-missing'])).toContain(
			'The plugin never uses the timezone of this device instead.',
		);
	});
});
