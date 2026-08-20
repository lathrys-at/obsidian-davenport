/**
 * The bytes of a record follow from the state alone.
 *
 * The state has four parts: what the server holds, the pointer to the
 * venue, the map of the instances with its content hash, and the
 * tombstone. Two devices that hold one state must write one file. If they
 * do not, every device rewrites the file of every other device, and a
 * vault of records never settles.
 *
 * The tests build one state two times, through two objects that no code
 * shares, and they compare the bytes. They also change the things that
 * must not reach the bytes: the order in which a caller builds an object,
 * the order of the keys of a map, and the form in which the server sent
 * the calendar.
 */

import { describe, expect, it } from 'vitest';
import { WebCryptoDigest } from '../../../src/adapters/digest';
import { parseIcs } from '../../../src/core/ics/parse';
import { NORMALIZATION_VERSIONS } from '../../../src/core/ics/stamp';
import type { RecordInput } from '../../../src/core/records/build';
import { buildRecord } from '../../../src/core/records/build';
import { sealRecord } from '../../../src/core/records/checksum';
import { writeRecord } from '../../../src/core/records/writer';
import { FakeVault } from '../../harness/obsidian-fake';
import { RecordingVault } from '../../harness/recording-vault';
import { RECORD_GOLDEN_CASES } from '../../harness/fixtures/record-goldens';

const digest = new WebCryptoDigest();
const PATH = 'davenport/records/one.md';
const COLLECTION = 'https://dav.example.com/calendars/ren/work/';

function calendarOf(...lines: string[]) {
	const parsed = parseIcs(
		[
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//Davenport//determinism//EN',
			...lines,
			'END:VCALENDAR',
			'',
		].join('\r\n'),
	);
	if (!parsed.ok) {
		throw new Error(parsed.failure.message);
	}
	return parsed.calendar;
}

async function bytesOf(input: RecordInput): Promise<string> {
	return sealRecord(digest, buildRecord(NORMALIZATION_VERSIONS, input).data);
}

/** A device that holds its own vault and its own copy of the state. */
function device(): RecordingVault {
	return new RecordingVault(new FakeVault());
}

