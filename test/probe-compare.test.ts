/**
 * The comparison that the probe kit exists for. The input is one results
 * file from each of several environments. The output is a verdict.
 *
 * A real vault is the only place where the plugin half can run. A person
 * therefore runs the plugin half by hand in a real vault. The comparison
 * half is a pure function on parsed files. Therefore these tests can build
 * results to order, and can reach each case that matters: agreement,
 * divergence, a fixture that the writer refused, and a file whose own
 * contents do not agree with each other.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	compareRuns,
	parseResults,
	type ComparisonReport,
	type FixtureComparison,
	type LoadedRun,
} from '../tools/frontmatter-probe/compare-core';
import { formatReport } from '../tools/frontmatter-probe/compare-format';
import type {
	FixtureResult,
	MetadataSettling,
	ProbeResults,
} from '../tools/frontmatter-probe/results';

const encoder = new TextEncoder();

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/** A fixture that the writer accepted, with this text as its output. */
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

/** The same record, from an environment whose wait for the app ran out. */
function stale(id: string, text: string): FixtureResult {
	return emitted(id, text, { settledBy: 'timeout' });
}

/** A fixture that the writer refused. */
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

/** Runs with the labels that the script gives them. */
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

	it('puts the agreement in the verdict', () => {
		expect(report.verdict).toBe('agree');
		expect(formatReport(report)).toContain(
			'verdict: all 1 fixtures agree across 2 environments',
		);
	});

	it('names the device that each environment ran on', () => {
		const printed = formatReport(report);
		expect(printed).toContain('macOS, app 1.9.14, api 1.9.14');
		expect(printed).toContain('iOS, app 1.9.14, api 1.9.14');
	});
});

