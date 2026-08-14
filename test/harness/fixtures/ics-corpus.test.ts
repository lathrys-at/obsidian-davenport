import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	ICS_CATEGORIES,
	icsCorpus,
	icsFixture,
	icsFixtureArbitrary,
	icsFixtureNamesOnDisk,
	icsFixturesFor,
	type IcsCategory,
} from './ics-corpus';
import {
	icsLogicalLines,
	icsPhysicalLines,
	isFoldedContinuation,
} from '../ics-lines';
import { ICS_LINE_OCTET_LIMIT, octetLength } from '../ics-octets';

const BEGIN = 'BEGIN:';
const END = 'END:';

/**
 * For each category, the pattern of a line that a fixture must contain. A
 * fixture that claims a category must contain a line that the pattern of
 * that category matches. Without such a line, the category is wrong.
 */
const CATEGORY_MARKER: Record<IcsCategory, RegExp> = {
	'vendor-x-properties': /^X-/im,
	'foreign-alarms': /^BEGIN:VALARM$/m,
	'structured-location': /^X-APPLE-(?:STRUCTURED-LOCATION|TRAVEL)/m,
	'folding-and-escaping': /^[ \t]|\\[\\,;nN]/m,
	vtimezone: /^BEGIN:VTIMEZONE$/m,
	'recurrence-overrides': /^(?:RECURRENCE-ID|EXDATE|RDATE)[;:]/m,
};

function nestingErrors(logical: readonly string[]): string[] {
	const open: string[] = [];
	const errors: string[] = [];
	for (const line of logical) {
		if (line.startsWith(BEGIN)) {
			open.push(line.slice(BEGIN.length));
			continue;
		}
		if (!line.startsWith(END)) continue;
		const closing = line.slice(END.length);
		const opened = open.pop();
		if (opened !== closing) {
			errors.push(`${END}${closing} closes ${opened ?? 'nothing'}`);
		}
	}
	return [...errors, ...open.map((name) => `${BEGIN}${name} never closed`)];
}

describe('ICS corpus index', () => {
	it('lists every fixture file one time', () => {
		const indexed = icsCorpus().map((fixture) => fixture.id);
		expect([...indexed].sort()).toEqual(icsFixtureNamesOnDisk());
		expect(new Set(indexed).size).toBe(indexed.length);
	});

	it('gives every category at least one fixture', () => {
		for (const category of ICS_CATEGORIES) {
			expect(icsFixturesFor(category)).not.toHaveLength(0);
		}
	});

	it('gives every fixture distinct categories, a summary and a matching path', () => {
		for (const fixture of icsCorpus()) {
			expect(new Set(fixture.categories).size).toBe(
				fixture.categories.length,
			);
			expect(fixture.summary.length).toBeGreaterThan(0);
			expect(fixture.path.endsWith(`${fixture.id}.ics`)).toBe(true);
		}
	});

	it('finds a fixture by its id', () => {
		const fixture = icsFixture('fold-at-75-octets');
		expect(fixture.id).toBe('fold-at-75-octets');
		expect(fixture.content.length).toBeGreaterThan(0);
	});

	it('names the fixture that it cannot find', () => {
		expect(() => icsFixture('absent')).toThrow(/absent/);
	});
});

describe('ICS corpus files', () => {
	// The line reader accepts any line ending. It would therefore hide a
	// wrong ending here, so this test examines the text directly: every CR
	// must have an LF after it, and every LF must have a CR before it.
	it.each(icsCorpus())('$id ends every line with CRLF', (fixture) => {
		expect(fixture.content).not.toHaveLength(0);
		expect(fixture.content.endsWith('\r\n')).toBe(true);
		expect(fixture.content).not.toMatch(/\r(?!\n)|(?<!\r)\n/);
	});

	it.each(icsCorpus())(
		'$id keeps every physical line within the octet limit',
		(fixture) => {
			for (const line of icsPhysicalLines(fixture.content)) {
				expect(octetLength(line)).toBeLessThanOrEqual(
					ICS_LINE_OCTET_LIMIT,
				);
			}
		},
	);

	it.each(icsCorpus())('$id holds exactly one calendar object', (fixture) => {
		const logical = icsLogicalLines(icsPhysicalLines(fixture.content));
		expect(logical[0]).toBe('BEGIN:VCALENDAR');
		expect(logical[logical.length - 1]).toBe('END:VCALENDAR');
		expect(
			logical.filter((line) => line === 'BEGIN:VCALENDAR'),
		).toHaveLength(1);
		expect(nestingErrors(logical)).toEqual([]);
		expect(logical).toContain('VERSION:2.0');
		expect(
			logical.filter((line) => line.startsWith('PRODID:')),
		).toHaveLength(1);
	});

	it.each(icsCorpus())(
		'$id unfolds into lines that each start with a property name',
		(fixture) => {
			for (const line of icsLogicalLines(
				icsPhysicalLines(fixture.content),
			)) {
				expect(line).toMatch(/^[A-Za-z0-9-]+[;:]/);
			}
		},
	);

	it.each(icsCorpus())(
		'$id carries a line for every category that it claims',
		(fixture) => {
			for (const category of fixture.categories) {
				expect(fixture.content).toMatch(CATEGORY_MARKER[category]);
			}
		},
	);
});

describe('ICS corpus coverage', () => {
	const allLines = icsCorpus().flatMap((fixture) =>
		icsPhysicalLines(fixture.content),
	);

	it('holds a line of exactly the octet limit', () => {
		const widest = Math.max(...allLines.map(octetLength));
		expect(widest).toBe(ICS_LINE_OCTET_LIMIT);
	});

	it('gives the fold fixture at least two lines of exactly the octet limit', () => {
		const lines = icsPhysicalLines(icsFixture('fold-at-75-octets').content);
		const atLimit = lines.filter(
			(line) => octetLength(line) === ICS_LINE_OCTET_LIMIT,
		);
		expect(atLimit.length).toBeGreaterThanOrEqual(2);
	});

	it('carries characters that need more than one octet', () => {
		const wide = allLines.filter((line) => octetLength(line) > line.length);
		expect(wide).not.toHaveLength(0);
	});

	it('folds with a tab and also with a space', () => {
		const continuations = allLines.filter(isFoldedContinuation);
		expect(
			continuations.filter((line) => line.startsWith('\t')),
		).not.toHaveLength(0);
		expect(
			continuations.filter((line) => line.startsWith(' ')),
		).not.toHaveLength(0);
	});
});

describe('ICS corpus sampling', () => {
	it('draws only fixtures that belong to the corpus', () => {
		const drawn = fc.sample(icsFixtureArbitrary(), 25);
		for (const fixture of drawn) {
			expect(icsCorpus()).toContain(fixture);
		}
	});

	it('draws only fixtures that carry the given category', () => {
		for (const category of ICS_CATEGORIES) {
			for (const fixture of fc.sample(
				icsFixtureArbitrary(category),
				10,
			)) {
				expect(fixture.categories).toContain(category);
			}
		}
	});
});

describe('ICS corpus octet-limit fixtures', () => {
	it.each([['fold-at-75-octets'], ['fold-splits-multibyte-run']])(
		'%s holds a line of exactly the octet limit',
		(id) => {
			const lines = icsPhysicalLines(icsFixture(id).content);
			const widest = Math.max(...lines.map(octetLength));
			expect(widest).toBe(ICS_LINE_OCTET_LIMIT);
		},
	);
});
