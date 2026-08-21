/**
 * The write of a schedule into a note, and the rule that one write states
 * one shape.
 *
 * A note that changed from a timed event to an all-day event, or back,
 * must never hold the keys of both shapes. The engine computes the whole
 * change first, and one call of the platform applies it. These tests read
 * the change, and then they read the note that one such call leaves.
 */

import { describe, expect, it } from 'vitest';
import type { Schedule } from '../../../src/core/model/event';
import { writeNoteFrontmatter } from '../../../src/adapters/note-frontmatter';
import { ALL_DAY_KEYS, TIMED_KEYS } from '../../../src/core/frontmatter/keys';
import { readNote } from '../../../src/core/frontmatter/parse';
import { applyPatch, schedulePatch } from '../../../src/core/frontmatter/write';
import { FakeFileManager } from '../../harness/obsidian-fake/file-manager';
import { readFrontmatter } from '../../harness/obsidian-fake';

const TIMED: Schedule = {
	kind: 'timed',
	start: '2026-03-14T09:00',
	end: '2026-03-14T10:30',
};

const ALL_DAY: Schedule = {
	kind: 'all-day',
	date: '2026-03-14',
	endDate: '2026-03-16',
};

/** A note of the timed shape, with keys that the plugin does not own. */
const TIMED_NOTE = [
	'---',
	'tags:',
	'  - meeting',
	'summary: Design review',
	'start: 2026-03-14T09:00',
	'end: 2026-03-14T10:30',
	'timezone: Europe/London',
	'---',
	'',
	'The body of the note.',
	'',
].join('\n');

describe('FM-6 the change that one write makes', () => {
	it('FM-6: a timed schedule sets its own keys and removes the keys of the other shape', () => {
		expect(schedulePatch(TIMED)).toEqual({
			set: [
				['start', '2026-03-14T09:00'],
				['end', '2026-03-14T10:30'],
			],
			remove: ['duration', 'date', 'endDate'],
		});
	});

	it('FM-6: an all-day schedule sets its own keys and removes the keys of the other shape', () => {
		expect(schedulePatch(ALL_DAY)).toEqual({
			set: [
				['date', '2026-03-14'],
				['endDate', '2026-03-16'],
			],
			remove: ['start', 'end', 'duration'],
		});
	});

	it('FM-6: a schedule that states a length removes the end', () => {
		expect(
			schedulePatch({
				kind: 'timed',
				start: '2026-03-14T09:00',
				duration: '1h30m',
			}),
		).toEqual({
			set: [
				['start', '2026-03-14T09:00'],
				['duration', '1h30m'],
			],
			remove: ['end', 'date', 'endDate'],
		});
	});

	it('FM-6: a schedule of one day removes the last day', () => {
		expect(schedulePatch({ kind: 'all-day', date: '2026-03-14' })).toEqual({
			set: [['date', '2026-03-14']],
			remove: ['start', 'end', 'duration', 'endDate'],
		});
	});

	it.each([
		['the timed shape', TIMED],
		['the all-day shape', ALL_DAY],
	])(
		'FM-6: the two lists of %s name every key of a schedule, and no key two times',
		(_name, schedule) => {
			const patch = schedulePatch(schedule);
			const set = patch.set.map(([key]) => key);
			expect(set.filter((key) => patch.remove.includes(key))).toEqual([]);
			expect([...set, ...patch.remove].sort()).toEqual(
				[...TIMED_KEYS, ...ALL_DAY_KEYS].sort(),
			);
		},
	);
});

describe('FM-6 the change on the keys of a note', () => {
	it('FM-6: the switch to the all-day shape leaves the keys of one shape', () => {
		const frontmatter: Record<string, unknown> = {
			summary: 'Design review',
			start: '2026-03-14T09:00',
			end: '2026-03-14T10:30',
		};
		applyPatch(frontmatter, schedulePatch(ALL_DAY));
		expect(frontmatter).toEqual({
			summary: 'Design review',
			date: '2026-03-14',
			endDate: '2026-03-16',
		});
	});

	it('FM-6: the switch to the timed shape leaves the keys of one shape', () => {
		const frontmatter: Record<string, unknown> = {
			date: '2026-03-14',
			endDate: '2026-03-16',
		};
		applyPatch(frontmatter, schedulePatch(TIMED));
		expect(frontmatter).toEqual({
			start: '2026-03-14T09:00',
			end: '2026-03-14T10:30',
		});
	});

	it('FM-6: the change touches no key that the plugin does not own', () => {
		const frontmatter: Record<string, unknown> = {
			tags: ['meeting'],
			start: '2026-03-14T09:00',
			cssclasses: [],
		};
		applyPatch(frontmatter, schedulePatch(ALL_DAY));
		expect(frontmatter.tags).toEqual(['meeting']);
		expect(frontmatter.cssclasses).toEqual([]);
	});
});