describe('environments that diverge', () => {
	// The two strings are twenty-four bytes long, and they differ at
	// offset 20. This length gives the dump one row before the difference.
	// This offset puts the difference in the marked row.
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

	it('names the byte where the two outputs start to differ', () => {
		const divergence = only(fixture.divergences);
		expect(divergence.offset).toBe(20);
		expect(divergence.kind).toBe('byte');
		expect(divergence.reference).toBe('#1');
		expect(divergence.other).toBe('#2');
	});

	it('shows the bytes on each side of the difference', () => {
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

	it('reports the length, and not a differing byte', () => {
		const divergence = only(fixtureNamed(report, 'minimal').divergences);
		expect(divergence.kind).toBe('length');
		expect(divergence.offset).toBe(3);
		expect(formatReport(report)).toContain(
			'identical up to offset 3, where one output ends',
		);
	});
});

describe('a fixture that the writer refuses', () => {
	it('counts as agreement when every environment refuses the fixture', () => {
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

	it('is a divergence when only one environment refuses the fixture', () => {
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

describe('results that cannot be compared in their present form', () => {
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

	it('refuses a hash that does not match the bytes beside the hash', () => {
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

	it('refuses output that is not base64', () => {
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

describe('a fixture that the probe wrote after the wait ran out', () => {
	it('puts a caution in the fixture row and in a separate block', () => {
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
		expect(printed).toContain(
			'any conclusion that rests only on that environment needs that environment to run the fixture again',
		);
	});

	it('keeps the agreement when nothing differs', () => {
		const report = compareRuns(
			runsOf(
				resultsOf([emitted('comments', 'a')]),
				resultsOf([stale('comments', 'a')]),
			),
		);
		expect(report.verdict).toBe('agree');
	});

	// The costly wrong answer is a stale read that reads as a divergence.
	// Therefore a difference that only a cautioned fixture shows is not a
	// verdict.
	it('does not report a divergence that only a cautioned fixture shows', () => {
		const report = compareRuns(
			runsOf(
				resultsOf([emitted('comments', 'a')]),
				resultsOf([stale('comments', 'b')]),
			),
		);
		const fixture = fixtureNamed(report, 'comments');
		expect(fixture.outcome).toBe('diverge');
		expect(fixture.unproven).toBe(true);
		expect(report.verdict).toBe('incomparable');
		const printed = formatReport(report);
		expect(printed).toContain('the cautions and notes above say why');
		expect(printed).toContain(
			'the difference here rests on that environment alone, and the difference is unproven until that environment runs the fixture again',
		);
	});

	it('reports a divergence on a fixture that carries no caution', () => {
		const report = compareRuns(
			runsOf(
				resultsOf([emitted('comments', 'a'), emitted('minimal', 'a')]),
				resultsOf([stale('comments', 'b'), emitted('minimal', 'b')]),
			),
		);
		expect(report.verdict).toBe('diverge');
	});
});

describe('a caution on an environment that is not in a difference', () => {
	// Two environments without a timeout show the difference between them.
	// A third environment with a timeout says nothing about that
	// difference.
	const report = compareRuns(
		runsOf(
			resultsOf([emitted('comments', 'a')]),
			resultsOf([emitted('comments', 'b')]),
			resultsOf([stale('comments', 'a')]),
		),
	);
	const fixture = fixtureNamed(report, 'comments');

	it('keeps the difference as a divergence', () => {
		expect(fixture.outcome).toBe('diverge');
		expect(fixture.unproven).toBe(false);
		expect(report.verdict).toBe('diverge');
	});

	it('groups the environment that timed out by the output it emitted', () => {
		expect(fixture.groups.map((group) => group.labels)).toEqual([
			['#1', '#3'],
			['#2'],
		]);
		expect(fixture.cautions).toEqual(['#3']);
	});

	it('prints the caution, and does not call the difference unproven', () => {
		const printed = formatReport(report);
		expect(printed).toContain(
			'! comments: #3 waited out the metadata timeout',
		);
		expect(printed).toContain(
			'any conclusion that rests only on that environment needs that environment to run the fixture again',
		);
		expect(printed).not.toContain('rests on that environment alone');
		expect(printed).toContain('first differing byte at offset 0');
		expect(printed).toContain(
			'verdict: 1 of 1 fixtures diverge across 3 environments',
		);
	});
});

describe('a difference where every side has an environment with a timeout', () => {
	it('is unproven when the probe wrote both outputs after a timeout', () => {
		const report = compareRuns(
			runsOf(
				resultsOf([stale('comments', 'a')]),
				resultsOf([stale('comments', 'b')]),
			),
		);
		expect(fixtureNamed(report, 'comments').unproven).toBe(true);
		expect(report.verdict).toBe('incomparable');
	});

	it('is unproven when the one environment that emitted bytes timed out', () => {
		const report = compareRuns(
			runsOf(
				resultsOf([stale('non-mapping', 'a')]),
				resultsOf([refused('non-mapping', 'YAMLParseError: no map')]),
			),
		);
		const fixture = fixtureNamed(report, 'non-mapping');
		expect(fixture.outcome).toBe('mixed');
		expect(fixture.unproven).toBe(true);
		expect(report.verdict).toBe('incomparable');
	});

	// A refusal has no wait, so a refusal always counts. One environment
	// without a timeout that emitted bytes is enough to make the refusal a
	// real disagreement.
	it('stands when an environment without a timeout also emitted bytes', () => {
		const report = compareRuns(
			runsOf(
				resultsOf([emitted('non-mapping', 'a')]),
				resultsOf([refused('non-mapping', 'YAMLParseError: no map')]),
				resultsOf([stale('non-mapping', 'a')]),
			),
		);
		const fixture = fixtureNamed(report, 'non-mapping');
		expect(fixture.outcome).toBe('mixed');
		expect(fixture.unproven).toBe(false);
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

	it('refuses files that have no fixture in common', () => {
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

describe('one run given two times', () => {
	it('reports the repeat without a failure of the comparison', () => {
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

describe('a file that records one fixture two times', () => {
	it('reads as an integrity failure, and not as the last record', () => {
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
	it('says that a comparison needs a second environment', () => {
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

	it('reads back the same results that the probe writes', () => {
		expect(parseResults(JSON.stringify(results), 'a.json')).toEqual(
			results,
		);
	});

	it.each([
		['not JSON', 'this is not json', 'not JSON'],
		['some other JSON file', '{"hello":"world"}', 'not a results file'],
		[
			'a list',
			'[]',
			'the file is missing, or the value at that place is not an object',
		],
	])('refuses %s', (_name, text, complaint) => {
		expect(() => parseResults(text, 'a.json')).toThrow(complaint);
	});

	it('refuses an emission that does not say how the wait settled', () => {
		const record = { ...emitted('minimal', 'a') } as Record<
			string,
			unknown
		>;
		delete record.settledBy;
		const missing = JSON.stringify({ ...results, perFixture: [record] });
		expect(() => parseResults(missing, 'a.json')).toThrow(
			'does not say whether the wait before the writer settled by event or by timeout',
		);
	});

	it('names the field that a truncated file is missing', () => {
		const missing = JSON.stringify({
			...results,
			platform: { isDesktop: true },
		});
		expect(() => parseResults(missing, 'a.json')).toThrow(
			'platform has no isMobile',
		);
	});

	it('names the file that it could not read', () => {
		expect(() => parseResults('{', 'phone.json')).toThrow('phone.json');
	});
});
