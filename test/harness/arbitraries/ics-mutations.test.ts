/**
 * A change that keeps the meaning is only useful when the change moves the
 * bytes. A change that gave the text back unchanged would make the rule
 * that reads it pass over an input that says nothing.
 *
 * These cases run every change over the corpus that a person wrote. Each
 * change must move the bytes of at least one file, and the reader of the
 * lines must give back what the writer of the lines wrote.
 */

import { describe, expect, it } from 'vitest';
import { ICS_FOLD_OCTET_LIMIT } from '../../../src/core/ics/fold';
import { icsCorpus } from '../fixtures/ics-corpus';
import { octetLength } from '../ics-octets';
import {
	ICS_MUTATIONS,
	composedMutation,
	foldedAt,
	icsMutation,
	logicalLinesOf,
} from './ics-mutations';
import { samples } from './seed';

const FIXTURES = icsCorpus();

describe('the reader of the lines and the writer of the lines', () => {
	it.each(FIXTURES)('gives back every line of $id', (fixture) => {
		const lines = logicalLinesOf(fixture.content);
		expect(lines.length).toBeGreaterThan(0);
		expect(logicalLinesOf(foldedAt(lines, ICS_FOLD_OCTET_LIMIT))).toEqual(
			lines,
		);
	});

	it.each(FIXTURES)('holds every line of $id inside the width', (fixture) => {
		const text = foldedAt(
			logicalLinesOf(fixture.content),
			ICS_FOLD_OCTET_LIMIT,
		);
		const over = text
			.split('\r\n')
			.filter((line) => octetLength(line) > ICS_FOLD_OCTET_LIMIT);
		expect(over).toEqual([]);
	});
});

describe('every change that keeps the meaning', () => {
	it.each(ICS_MUTATIONS)(
		'moves the bytes of a fixture: $name',
		(mutation) => {
			const moved = FIXTURES.filter(
				(fixture) =>
					mutation.apply(fixture.content) !== fixture.content,
			);
			expect(moved.length).toBeGreaterThan(0);
		},
	);

	it('applies every change one after the other', () => {
		const fixture = FIXTURES[0];
		expect(fixture).toBeDefined();
		if (fixture === undefined) {
			return;
		}
		const changed = composedMutation(fixture.content);
		expect(changed).not.toBe(fixture.content);
		expect(changed.startsWith('\uFEFF')).toBe(true);
		expect(changed.includes('\r\n')).toBe(false);
	});
});

describe('the draw of a change', () => {
	it('reaches every change over a sample', () => {
		const drawn = samples(icsMutation(), 200);
		const seen = new Set(drawn.map((mutation) => mutation.name));
		for (const mutation of ICS_MUTATIONS) {
			expect(seen.has(mutation.name)).toBe(true);
		}
	});
});