describe('FM-6 one write of the platform', () => {
	it('FM-6: one call removes the departing keys and adds the arriving keys', async () => {
		const manager = new FakeFileManager({ 'note.md': TIMED_NOTE });
		const result = await writeNoteFrontmatter(
			manager,
			manager.file('note.md'),
			schedulePatch(ALL_DAY),
		);
		expect(result).toEqual({ ok: true });
		expect(manager.calls).toHaveLength(1);
		expect(manager.note('note.md')).toBe(
			[
				'---',
				'tags:',
				'  - meeting',
				'summary: Design review',
				'timezone: Europe/London',
				'date: 2026-03-14',
				'endDate: 2026-03-16',
				'---',
				'',
				'The body of the note.',
				'',
			].join('\n'),
		);
	});

	it('FM-6: the note that one write leaves states one shape and no fault', async () => {
		const manager = new FakeFileManager({ 'note.md': TIMED_NOTE });
		await writeNoteFrontmatter(
			manager,
			manager.file('note.md'),
			schedulePatch(ALL_DAY),
		);
		const reading = readNote(frontmatterOf(manager.note('note.md')));
		expect(reading.problems).toEqual([]);
		expect(reading.schedule).toMatchObject({ kind: 'all-day' });
	});

	it('FM-6: the write back to the timed shape leaves one shape again', async () => {
		const manager = new FakeFileManager({ 'note.md': TIMED_NOTE });
		await writeNoteFrontmatter(
			manager,
			manager.file('note.md'),
			schedulePatch(ALL_DAY),
		);
		await writeNoteFrontmatter(
			manager,
			manager.file('note.md'),
			schedulePatch(TIMED),
		);
		expect(manager.calls).toHaveLength(2);
		const reading = readNote(frontmatterOf(manager.note('note.md')));
		expect(reading.problems).toEqual([]);
		expect(reading.schedule).toMatchObject({ kind: 'timed' });
		expect(manager.note('note.md')).not.toContain('date:');
		expect(manager.note('note.md')).not.toContain('endDate:');
	});

	// The parser of the note editor types a day as a date value. The write
	// must still leave one shape, and the note must still read with no
	// fault afterwards.
	it('FM-6: the switch holds under the dialect that types a day as a date value', async () => {
		const manager = new FakeFileManager(
			{ 'note.md': TIMED_NOTE },
			'timestamp',
		);
		await writeNoteFrontmatter(
			manager,
			manager.file('note.md'),
			schedulePatch(ALL_DAY),
		);
		expect(manager.calls).toHaveLength(1);
		const read = readFrontmatter(manager.note('note.md'), 'timestamp');
		if (read.kind !== 'mapping') {
			throw new Error('the note holds no block that the parser reads');
		}
		expect(Object.keys(read.data)).not.toContain('start');
		expect(Object.keys(read.data)).not.toContain('end');
		const reading = readNote(read.data);
		expect(reading.problems).toEqual([]);
		expect(reading.schedule).toEqual({
			kind: 'all-day',
			date: { year: 2026, month: 3, day: 14 },
			endDate: { year: 2026, month: 3, day: 16 },
		});
	});

	it('FM-6: a write that the platform refuses gives the reason and writes nothing', async () => {
		const manager = new FakeFileManager({ 'note.md': TIMED_NOTE });
		manager.throwOnWrite(
			new Error('YAMLParseError: the block does not parse'),
		);
		const result = await writeNoteFrontmatter(
			manager,
			manager.file('note.md'),
			schedulePatch(ALL_DAY),
		);
		expect(result).toEqual({
			ok: false,
			reason: 'YAMLParseError: the block does not parse',
		});
		expect(manager.note('note.md')).toBe(TIMED_NOTE);
	});
});

/** The keys of the block of a note, as the platform gives them. */
function frontmatterOf(note: string): Record<string, unknown> {
	const lines = note.split('\n');
	const end = lines.indexOf('---', 1);
	const block: Record<string, unknown> = {};
	for (const line of lines.slice(1, end)) {
		const colon = line.indexOf(':');
		if (colon > 0 && !line.startsWith(' ')) {
			const value = line.slice(colon + 1).trim();
			if (value !== '') {
				block[line.slice(0, colon)] = value;
			}
		}
	}
	return block;
}
