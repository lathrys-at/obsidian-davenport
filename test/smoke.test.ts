import { describe, expect, it } from 'vitest';
import { TOMBSTONE_RANK } from '../src/core/model/tombstone';

describe('smoke: the test pipeline runs against the real source code', () => {
	it('imports the tombstone ranks from the core model and compares them', () => {
		expect(TOMBSTONE_RANK['local-intent']).toBeGreaterThan(
			TOMBSTONE_RANK['remote-observed'],
		);
	});
});
