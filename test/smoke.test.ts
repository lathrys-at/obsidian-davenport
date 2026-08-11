import { describe, expect, it } from 'vitest';
import { TOMBSTONE_RANK } from '../src/core/model/tombstone';

describe('smoke: the pipeline runs against real source', () => {
	it('imports core model types and evaluates them', () => {
		expect(TOMBSTONE_RANK['local-intent']).toBeGreaterThan(
			TOMBSTONE_RANK['remote-observed'],
		);
	});
});
