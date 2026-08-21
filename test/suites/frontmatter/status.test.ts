/**
 * The lifecycle intent of a note and the status of an event are two
 * different things, and these tests hold them apart.
 *
 * The key `state` is a signal to the plugin. The key `status` is a
 * property of the event, and the server holds it. A design that let the
 * two share a key, or share a value, would turn a description of an event
 * into a write to a server.
 */

import { describe, expect, it } from 'vitest';
import { SCHEMA_KEYS } from '../../../src/core/frontmatter/keys';
import { readNote } from '../../../src/core/frontmatter/parse';
import { schedulePatch } from '../../../src/core/frontmatter/write';

const STATES = ['draft', 'ready'];
const STATUSES = ['tentative', 'confirmed', 'cancelled'];

describe('FM-7 status and state stay apart', () => {
	it('FM-7: the schema holds a key for each of the two', () => {
		expect(SCHEMA_KEYS).toContain('state');
		expect(SCHEMA_KEYS).toContain('status');
	});

	it('FM-7: no value of one vocabulary stands in the other', () => {
		expect(STATES.filter((state) => STATUSES.includes(state))).toEqual([]);
	});

	it.each(STATUSES)(
		'FM-7: the status %s passes its vocabulary and touches no lifecycle',
		(status) => {
			const reading = readNote({ status });
			expect(reading.problems).toEqual([]);
			expect(reading.fields.status).toBe(status);
			expect(reading.state).toBeNull();
		},
	);

	it('FM-7: a cancelled event keeps the lifecycle intent of its note', () => {
		const reading = readNote({ state: 'draft', status: 'cancelled' });
		expect(reading.problems).toEqual([]);
		expect(reading.state).toBe('draft');
		expect(reading.fields.status).toBe('cancelled');
	});

	it.each(STATES)(
		'FM-7: the state %s is no status, and the note states the fault',
		(state) => {
			const reading = readNote({ status: state });
			expect(reading.problems).toEqual([
				{
					kind: 'unknown-value',
					keys: ['status'],
					key: 'status',
					value: state,
					permitted: STATUSES,
				},
			]);
			expect(reading.fields.status).toBeUndefined();
		},
	);

	it.each(STATUSES)(
		'FM-7: the status %s is no state, and the note states the fault',
		(status) => {
			const reading = readNote({ state: status });
			expect(reading.problems).toEqual([
				{
					kind: 'unknown-value',
					keys: ['state'],
					key: 'state',
					value: status,
					permitted: STATES,
				},
			]);
			expect(reading.state).toBeNull();
		},
	);

	it('FM-7: the field set of the event holds no lifecycle intent', () => {
		const reading = readNote({ state: 'ready', summary: 'Design review' });
		expect(reading.state).toBe('ready');
		expect(Object.keys(reading.fields)).not.toContain('state');
	});

	it('FM-7: a write of a schedule touches neither key', () => {
		const patch = schedulePatch({
			kind: 'timed',
			start: '2026-03-14T09:00',
		});
		const touched = [...patch.set.map(([key]) => key), ...patch.remove];
		expect(touched).not.toContain('state');
		expect(touched).not.toContain('status');
	});
});
