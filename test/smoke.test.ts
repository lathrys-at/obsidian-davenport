import { describe, expect, it } from 'vitest';
import { TOMBSTONE_RANK } from '../src/core/model/tombstone';

// Proves the pipeline runs against real source: TypeScript resolution,
// strict compilation, and imports from src/ all work under vitest.
describe('smoke', () => {
	it('imports core model types and evaluates them', () => {
		expect(TOMBSTONE_RANK['local-intent']).toBeGreaterThan(
			TOMBSTONE_RANK['remote-observed'],
		);
	});
});
