import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { foldIcsLine, icsText } from './feed-fixture/ics-text';
import { ICS_CATEGORIES, icsFixturesFor } from './fixtures/ics-corpus';
import {
	icsLogicalLines,
	icsPhysicalLines,
	isFoldedContinuation,
} from './ics-lines';
import { ICS_LINE_OCTET_LIMIT, octetLength } from './ics-octets';

/**
 * The contract between the writer and the reader: folding a content line and
 * unfolding the result gives the line back. Neither module can assert it
 * alone, and the corpus categories carry the payloads that make folding hard
 * — multi-octet runs, escape sequences, quoted parameters, continuations
 * opened with a tab, and lines already at the octet limit.
 */

/** The logical content lines of a stored fixture. */
function logicalLinesOf(text: string): string[] {
	return icsLogicalLines(icsPhysicalLines(text));
}

/** Every logical line the corpus holds, whatever it is tagged with. */
function corpusLines(): string[] {
	return ICS_CATEGORIES.flatMap((category) =>
		icsFixturesFor(category).flatMap((fixture) =>
			logicalLinesOf(fixture.content),
		),
	);
}

/** Folds one logical line and reads it back, checking the lines in between. */
function refold(line: string): string {
	const physical = foldIcsLine(line);
	for (const part of physical) {
		expect(octetLength(part)).toBeLessThanOrEqual(ICS_LINE_OCTET_LIMIT);
	}
	for (const part of physical.slice(1)) {
		expect(isFoldedContinuation(part)).toBe(true);
	}
	const [read, ...extra] = icsLogicalLines(physical);
	expect(extra).toEqual([]);
	return read ?? '';
}

describe('folding and unfolding round trip', () => {
	for (const category of ICS_CATEGORIES) {
		it(`recovers every ${category} line the corpus holds`, () => {
			const fixtures = icsFixturesFor(category);
			expect(fixtures).not.toHaveLength(0);
			for (const fixture of fixtures) {
				const lines = logicalLinesOf(fixture.content);
				expect(lines).not.toHaveLength(0);
				for (const line of lines) {
					expect(refold(line)).toBe(line);
				}
			}
		});
	}

	it('recovers a whole fixture written back out as one text', () => {
		for (const category of ICS_CATEGORIES) {
			for (const fixture of icsFixturesFor(category)) {
				const lines = logicalLinesOf(fixture.content);
				expect(logicalLinesOf(icsText(lines))).toEqual(lines);
			}
		}
	});

	it('draws on corpus lines the writer has to fold', () => {
		const folded = corpusLines().filter(
			(line) => foldIcsLine(line).length > 1,
		);
		expect(folded).not.toHaveLength(0);
	});

	it('recovers generated content lines whatever they carry', () => {
		fc.assert(
			fc.property(
				fc.string({ unit: 'grapheme', maxLength: 400 }),
				(value) => {
					const line = `X-GENERATED:${value}`;
					expect(refold(line)).toBe(line);
				},
			),
		);
	});
});
