import { describe, expect, it } from 'vitest';
import type { RecordData } from '../model/record';
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

	it('passes over the normalization stamp', () => {
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
