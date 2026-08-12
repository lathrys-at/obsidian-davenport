/**
 * The comparison the probe kit exists for: results files from several
 * environments, in and a verdict out.
 *
 * The plugin half is exercised by hand in a real vault, which is the only
 * place it can be. This half is a pure function over parsed files, so the
 * cases that matter — agreement, divergence, a fixture the writer refused,
 * and a file that does not add up — are all reachable from here with
 * results built to order.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	compareRuns,
	parseResults,
	type ComparisonReport,
	type FixtureComparison,
	type LoadedRun,
} from '../tools/a11-probe/compare-core';
import { formatReport } from '../tools/a11-probe/compare-format';
import type { FixtureResult, ProbeResults } from '../tools/a11-probe/results';

const encoder = new TextEncoder();

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/** A fixture that came through, carrying this text as its output. */
function emitted(id: string, text: string, input = id): FixtureResult {
	const bytes = encoder.encode(text);
	return {
		id,
		inputHash: digest(encoder.encode(input)),
		outputBase64: Buffer.from(bytes).toString('base64'),
		outputHash: digest(bytes),
	};
}

/** A fixture the writer refused. */
function refused(id: string, message: string, input = id): FixtureResult {
	return {
		id,
		inputHash: digest(encoder.encode(input)),
		error: message,
	};
}

function resultsOf(
	perFixture: readonly FixtureResult[],
	device: Partial<ProbeResults['platform']> = {},
): ProbeResults {
	return {
		kind: 'frontmatter-emission-samples',
		timestamp: '2026-08-12T09:00:00.000Z',
		obsidianVersion: '1.9.14',
		apiVersion: '1.9.14',
		platform: {
			isDesktop: true,
			isMobile: false,
			isIosApp: false,
			isAndroidApp: false,
			isMacOS: true,
			isWin: false,
			isLinux: false,
			userAgent: 'a test',
			...device,
		},
		marker: { key: 'probe-marker', value: 'fixed' },
		perFixture,
	};
}

/** Runs labelled the way the script labels them. */
function runsOf(...results: readonly ProbeResults[]): LoadedRun[] {
	return results.map((entry, index) => ({
		label: `#${String(index + 1)}`,
		source: `results-${String(index + 1)}.json`,
		results: entry,
	}));
}

function fixtureNamed(report: ComparisonReport, id: string): FixtureComparison {
	const found = report.fixtures.find((fixture) => fixture.id === id);
	if (found === undefined) {
		throw new Error(`the report says nothing about ${id}`);
	}
	return found;
}

function only<T>(values: readonly T[]): T {
	const [first] = values;
	if (values.length !== 1 || first === undefined) {
		throw new Error(`expected one value, got ${String(values.length)}`);
	}
	return first;
}

describe('environments that agree', () => {
	const report = compareRuns(
		runsOf(
			resultsOf([emitted('minimal', '---\ntitle: a\n---\n')]),
			resultsOf([emitted('minimal', '---\ntitle: a\n---\n')], {
				isDesktop: false,
				isMobile: true,
				isIosApp: true,
			}),
		),
	);

	it('reads the fixture as agreement', () => {
		const fixture = fixtureNamed(report, 'minimal');
		expect(fixture.outcome).toBe('agree');
		expect(only(fixture.groups).labels).toEqual(['#1', '#2']);
		expect(fixture.divergences).toEqual([]);
	});

	it('says so in the verdict', () => {
		expect(report.verdict).toBe('agree');
		expect(formatReport(report)).toContain(
			'verdict: all 1 fixtures agree across 2 environments',
		);
	});

	it('names each environment by what it ran on', () => {
		const printed = formatReport(report);
		expect(printed).toContain('macOS, app 1.9.14, api 1.9.14');
		expect(printed).toContain('iOS, app 1.9.14, api 1.9.14');
	});
});

describe('environments that diverge', () => {
	// Twenty-four bytes with one changed at offset 20, so the dump has a
	// row before the difference and the marked row holds it.
	const left = 'abcdefghijklmnopqrstuvwx';
	const right = 'abcdefghijklmnopqrstQvwx';
	const report = compareRuns(
		runsOf(
			resultsOf([emitted('comments', left)]),
			resultsOf([emitted('comments', right)]),
		),
	);
	const fixture = fixtureNamed(report, 'comments');

	it('groups the environments by what they emitted', () => {
		expect(fixture.outcome).toBe('diverge');
		expect(fixture.groups.map((group) => group.labels)).toEqual([
			['#1'],
			['#2'],
		]);
	});

	it('names the byte the two outputs part company at', () => {
		const divergence = only(fixture.divergences);
		expect(divergence.offset).toBe(20);
		expect(divergence.kind).toBe('byte');
		expect(divergence.reference).toBe('#1');
		expect(divergence.other).toBe('#2');
	});

	it('shows the bytes either side of it', () => {
		const divergence = only(fixture.divergences);
		expect(divergence.referenceDump).toEqual([
			'  00000000  61 62 63 64 65 66 67 68 69 6a 6b 6c 6d 6e 6f 70  |abcdefghijklmnop|',
			'> 00000010  71 72 73 74 75 76 77 78                          |qrstuvwx|',
		]);
		expect(only(divergence.otherDump.slice(1))).toContain('|qrstQvwx|');
	});

	it('carries the offset and the dump into the printed report', () => {
		const printed = formatReport(report);
		expect(printed).toContain('first differing byte at offset 20');
		expect(printed).toContain('|qrstQvwx|');
		expect(printed).toContain(
			'verdict: 1 of 1 fixtures diverge across 2 environments',
		);
		expect(report.verdict).toBe('diverge');
	});
});

