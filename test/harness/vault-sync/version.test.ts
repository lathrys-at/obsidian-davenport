import { describe, expect, it } from 'vitest';
import { INITIAL_VERSION, bumpVersion, covers, mergeVersions } from './index';

describe('path versions', () => {
	it('counts a device from nothing and keeps counting', () => {
		const once = bumpVersion(INITIAL_VERSION, 'a');
		expect(once).toEqual({ a: 1 });
		expect(bumpVersion(once, 'a')).toEqual({ a: 2 });
		expect(bumpVersion(once, 'b')).toEqual({ a: 1, b: 1 });
		expect(once).toEqual({ a: 1 });
	});

	it('covers a version that has seen no more than it has', () => {
		expect(covers({ a: 1 }, INITIAL_VERSION)).toBe(true);
		expect(covers({ a: 1, b: 1 }, { a: 1 })).toBe(true);
		expect(covers({ a: 1 }, { a: 1 })).toBe(true);
		expect(covers({ a: 1 }, { a: 2 })).toBe(false);
		expect(covers({ a: 1 }, { b: 1 })).toBe(false);
	});

	it('takes the highest count each device reached', () => {
		expect(mergeVersions({ a: 2, b: 1 }, { a: 1, c: 3 })).toEqual({
			a: 2,
			b: 1,
			c: 3,
		});
		expect(mergeVersions(INITIAL_VERSION, { a: 1 })).toEqual({ a: 1 });
	});

	it('has neither side cover the other where the two edits were concurrent', () => {
		expect(covers({ a: 1 }, { b: 1 })).toBe(false);
		expect(covers({ b: 1 }, { a: 1 })).toBe(false);
		expect(covers({ a: 1, b: 1 }, { a: 2 })).toBe(false);
		expect(covers({ a: 2 }, { a: 1, b: 1 })).toBe(false);
	});
});
