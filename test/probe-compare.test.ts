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
import type {
	FixtureResult,
	MetadataSettling,
	ProbeResults,
} from '../tools/a11-probe/results';

const encoder = new TextEncoder();

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/** A fixture that came through, carrying this text as its output. */
function emitted(
	id: string,
	text: string,
	{
		input = id,
		settledBy = 'event',
	}: { input?: string; settledBy?: MetadataSettling } = {},
): FixtureResult {
	const bytes = encoder.encode(text);
	return {
		id,
		inputHash: digest(encoder.encode(input)),
		settledBy,
		outputBase64: Buffer.from(bytes).toString('base64'),
		outputHash: digest(bytes),
	};
}

/** The same, from an environment whose wait for the app ran out. */
function stale(id: string, text: string): FixtureResult {
	return emitted(id, text, { settledBy: 'timeout' });
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
				resultsOf([
					emitted('minimal', 'same', { input: 'one corpus' }),
				]),
				resultsOf([
					emitted('minimal', 'same', { input: 'another corpus' }),
				]),
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
						settledBy: 'event',
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

describe('a fixture written after the wait ran out', () => {
	it('carries a caution into the row and a block of its own', () => {
		const report = compareRuns(
			runsOf(
				resultsOf([emitted('comments', 'a')]),
				resultsOf([stale('comments', 'a')]),
			),
		);
		expect(fixtureNamed(report, 'comments').cautions).toEqual(['#2']);
		const printed = formatReport(report);
		expect(printed).toContain('wait timed out in #2');
		expect(printed).toContain(
			'! comments: #2 waited out the metadata timeout',
		);
		expect(printed).toContain('unproven until that environment runs');
	});

	it('leaves agreement standing when nothing differs', () => {
		const report = compareRuns(
			runsOf(
				resultsOf([emitted('comments', 'a')]),
				resultsOf([stale('comments', 'a')]),
			),
		);
		expect(report.verdict).toBe('agree');
	});

	// The expensive wrong answer is a divergence that is really a stale
	// read, so one that only a cautioned fixture shows is not a verdict.
	it('withholds a divergence that only a cautioned fixture shows', () => {
		const report = compareRuns(
			runsOf(
				resultsOf([emitted('comments', 'a')]),
				resultsOf([stale('comments', 'b')]),
			),
		);
		expect(fixtureNamed(report, 'comments').outcome).toBe('diverge');
		expect(report.verdict).toBe('incomparable');
		expect(formatReport(report)).toContain(
			'the cautions and notes above say why',
		);
	});

	it('still reports a divergence that stands on its own', () => {
		const report = compareRuns(
			runsOf(
				resultsOf([emitted('comments', 'a'), emitted('minimal', 'a')]),
				resultsOf([stale('comments', 'b'), emitted('minimal', 'b')]),
			),
		);
		expect(report.verdict).toBe('diverge');
	});
});

describe('files with nothing in common', () => {
	it('refuses two files that record no fixtures at all', () => {
		const report = compareRuns(runsOf(resultsOf([]), resultsOf([])));
		expect(report.verdict).toBe('incomparable');
		expect(report.problems).toContain('#1 records no fixtures at all');
		const printed = formatReport(report);
		expect(printed).not.toContain('byte-identical');
		expect(printed).toContain('cannot be compared');
	});

	it('refuses files whose fixtures do not overlap', () => {
		const report = compareRuns(
			runsOf(
				resultsOf([emitted('minimal', 'a')]),
				resultsOf([emitted('nested', 'a')]),
			),
		);
		expect(report.verdict).toBe('incomparable');
		expect(formatReport(report)).toContain(
			'no fixture appears in more than one of these files',
		);
	});
});

describe('one run submitted twice', () => {
	it('says so without failing the comparison', () => {
		const twice = resultsOf([emitted('minimal', 'a')]);
		const report = compareRuns(runsOf(twice, twice));
		expect(report.warnings).toEqual([
			'#1 and #2 carry the same environment and the same timestamp, so they may be one run counted twice',
		]);
		expect(report.verdict).toBe('agree');
		expect(formatReport(report)).toContain('may be one run counted twice');
	});

	it('says nothing about two runs from different environments', () => {
		const report = compareRuns(
			runsOf(
				resultsOf([emitted('minimal', 'a')]),
				resultsOf([emitted('minimal', 'a')], {
					userAgent: 'another device',
				}),
			),
		);
		expect(report.warnings).toEqual([]);
	});
});

describe('a file that records one fixture twice', () => {
	it('reads as an integrity failure rather than the last record', () => {
		const report = compareRuns(
			runsOf(
				resultsOf([emitted('minimal', 'a')]),
				resultsOf([emitted('minimal', 'a'), emitted('minimal', 'b')]),
			),
		);
		expect(only(report.integrityFailures)).toEqual({
			label: '#2',
			id: 'minimal',
			note: 'this file records the fixture more than once',
		});
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

	it('refuses an emission that does not say how its wait settled', () => {
		const record = { ...emitted('minimal', 'a') } as Record<
			string,
			unknown
		>;
		delete record.settledBy;
		const missing = JSON.stringify({ ...results, perFixture: [record] });
		expect(() => parseResults(missing, 'a.json')).toThrow(
			'does not say whether its wait settled by event or by timeout',
		);
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