describe('outputs where one is the start of the other', () => {
	const report = compareRuns(
		runsOf(
			resultsOf([emitted('minimal', 'abcdef')]),
			resultsOf([emitted('minimal', 'abc')]),
		),
	);

	it('reports the length rather than a differing byte', () => {
		const divergence = only(fixtureNamed(report, 'minimal').divergences);
		expect(divergence.kind).toBe('length');
		expect(divergence.offset).toBe(3);
		expect(formatReport(report)).toContain(
			'identical up to offset 3, where one output ends',
		);
	});
});

describe('a fixture the writer refuses', () => {
	it('counts as agreement when every environment refuses it', () => {
		const report = compareRuns(
			runsOf(
				resultsOf([refused('unparseable', 'YAMLParseError: no end')]),
				resultsOf([refused('unparseable', 'Error: bad frontmatter')]),
			),
		);
		expect(fixtureNamed(report, 'unparseable').outcome).toBe('error');
		expect(report.verdict).toBe('agree');
		const printed = formatReport(report);
		expect(printed).toContain('refused by every environment');
		expect(printed).toContain('(1 refused by every environment)');
		expect(printed).toContain('#1 unparseable: YAMLParseError: no end');
	});

	it('is a divergence when only one environment refuses it', () => {
		const report = compareRuns(
			runsOf(
				resultsOf([refused('unparseable', 'YAMLParseError: no end')]),
				resultsOf([emitted('unparseable', '---\ntags: [x]\n---\n')]),
			),
		);
		expect(fixtureNamed(report, 'unparseable').outcome).toBe('mixed');
		expect(report.verdict).toBe('diverge');
		expect(formatReport(report)).toContain('refused by #1');
	});
});

describe('results that cannot be compared as they stand', () => {
	it('refuses runs that started from different fixture text', () => {
		const report = compareRuns(
			runsOf(
				resultsOf([emitted('minimal', 'same', 'one corpus')]),
				resultsOf([emitted('minimal', 'same', 'another corpus')]),
			),
		);
		expect(report.corpusMismatches).toEqual(['minimal']);
		expect(report.verdict).toBe('incomparable');
		expect(formatReport(report)).toContain(
			'did not start from the same fixture text',
		);
	});

	it('refuses a run that has no record of a fixture', () => {
		const report = compareRuns(
			runsOf(
				resultsOf([emitted('minimal', 'a'), emitted('nested', 'b')]),
				resultsOf([emitted('minimal', 'a')]),
			),
		);
		expect(fixtureNamed(report, 'nested').outcome).toBe('incomplete');
		expect(fixtureNamed(report, 'nested').missing).toEqual(['#2']);
		expect(report.verdict).toBe('incomparable');
	});

	it('refuses a hash that is not the hash of the bytes beside it', () => {
		const tampered = emitted('minimal', 'a');
		const report = compareRuns(
			runsOf(
				resultsOf([emitted('minimal', 'a')]),
				resultsOf([{ ...tampered, outputHash: 'f'.repeat(64) }]),
			),
		);
		expect(only(report.integrityFailures).label).toBe('#2');
		expect(only(report.integrityFailures).note).toContain(
			'is not the hash of the recorded bytes',
		);
		expect(report.verdict).toBe('incomparable');
	});

	it('refuses output that is not base64 at all', () => {
		const report = compareRuns(
			runsOf(
				resultsOf([emitted('minimal', 'a')]),
				resultsOf([
					{
						id: 'minimal',
						inputHash: digest(encoder.encode('minimal')),
						outputBase64: 'not base64!',
						outputHash: 'f'.repeat(64),
					},
				]),
			),
		);
		expect(only(report.integrityFailures).note).toContain('not base64');
		expect(report.verdict).toBe('incomparable');
	});
});

describe('a single results file', () => {
	it('says a comparison needs a second one', () => {
		const report = compareRuns(
			runsOf(resultsOf([emitted('minimal', 'a')])),
		);
		expect(formatReport(report)).toContain(
			'one environment only, so there is nothing to compare',
		);
		expect(formatReport(report)).toContain('a comparison needs a second');
	});
});

describe('reading a results file', () => {
	const results = resultsOf([
		emitted('minimal', 'a'),
		refused('unparseable', 'YAMLParseError'),
	]);

	it('reads back what the probe would have written', () => {
		expect(parseResults(JSON.stringify(results), 'a.json')).toEqual(
			results,
		);
	});

	it.each([
		['not JSON', 'this is not json', 'not JSON'],
		['some other JSON file', '{"hello":"world"}', 'not a results file'],
		['a list', '[]', 'the file is missing or not an object'],
	])('refuses %s', (_name, text, complaint) => {
		expect(() => parseResults(text, 'a.json')).toThrow(complaint);
	});

	it('names the field a truncated file is missing', () => {
		const missing = JSON.stringify({
			...results,
			platform: { isDesktop: true },
		});
		expect(() => parseResults(missing, 'a.json')).toThrow(
			'platform has no isMobile',
		);
	});

	it('names the file it could not read', () => {
		expect(() => parseResults('{', 'phone.json')).toThrow('phone.json');
	});
});
