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
	ICS_LINE_OCTET_LIMIT,
	icsLogicalLines,
	icsPhysicalLines,
	isFoldedContinuation,
	octetLength,
} from './ics-lines';

const BEGIN = 'BEGIN:';
const END = 'END:';

// A line that must appear in a fixture for its category tag to be honest.
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
	it('enumerates every fixture file exactly once', () => {
		const indexed = icsCorpus().map((fixture) => fixture.name);
		expect([...indexed].sort()).toEqual(icsFixtureNamesOnDisk());
		expect(new Set(indexed).size).toBe(indexed.length);
	});

	it('leaves no category without a fixture', () => {
		for (const category of ICS_CATEGORIES) {
			expect(icsFixturesFor(category)).not.toHaveLength(0);
		}
	});

	it('tags and summarises every fixture', () => {
		for (const fixture of icsCorpus()) {
			expect(fixture.categories).not.toHaveLength(0);
			expect(new Set(fixture.categories).size).toBe(
				fixture.categories.length,
			);
			expect(fixture.summary.length).toBeGreaterThan(0);
			expect(fixture.path.endsWith(`${fixture.name}.ics`)).toBe(true);
		}
	});

	it('names the fixture it cannot find', () => {
		expect(() => icsFixture('absent')).toThrow(/absent/);
	});
});

describe('ICS corpus files', () => {
	it.each(icsCorpus())('$name ends every line with CRLF', (fixture) => {
		expect(fixture.text).not.toHaveLength(0);
		expect(fixture.text.endsWith('\r\n')).toBe(true);
		for (const line of icsPhysicalLines(fixture.text)) {
			expect(line).not.toMatch(/[\r\n]/);
		}
	});

	it.each(icsCorpus())('$name folds within the octet limit', (fixture) => {
		for (const line of icsPhysicalLines(fixture.text)) {
			expect(octetLength(line)).toBeLessThanOrEqual(ICS_LINE_OCTET_LIMIT);
		}
	});

	it.each(icsCorpus())('$name holds one calendar object', (fixture) => {
		const logical = icsLogicalLines(icsPhysicalLines(fixture.text));
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

	it.each(icsCorpus())('$name unfolds into properties', (fixture) => {
		for (const line of icsLogicalLines(icsPhysicalLines(fixture.text))) {
			expect(line).toMatch(/^[A-Za-z0-9-]+[;:]/);
		}
	});

	it.each(icsCorpus())(
		'$name carries the marks it is tagged with',
		(fixture) => {
			for (const category of fixture.categories) {
				expect(fixture.text).toMatch(CATEGORY_MARKER[category]);
			}
		},
	);
});

describe('ICS corpus coverage', () => {
	const allLines = icsCorpus().flatMap((fixture) =>
		icsPhysicalLines(fixture.text),
	);

	it('reaches the octet limit exactly', () => {
		const widest = Math.max(...allLines.map(octetLength));
		expect(widest).toBe(ICS_LINE_OCTET_LIMIT);
	});

	it('carries characters wider than one octet', () => {
		const wide = allLines.filter((line) => octetLength(line) > line.length);
		expect(wide).not.toHaveLength(0);
	});

	it('folds with a tab as well as with a space', () => {
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
	it('draws fixtures that belong to the corpus', () => {
		const drawn = fc.sample(icsFixtureArbitrary(), 25);
		for (const fixture of drawn) {
			expect(icsCorpus()).toContain(fixture);
		}
	});

	it('draws fixtures of the category asked for', () => {
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
