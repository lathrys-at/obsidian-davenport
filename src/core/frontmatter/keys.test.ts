import { describe, expect, it } from 'vitest';
import {
	ALL_DAY_KEYS,
	SCHEMA_KEYS,
	departingKeys,
	isSchemaKey,
	shapeKeys,
	TIMED_KEYS,
} from './keys';

describe('the keys of the schema', () => {
	it('holds each key one time', () => {
		expect(new Set(SCHEMA_KEYS).size).toBe(SCHEMA_KEYS.length);
	});

	it('holds the keys of both shapes', () => {
		for (const key of [...TIMED_KEYS, ...ALL_DAY_KEYS]) {
			expect(SCHEMA_KEYS).toContain(key);
		}
	});

	it.each([...SCHEMA_KEYS])('owns the key %s', (key) => {
		expect(isSchemaKey(key)).toBe(true);
	});

	it.each(['tags', 'aliases', 'Start', 'startDate', '', 'toString'])(
		'owns no key named %s',
		(key) => {
			expect(isSchemaKey(key)).toBe(false);
		},
	);
});

describe('the two shapes of a schedule', () => {
	it('gives each shape its own keys', () => {
		expect(shapeKeys('timed')).toEqual(TIMED_KEYS);
		expect(shapeKeys('all-day')).toEqual(ALL_DAY_KEYS);
	});

	it('gives each shape the keys of the other shape as the departing keys', () => {
		expect(departingKeys('timed')).toEqual(ALL_DAY_KEYS);
		expect(departingKeys('all-day')).toEqual(TIMED_KEYS);
	});

	it('names no key in both shapes', () => {
		expect(
			TIMED_KEYS.filter((key) =>
				(ALL_DAY_KEYS as readonly string[]).includes(key),
			),
		).toEqual([]);
	});
});
