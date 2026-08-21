import { describe, expect, it } from 'vitest';
import type { NormalizationStamp } from '../model/normalization';
import type { RecordData } from '../model/record';
import { parseIcs } from '../ics/parse';
import { serializeCalendar } from '../ics/serializer';
import { recordContentKey, sameRecordContent } from './content';

function record(overrides: Partial<RecordData> = {}): RecordData {
	return {
		identity: { collectionHref: 'https://dav/c/', uid: 'one' },
		fields: { type: 'event', summary: 'A' },
		baseIcs: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
		normalizationVersion: { core: 1 },
		checksum: 'a'.repeat(64),
		...overrides,
	};
}

describe('the comparison of the content of two records', () => {
	it('says that one record equals itself', () => {
		expect(sameRecordContent(record(), record())).toBe(true);
	});

	it('passes over the checksum', () => {
		expect(
			sameRecordContent(record(), record({ checksum: 'b'.repeat(64) })),
		).toBe(true);
	});

	it('passes over the stamp where the two records hold one snapshot', () => {
		expect(
			sameRecordContent(
				record(),
				record({ normalizationVersion: { core: 9, timezone: 3 } }),
			),
		).toBe(true);
	});

	it.each([
		[
			'the pair',
			record({
				identity: { collectionHref: 'https://dav/c/', uid: 'x' },
			}),
		],
		['the href of the resource', record({ resourceHref: 'a.ics' })],
		['the etag', record({ etag: '"1"' })],
		[
			'a modeled field',
			record({ fields: { type: 'event', summary: 'B' } }),
		],
		[
			'the base snapshot',
			record({
				baseIcs: 'BEGIN:VCALENDAR\r\nX-A:1\r\nEND:VCALENDAR\r\n',
			}),
		],
		['the pointer to the venue', record({ venue: { path: 'a.md' } })],
		[
			'the map of the instances',
			record({ materialization: { '2026-03-02': { path: 'a.md' } } }),
		],
		['a render hash', record({ renderHashes: { description: '1' } })],
		['the tombstone', record({ tombstone: { type: 'local-intent' } })],
	])('reads a difference in %s', (_name, other) => {
		expect(sameRecordContent(record(), other)).toBe(false);
	});

	it('reads a difference between an absent field and an empty text', () => {
		expect(
			sameRecordContent(
				record({ fields: { type: 'event' } }),
				record({ fields: { type: 'event', summary: '' } }),
			),
		).toBe(false);
	});

	it('reads no difference between an absent list and an empty list', () => {
		expect(
			sameRecordContent(
				record({ fields: { type: 'event', summary: 'A' } }),
				record({
					fields: { type: 'event', summary: 'A', categories: [] },
				}),
			),
		).toBe(true);
	});

	it('reads a difference where the two halves of the key would run together', () => {
		const left = record({
			fields: { type: 'event', summary: 'A' },
			baseIcs: 'X',
		});
		const right = record({
			fields: { type: 'event', summary: 'A' },
			baseIcs: 'Y',
		});
		expect(recordContentKey(left)).not.toBe(recordContentKey(right));
	});

	it('holds no line that a record file also holds', () => {
		expect(recordContentKey(record())).not.toContain('checksum');
		expect(recordContentKey(record())).not.toContain('normalization');
	});
});

const HEAD = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//p//EN'];

function definition(name: string, to: string): readonly string[] {
	return [
		'BEGIN:VTIMEZONE',
		`TZID:${name}`,
		'BEGIN:STANDARD',
		'DTSTART:19701101T020000',
		'TZOFFSETFROM:-0400',
		`TZOFFSETTO:${to}`,
		'END:STANDARD',
		'END:VTIMEZONE',
	];
}

function ics(...lines: string[]): string {
	const parsed = parseIcs(
		[...HEAD, ...lines, 'END:VCALENDAR', ''].join('\r\n'),
	);
	if (!parsed.ok) {
		throw new Error(parsed.failure.message);
	}
	return serializeCalendar(parsed.calendar);
}

const EVENT = [
	'BEGIN:VEVENT',
	'UID:one',
	'DTSTART;TZID=America/New_York:20260302T090000',
	'END:VEVENT',
];

/** The stamps of two devices that hold two releases of the table. */
const OLDER: NormalizationStamp = { core: 1, timezone: 1 };
const NEWER: NormalizationStamp = { core: 1, timezone: 2 };

/** A record of the given stamp, over the given lines of the calendar. */
function over(stamp: NormalizationStamp, ...lines: string[]): RecordData {
	return record({ normalizationVersion: stamp, baseIcs: ics(...lines) });
}

