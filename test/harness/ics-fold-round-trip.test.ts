import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	ICS_LINE_OCTET_LIMIT,
	encodeIcsBytes,
	foldIcsLine,
	icsText,
	octetLength,
} from './feed-fixture';
import { ICS_CATEGORIES, icsFixturesFor } from './fixtures/ics-corpus';
import {
	icsLogicalLines,
	icsPhysicalLines,
	isFoldedContinuation,
} from './ics-lines';

/**
 * The contract between the writer and the reader: folding a content line and
 * unfolding the result gives the line back. Neither module can assert it
 * alone. The corpus supplies the characters that make folding hard —
 * multi-octet runs, escape sequences, quoted parameters, continuations opened
 * with a tab — and each of its lines is also widened past the octet limit, so
 * every category drives the fold itself rather than only the identity path.
 */

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** The logical content lines of a stored fixture. */
function logicalLinesOf(text: string): string[] {
	return icsLogicalLines(icsPhysicalLines(text));
}

/** The line repeated until the writer has no choice but to fold it. */
function widened(line: string): string {
	let wide = line;
	do {
		wide = `${wide}-${line}`;
	} while (octetLength(wide) <= ICS_LINE_OCTET_LIMIT);
	return wide;
}

/**
 * Folds one logical line and reads it back, checking the physical lines in
 * between: each within the octet limit, each continuation marked, and each
 * one valid UTF-8 on its own, which is what a fold splitting a multi-octet
 * sequence would break.
 */
function refold(line: string): string {
	const physical = foldIcsLine(line);
	for (const part of physical) {
		expect(octetLength(part)).toBeLessThanOrEqual(ICS_LINE_OCTET_LIMIT);
		expect(utf8.decode(encodeIcsBytes(part))).toBe(part);
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
		it(`recovers every ${category} line, as it stands and widened`, () => {
			const fixtures = icsFixturesFor(category);
			expect(fixtures).not.toHaveLength(0);
			let folded = 0;
			for (const fixture of fixtures) {
				const lines = logicalLinesOf(fixture.content);
				expect(lines).not.toHaveLength(0);
				for (const line of lines) {
					expect(refold(line)).toBe(line);
					const wide = widened(line);
					expect(refold(wide)).toBe(wide);
					folded += foldIcsLine(wide).length - 1;
				}
			}
			expect(folded).toBeGreaterThan(0);
		});
	}

	it('recovers a whole fixture written back out as one text', () => {
		for (const category of ICS_CATEGORIES) {
			for (const fixture of icsFixturesFor(category)) {
				const lines = logicalLinesOf(fixture.content);
				const written = icsText(lines);
				for (const physical of icsPhysicalLines(written)) {
					expect(octetLength(physical)).toBeLessThanOrEqual(
						ICS_LINE_OCTET_LIMIT,
					);
				}
				expect(logicalLinesOf(written)).toEqual(lines);
			}
		}
	});

	it('recovers generated lines long enough to fold, whatever they carry', () => {
		fc.assert(
			fc.property(
				fc.string({
					unit: 'grapheme',
					minLength: 80,
					maxLength: 400,
					size: 'max',
				}),
				(value) => {
					const line = `X-GENERATED:${value}`;
					expect(foldIcsLine(line).length).toBeGreaterThan(1);
					expect(refold(line)).toBe(line);
				},
			),
		);
	});
});
