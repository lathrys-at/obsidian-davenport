import { describe, expect, it } from 'vitest';
import { driveInput } from '../../../scripts/fuzz-ics-core';
import { parseIcs } from '../../../src/core/ics/parse';
import { serializeCalendar } from '../../../src/core/ics/serializer';
import {
	icsCrashCorpus,
	icsCrashNamesOnDisk,
	type IcsCrashFixture,
} from './ics-crash-corpus';

const engine = { parseIcs, serializeCalendar };

/** The finding that one fixture gives today, or null. */
function findingOf(fixture: IcsCrashFixture): string | null {
	const found = driveInput(engine, {
		text: fixture.content,
		promise: 'any',
	});
	return found === null ? null : found.kind;
}

describe('the crash corpus index', () => {
	it('lists every file of the corpus one time', () => {
		const indexed = icsCrashCorpus().map((fixture) => fixture.id);
		expect([...indexed].sort()).toEqual(icsCrashNamesOnDisk());
		expect(new Set(indexed).size).toBe(indexed.length);
	});

	it('holds a fixture, so the corpus is never an empty claim', () => {
		expect(icsCrashCorpus().length).toBeGreaterThan(0);
	});

	it('states a kind of finding for each fixture that waits, and none for the others', () => {
		for (const fixture of icsCrashCorpus()) {
			expect(
				fixture.state === 'open'
					? fixture.finding !== null
					: fixture.finding === null,
			).toBe(true);
		}
	});

	it('gives each fixture a summary', () => {
		for (const fixture of icsCrashCorpus()) {
			expect(fixture.summary.length).toBeGreaterThan(40);
		}
	});
});

describe('every fixture of the crash corpus', () => {
	for (const fixture of icsCrashCorpus()) {
		if (fixture.state === 'held') {
			it(`meets every rule of the boundary: ${fixture.id}`, () => {
				expect(findingOf(fixture)).toBeNull();
			});
			continue;
		}
		// The fixture still reaches its defect. The case states that, so a
		// fixture that stops reaching it turns red. The engine that keeps
		// the rule then moves the entry of the fixture to the state held.
		it(`still reaches the defect that it holds: ${fixture.id}`, () => {
			expect(findingOf(fixture)).toBe(fixture.finding);
		});
	}
});
