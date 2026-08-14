import { describe, expect, it } from 'vitest';
import {
	NOTE_FIXTURES,
	noteFixture,
	noteFixtureNamesOnDisk,
} from './note-corpus';

describe('note corpus index', () => {
	it('loads each fixture file one time', () => {
		const loaded = NOTE_FIXTURES.map((fixture) => fixture.id);
		expect([...loaded].sort()).toEqual(noteFixtureNamesOnDisk());
		expect(new Set(loaded).size).toBe(loaded.length);
	});

	it('gives each fixture a file name that is the id plus .md', () => {
		for (const fixture of NOTE_FIXTURES) {
			expect(fixture.fileName).toBe(`${fixture.id}.md`);
		}
	});

	it('reads text for each fixture, and finds the same fixture by id', () => {
		for (const fixture of NOTE_FIXTURES) {
			expect(fixture.content).not.toHaveLength(0);
			expect(noteFixture(fixture.id)).toBe(fixture);
		}
	});

	it('names every corpus id when the caller asks for an unknown id', () => {
		expect(() => noteFixture('no-such-note')).toThrow(/no fixture/);
		expect(() => noteFixture('no-such-note')).toThrow(/minimal/);
	});
});
