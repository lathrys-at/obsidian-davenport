import { describe, expect, it } from 'vitest';
import type { FeedEventSpec } from './events';
import {
	allDayOn,
	applyFeedDeltas,
	decadeSpanningCorpus,
	instantLine,
	timedAt,
} from './events';

const REFERENCE_TIME = Date.UTC(2026, 7, 10, 12, 0, 0);
const HOUR_MS = 3_600_000;

const meeting: FeedEventSpec = {
	id: 'meeting',
	uid: 'meeting@feed.test',
	summary: 'Meeting',
	start: timedAt(REFERENCE_TIME),
	end: timedAt(REFERENCE_TIME + HOUR_MS),
};

const holiday: FeedEventSpec = {
	id: 'holiday',
	uid: 'holiday@feed.test',
	summary: 'Holiday',
	start: allDayOn(Date.UTC(2026, 11, 25)),
};

describe('feed event specifications', () => {
	it('places timed and all-day instants on their properties', () => {
		expect(instantLine('DTSTART', meeting.start)).toBe(
			'DTSTART:20260810T120000Z',
		);
		expect(instantLine('DTSTART', holiday.start)).toBe(
			'DTSTART;VALUE=DATE:20261225',
		);
	});
});

describe('decade-spanning corpus', () => {
	it('spans the years either side of the reference time', () => {
		const corpus = decadeSpanningCorpus({
			referenceTime: REFERENCE_TIME,
			yearsBefore: 5,
			yearsAfter: 5,
			perYear: 2,
		});
		expect(corpus).toHaveLength(22);
		const years = new Set(
			corpus.map((event) =>
				new Date(event.start.epochMs).getUTCFullYear(),
			),
		);
		expect([...years].sort()).toEqual([
			2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031,
		]);
	});

	it('gives every event a distinct handle and UID', () => {
		const corpus = decadeSpanningCorpus({ referenceTime: REFERENCE_TIME });
		expect(new Set(corpus.map((event) => event.id)).size).toBe(
			corpus.length,
		);
		expect(new Set(corpus.map((event) => event.uid)).size).toBe(
			corpus.length,
		);
	});

	it('generates the same corpus for the same reference time', () => {
		const options = { referenceTime: REFERENCE_TIME, perYear: 3 };
		expect(decadeSpanningCorpus(options)).toEqual(
			decadeSpanningCorpus(options),
		);
	});

	it('refuses a corpus it cannot generate', () => {
		expect(() =>
			decadeSpanningCorpus({ referenceTime: REFERENCE_TIME, perYear: 0 }),
		).toThrow(/at least one event/);
		expect(() =>
			decadeSpanningCorpus({
				referenceTime: REFERENCE_TIME,
				yearsAfter: -1,
			}),
		).toThrow(/negative years/);
	});
});

describe('per-poll deltas', () => {
	const base = [meeting, holiday];

	it('adds an event', () => {
		const added: FeedEventSpec = {
			id: 'standup',
			uid: 'standup@feed.test',
			summary: 'Standup',
			start: timedAt(REFERENCE_TIME + HOUR_MS),
		};
		expect(applyFeedDeltas(base, [{ kind: 'add', event: added }])).toEqual([
			meeting,
			holiday,
			added,
		]);
	});

	it('removes an event', () => {
		expect(
			applyFeedDeltas(base, [{ kind: 'remove', id: 'holiday' }]),
		).toEqual([meeting]);
	});

	it('modifies declared fields and leaves the rest alone', () => {
		const [modified] = applyFeedDeltas(base, [
			{
				kind: 'modify',
				id: 'meeting',
				changes: { summary: 'Meeting, moved room', sequence: 2 },
			},
		]);
		expect(modified).toEqual({
			...meeting,
			summary: 'Meeting, moved room',
			sequence: 2,
		});
	});

	it('reschedules an event, preserving its duration', () => {
		const [moved] = applyFeedDeltas(base, [
			{
				kind: 'reschedule',
				id: 'meeting',
				start: timedAt(REFERENCE_TIME + 24 * HOUR_MS),
			},
		]);
		expect(moved?.start.epochMs).toBe(REFERENCE_TIME + 24 * HOUR_MS);
		expect(moved?.end?.epochMs).toBe(REFERENCE_TIME + 25 * HOUR_MS);
	});

	it('reschedules to an explicit end when one is given', () => {
		const [moved] = applyFeedDeltas(base, [
			{
				kind: 'reschedule',
				id: 'meeting',
				start: timedAt(REFERENCE_TIME),
				end: timedAt(REFERENCE_TIME + 3 * HOUR_MS),
			},
		]);
		expect(moved?.end?.epochMs).toBe(REFERENCE_TIME + 3 * HOUR_MS);
	});

	it('leaves an event with no end without one', () => {
		const [moved] = applyFeedDeltas(
			[holiday],
			[
				{
					kind: 'reschedule',
					id: 'holiday',
					start: allDayOn(Date.UTC(2026, 11, 26)),
				},
			],
		);
		expect(moved?.end).toBeUndefined();
		expect(moved?.start).toEqual(allDayOn(Date.UTC(2026, 11, 26)));
	});

	it('throws when a delta misses its target', () => {
		expect(() =>
			applyFeedDeltas(base, [{ kind: 'remove', id: 'absent' }]),
		).toThrow(/carries no event absent/);
		expect(() =>
			applyFeedDeltas(base, [{ kind: 'add', event: meeting }]),
		).toThrow(/already carries event meeting/);
	});
});