describe('the comparison where the two timezone components differ', () => {
	it('passes over a definition that one record carries and the other does not', () => {
		const kept = over(
			OLDER,
			...definition('America/New_York', '-0500'),
			...EVENT,
		);
		const dropped = over(NEWER, ...EVENT);
		expect(sameRecordContent(kept, dropped)).toBe(true);
		expect(sameRecordContent(dropped, kept)).toBe(true);
	});

	it('reads a definition that both records carry', () => {
		const stood = over(
			OLDER,
			...definition('America/New_York', '-0500'),
			...EVENT,
		);
		const moved = over(
			NEWER,
			...definition('America/New_York', '-0600'),
			...EVENT,
		);
		expect(sameRecordContent(stood, moved)).toBe(false);
	});

	it('reads a definition that no value of the calendar names', () => {
		const UNUSED = ['BEGIN:VEVENT', 'UID:one', 'END:VEVENT'];
		const stood = over(
			OLDER,
			...definition('America/New_York', '-0500'),
			...UNUSED,
		);
		const gone = over(NEWER, ...UNUSED);
		expect(sameRecordContent(stood, gone)).toBe(false);
	});

	it('reads every other byte of the calendar', () => {
		const one = over(
			OLDER,
			...definition('America/New_York', '-0500'),
			'BEGIN:VEVENT',
			'UID:one',
			'SUMMARY:Standup',
			'DTSTART;TZID=America/New_York:20260302T090000',
			'END:VEVENT',
		);
		const other = over(
			NEWER,
			'BEGIN:VEVENT',
			'UID:one',
			'SUMMARY:Retrospective',
			'DTSTART;TZID=America/New_York:20260302T090000',
			'END:VEVENT',
		);
		expect(sameRecordContent(one, other)).toBe(false);
	});

	it('compares a snapshot that the parse boundary refuses as it stands', () => {
		expect(
			sameRecordContent(
				record({
					normalizationVersion: OLDER,
					baseIcs: 'not a calendar',
				}),
				record({
					normalizationVersion: NEWER,
					baseIcs: 'not a calendar',
				}),
			),
		).toBe(true);
		expect(
			sameRecordContent(
				record({
					normalizationVersion: OLDER,
					baseIcs: 'not a calendar',
				}),
				record({
					normalizationVersion: NEWER,
					baseIcs: 'another text',
				}),
			),
		).toBe(false);
	});

	it('gives one key for a record whose definition a table release can move', () => {
		const kept = over(
			OLDER,
			...definition('America/New_York', '-0500'),
			...EVENT,
		);
		const dropped = over(NEWER, ...EVENT);
		expect(recordContentKey(kept)).toBe(recordContentKey(dropped));
	});
});

describe('the comparison where the two timezone components are equal', () => {
	it('reads a definition that one record carries and the other does not', () => {
		const kept = over(
			OLDER,
			...definition('America/New_York', '-0500'),
			...EVENT,
		);
		const dropped = over(OLDER, ...EVENT);
		expect(sameRecordContent(kept, dropped)).toBe(false);
		expect(sameRecordContent(dropped, kept)).toBe(false);
	});

	it('reads two records that hold one snapshot as one state', () => {
		const stood = over(
			OLDER,
			...definition('America/New_York', '-0500'),
			...EVENT,
		);
		const again = over(
			OLDER,
			...definition('America/New_York', '-0500'),
			...EVENT,
		);
		expect(sameRecordContent(stood, again)).toBe(true);
	});

	it('reads a definition where neither record carries the component', () => {
		// A record that carries a definition names the zone of that
		// definition, and a record that names a zone carries the timezone
		// component. No build therefore writes the pair below. The rule
		// reads the two snapshots whole, as it does for every other pair
		// whose two components are equal.
		const core: NormalizationStamp = { core: 1 };
		const kept = over(
			core,
			...definition('America/New_York', '-0500'),
			...EVENT,
		);
		const dropped = over(core, ...EVENT);
		expect(sameRecordContent(kept, dropped)).toBe(false);
	});
});

describe('the comparison where one record carries no timezone component', () => {
	/**
	 * The calendar names its zone in a value and in no parameter. A device
	 * whose table lacks that name reads no reference, so a record with no
	 * definition carries no timezone component. The definition itself names
	 * the zone, so a record that carries one carries the component.
	 */
	const HOME = ['X-WR-TIMEZONE:America/New_York'];
	const PLAIN = [
		'BEGIN:VEVENT',
		'UID:one',
		'DTSTART:20260302T140000Z',
		'END:VEVENT',
	];

	it('passes over a definition that the record with the component carries', () => {
		const kept = over(
			OLDER,
			...HOME,
			...definition('America/New_York', '-0500'),
			...PLAIN,
		);
		const dropped = over({ core: 1 }, ...HOME, ...PLAIN);
		expect(sameRecordContent(kept, dropped)).toBe(true);
		expect(sameRecordContent(dropped, kept)).toBe(true);
	});

	it('reads every other byte of the calendar', () => {
		const one = over({ core: 1 }, ...HOME, ...PLAIN);
		const other = over(
			OLDER,
			...HOME,
			'BEGIN:VEVENT',
			'UID:one',
			'SUMMARY:Standup',
			'DTSTART:20260302T140000Z',
			'END:VEVENT',
		);
		expect(sameRecordContent(one, other)).toBe(false);
	});
});
