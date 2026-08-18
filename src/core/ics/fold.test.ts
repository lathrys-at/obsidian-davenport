import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { foldIcsLine as harnessFold } from '../../../test/harness/feed-fixture/ics-text';
import {
	ICS_LINE_OCTET_LIMIT,
	octetLength,
} from '../../../test/harness/ics-octets';
import { ICS_FOLD_OCTET_LIMIT, foldIcsLine, icsOctetLength } from './fold';

/** Joins the physical lines again, as a reader of the format does. */
function joined(physical: readonly string[]): string {
	return physical
		.map((line, index) => (index === 0 ? line : line.slice(1)))
		.join('');
}

describe('the count of octets', () => {
	it('takes the limit of the format', () => {
		expect(ICS_FOLD_OCTET_LIMIT).toBe(ICS_LINE_OCTET_LIMIT);
	});

	it.each([
		['ASCII', 'abc', 3],
		['two octets', 'é', 2],
		['three octets', '☃', 3],
		['four octets', '😀', 4],
		['a mixed run', 'a é ☃ 😀', 13],
		['nothing', '', 0],
	])('counts %s', (_name, text, octets) => {
		expect(icsOctetLength(text)).toBe(octets);
	});

	it('agrees with an encoder over any text', () => {
		fc.assert(
			fc.property(fc.string({ unit: 'binary' }), (text) => {
				expect(icsOctetLength(text)).toBe(octetLength(text));
			}),
		);
	});
});

describe('the fold of the canon', () => {
	it('gives one line back when the line is inside the limit', () => {
		expect(foldIcsLine('SUMMARY:short')).toEqual(['SUMMARY:short']);
	});

	it('starts every line after the first with one space', () => {
		const physical = foldIcsLine(`SUMMARY:${'a'.repeat(300)}`);
		expect(physical.length).toBeGreaterThan(1);
		for (const line of physical.slice(1)) {
			expect(line.startsWith(' ')).toBe(true);
		}
	});

	it('writes the same lines as the reference of the harness', () => {
		fc.assert(
			fc.property(fc.string({ unit: 'binary' }), (line) => {
				expect(foldIcsLine(line)).toEqual(harnessFold(line));
			}),
		);
	});

	it('holds every line inside the limit', () => {
		fc.assert(
			fc.property(fc.string({ unit: 'binary' }), (line) => {
				for (const physical of foldIcsLine(line)) {
					expect(octetLength(physical)).toBeLessThanOrEqual(
						ICS_FOLD_OCTET_LIMIT,
					);
				}
			}),
		);
	});

	it('gives the line back when the folds are joined again', () => {
		fc.assert(
			fc.property(fc.string({ unit: 'binary' }), (line) => {
				expect(joined(foldIcsLine(line))).toBe(line);
			}),
		);
	});

	it('never divides the two halves of a surrogate pair', () => {
		fc.assert(
			fc.property(
				fc.array(fc.constantFrom('a', 'é', '☃', '😀', '👩‍👩‍👦'), {
					maxLength: 120,
				}),
				(characters) => {
					for (const physical of foldIcsLine(characters.join(''))) {
						expect(/[\uD800-\uDBFF]$/.test(physical)).toBe(false);
						expect(/^ ?[\uDC00-\uDFFF]/.test(physical)).toBe(false);
					}
				},
			),
		);
	});
});
