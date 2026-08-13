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
 * Tests the agreement between the iCalendar writer and the iCalendar reader.
 * The writer folds a content line that is longer than the octet limit. The
 * fold makes two or more physical lines. The reader joins the physical lines
 * back into one logical line. The agreement is that the reader gives back the
 * line that the writer folded, character for character. The writer and the
 * reader are different modules, and neither module can test this agreement
 * alone.
 *
 * The ICS corpus supplies the characters that make a fold difficult:
 * - characters of more than one octet;
 * - escape sequences;
 * - quoted parameters;
 * - continuations that start with a tab.
 *
 * The test also makes every corpus line longer than the octet limit. A line
 * that is short enough needs no fold, and the writer gives such a line back
 * unchanged. Therefore the longer line makes the writer fold a line in every
 * category of the corpus.
 */

const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * The logical content lines of an iCalendar text. The function undoes every
 * fold in the text.
 */
function logicalLinesOf(text: string): string[] {
	return icsLogicalLines(icsPhysicalLines(text));
}

/**
 * The given line, joined to copies of itself until the result is longer than
 * the octet limit. The writer must fold a line of this length.
 */
function widened(line: string): string {
	let wide = line;
	do {
		wide = `${wide}-${line}`;
	} while (octetLength(wide) <= ICS_LINE_OCTET_LIMIT);
	return wide;
}

/**
 * Folds one logical line, reads the physical lines back into one logical
 * line, and returns that line. The function checks three rules between the
 * fold and the read. Each physical line must be no longer than the octet
 * limit. Each physical line after the first must start as a continuation.
 * Each physical line must be valid UTF-8 on its own. A fold that divided the
 * octets of one character across two lines would break the UTF-8 rule. After
 * the read, the physical lines must give back one logical line and no more.
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

describe('folding a line and unfolding it again', () => {
	for (const category of ICS_CATEGORIES) {
		it(`gives back every ${category} line, as stored and made long enough to fold`, () => {
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

	it('writes a whole fixture as one text and reads every line back', () => {
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

	it('gives back a generated line long enough to fold, whatever characters it holds', () => {
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
