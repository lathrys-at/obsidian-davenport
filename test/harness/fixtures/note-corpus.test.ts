import { describe, expect, it } from 'vitest';
import {
	NOTE_FIXTURES,
	noteFixture,
	noteFixtureNamesOnDisk,
} from './note-corpus';

describe('note corpus index', () => {
	it('loads every fixture file exactly once', () => {
		const loaded = NOTE_FIXTURES.map((fixture) => fixture.id);
		expect([...loaded].sort()).toEqual(noteFixtureNamesOnDisk());
		expect(new Set(loaded).size).toBe(loaded.length);
	});

	it('names each fixture by its file', () => {
		for (const fixture of NOTE_FIXTURES) {
			expect(fixture.fileName).toBe(`${fixture.id}.md`);
		}
	});

	it('reads each fixture as text it can hand back', () => {
		for (const fixture of NOTE_FIXTURES) {
			expect(fixture.content).not.toHaveLength(0);
			expect(noteFixture(fixture.id)).toBe(fixture);
		}
	});

	it('names the corpus when asked for a fixture it does not hold', () => {
		expect(() => noteFixture('no-such-note')).toThrow(/no fixture/);
		expect(() => noteFixture('no-such-note')).toThrow(/minimal/);
	});
});