describe('LG-2 two devices that hold one state', () => {
	it.each(RECORD_GOLDEN_CASES.map((entry) => entry.id))(
		'LG-2: two builds of %s give the same bytes',
		async (id) => {
			const entry = RECORD_GOLDEN_CASES.find((each) => each.id === id);
			if (entry === undefined) {
				throw new Error(`the gate holds no case named ${id}`);
			}
			const first = await bytesOf({
				...structuredClone(entry.state),
				calendar: parseCalendarOf(entry.ics),
			});
			const second = await bytesOf({
				...structuredClone(entry.state),
				calendar: parseCalendarOf(entry.ics),
			});
			expect(first).toBe(second);
		},
	);

	it('LG-2: the order in which a caller builds the state reaches no byte', async () => {
		const calendar = calendarOf(
			'BEGIN:VEVENT',
			'UID:order',
			'DTSTART:20260302T140000Z',
			'END:VEVENT',
		);
		const forward: RecordInput = {
			identity: { collectionHref: COLLECTION, uid: 'order' },
			resourceHref: 'a.ics',
			etag: '"1"',
			fields: { type: 'event', summary: 'A', location: 'B' },
			calendar,
			venue: { path: 'note.md', contentHash: 'aa' },
			tombstone: { type: 'remote-observed' },
		};
		const backward: RecordInput = {
			tombstone: { type: 'remote-observed' },
			venue: { contentHash: 'aa', path: 'note.md' },
			calendar,
			fields: { location: 'B', summary: 'A', type: 'event' },
			etag: '"1"',
			resourceHref: 'a.ics',
			identity: { uid: 'order', collectionHref: COLLECTION },
		};
		expect(await bytesOf(forward)).toBe(await bytesOf(backward));
	});

	it('LG-2: the order of the keys of the map of the instances reaches no byte', async () => {
		const calendar = calendarOf(
			'BEGIN:VEVENT',
			'UID:map',
			'DTSTART:20260302T140000Z',
			'RRULE:FREQ=DAILY;COUNT=3',
			'END:VEVENT',
		);
		const base = {
			identity: { collectionHref: COLLECTION, uid: 'map' },
			fields: { type: 'event' as const },
			calendar,
		};
		const forward = await bytesOf({
			...base,
			materialization: {
				'2026-03-02': { path: 'a.md', contentHash: '1' },
				'2026-03-03': { path: 'b.md' },
				'2026-03-04': { path: 'c.md', section: 'x' },
			},
		});
		const backward = await bytesOf({
			...base,
			materialization: {
				'2026-03-04': { path: 'c.md', section: 'x' },
				'2026-03-03': { path: 'b.md' },
				'2026-03-02': { path: 'a.md', contentHash: '1' },
			},
		});
		expect(forward).toBe(backward);
	});

	it('LG-2: an empty map of the instances gives the bytes of no map at all', async () => {
		const calendar = calendarOf(
			'BEGIN:VEVENT',
			'UID:empty',
			'DTSTART:20260302T140000Z',
			'END:VEVENT',
		);
		const base = {
			identity: { collectionHref: COLLECTION, uid: 'empty' },
			fields: { type: 'event' as const },
			calendar,
		};
		expect(await bytesOf({ ...base, materialization: {} })).toBe(
			await bytesOf(base),
		);
	});

	it('LG-2: the form in which the server sent the calendar reaches no byte', async () => {
		const identity = { collectionHref: COLLECTION, uid: 'form' };
		const fields = { type: 'event' as const, summary: 'Standup' };
		const ordered = await bytesOf({
			identity,
			fields,
			calendar: calendarOf(
				'BEGIN:VEVENT',
				'DTSTART:20260302T140000Z',
				'SUMMARY:Standup',
				'UID:form',
				'END:VEVENT',
			),
		});
		const shuffled = await bytesOf({
			identity,
			fields,
			calendar: calendarOf(
				'BEGIN:VEVENT',
				'UID:form',
				'SUMMARY:Standup',
				'DTSTART:20260302T140000Z',
				'END:VEVENT',
			),
		});
		expect(shuffled).toBe(ordered);
	});

	it('LG-2: a change of a timezone definition alone reaches no byte', async () => {
		const identity = { collectionHref: COLLECTION, uid: 'zone' };
		const fields = { type: 'event' as const, timezone: 'America/New_York' };
		const event = [
			'BEGIN:VEVENT',
			'UID:zone',
			'DTSTART;TZID=America/New_York:20260302T090000',
			'END:VEVENT',
		];
		const withOne = await bytesOf({
			identity,
			fields,
			calendar: calendarOf(
				'BEGIN:VTIMEZONE',
				'TZID:America/New_York',
				'BEGIN:STANDARD',
				'DTSTART:20071104T020000',
				'TZOFFSETFROM:-0400',
				'TZOFFSETTO:-0500',
				'END:STANDARD',
				'END:VTIMEZONE',
				...event,
			),
		});
		const withAnother = await bytesOf({
			identity,
			fields,
			calendar: calendarOf(
				'BEGIN:VTIMEZONE',
				'TZID:America/New_York',
				'TZURL:http://tzurl.org/zoneinfo/America/New_York',
				'BEGIN:DAYLIGHT',
				'DTSTART:20070311T020000',
				'TZOFFSETFROM:-0500',
				'TZOFFSETTO:-0400',
				'END:DAYLIGHT',
				'END:VTIMEZONE',
				...event,
			),
		});
		const withNone = await bytesOf({
			identity,
			fields,
			calendar: calendarOf(...event),
		});
		expect(withAnother).toBe(withOne);
		expect(withNone).toBe(withOne);
	});
});

describe('LG-2 the write that happens only when the bytes change', () => {
	it('LG-2: a second device that holds the same state writes nothing', async () => {
		const entry = RECORD_GOLDEN_CASES[7];
		if (entry === undefined) {
			throw new Error('the gate holds no case at that place');
		}
		const input: RecordInput = {
			...entry.state,
			calendar: parseCalendarOf(entry.ics),
		};
		const text = await bytesOf(input);
		const second = device();
		await second.write(PATH, text);
		second.forget();
		const result = await writeRecord(
			{ vault: second, digest, versions: NORMALIZATION_VERSIONS },
			PATH,
			buildRecord(NORMALIZATION_VERSIONS, input).data,
		);
		expect(result.outcome).toBe('unchanged');
		expect(second.written).toEqual([]);
	});

	it('LG-2: ten loops over one state give one write', async () => {
		const entry = RECORD_GOLDEN_CASES[5];
		if (entry === undefined) {
			throw new Error('the gate holds no case at that place');
		}
		const home = device();
		const ports = { vault: home, digest, versions: NORMALIZATION_VERSIONS };
		const outcomes: string[] = [];
		for (let loop = 0; loop < 10; loop += 1) {
			const data = buildRecord(NORMALIZATION_VERSIONS, {
				...structuredClone(entry.state),
				calendar: parseCalendarOf(entry.ics),
			}).data;
			outcomes.push((await writeRecord(ports, PATH, data)).outcome);
		}
		expect(outcomes[0]).toBe('created');
		expect(outcomes.slice(1)).toEqual(Array(9).fill('unchanged'));
		expect(home.writtenPaths).toEqual([PATH]);
	});
});

function parseCalendarOf(text: string) {
	const parsed = parseIcs(text);
	if (!parsed.ok) {
		throw new Error(parsed.failure.message);
	}
	return parsed.calendar;
}
