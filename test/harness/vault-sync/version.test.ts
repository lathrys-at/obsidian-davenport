import { describe, expect, it } from 'vitest';
import { INITIAL_VERSION, bumpVersion, covers, mergeVersions } from './index';

describe('path versions', () => {
	it('starts the change count of a device at one, and adds one for each later change', () => {
		const once = bumpVersion(INITIAL_VERSION, 'a');
		expect(once).toEqual({ a: 1 });
		expect(bumpVersion(once, 'a')).toEqual({ a: 2 });
		expect(bumpVersion(once, 'b')).toEqual({ a: 1, b: 1 });
		expect(once).toEqual({ a: 1 });
	});

	it('covers a second version when the second version has seen no more changes than the first version', () => {
		expect(covers({ a: 1 }, INITIAL_VERSION)).toBe(true);
		expect(covers({ a: 1, b: 1 }, { a: 1 })).toBe(true);
		expect(covers({ a: 1 }, { a: 1 })).toBe(true);
		expect(covers({ a: 1 }, { a: 2 })).toBe(false);
		expect(covers({ a: 1 }, { b: 1 })).toBe(false);
	});

	it('keeps the highest count of each device from the two versions', () => {
		expect(mergeVersions({ a: 2, b: 1 }, { a: 1, c: 3 })).toEqual({
			a: 2,
			b: 1,
			c: 3,
		});
		expect(mergeVersions(INITIAL_VERSION, { a: 1 })).toEqual({ a: 1 });
	});

	it('reports that neither version covers the other version when the two devices changed the path without knowledge of each other', () => {
		expect(covers({ a: 1 }, { b: 1 })).toBe(false);
		expect(covers({ b: 1 }, { a: 1 })).toBe(false);
		expect(covers({ a: 1, b: 1 }, { a: 2 })).toBe(false);
		expect(covers({ a: 2 }, { a: 1, b: 1 })).toBe(false);
	});
});
