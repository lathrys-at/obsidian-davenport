/**
 * The decisions behind the coverage ratchet:
 *
 * - what the check reads out of the coverage summary of a run;
 * - which part of a count the check calls a percentage;
 * - whether the numbers of a baseline agree with each other;
 * - how far below a floor the check accepts a fall;
 * - which files the check requires the run to keep reporting;
 * - what the comparison says, and the wording that the check prints;
 * - what the check does when the summary or the baseline is absent.
 *
 * The committed baseline is the floor that each file of this repository
 * holds. One case reads that file, and not a copy of it. A copy would
 * drift, and then the case would prove the copy.
 *
 * The script itself only finds the files, reads them, and prints. A run can
 * end in several ways, and these cases exercise each way as a process. The
 * interface includes the exit status, and not only the words that the run
 * prints.
 */

import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
	Baseline,
	Count,
	Counts,
	Metric,
	Reading,
	Report,
} from '../scripts/coverage-ratchet-core';
import {
	GRACE,
	METRICS,
	compare,
	percentOf,
	readBaseline,
	readSummary,
	recordOf,
} from '../scripts/coverage-ratchet-core';
import { failureLines, reportLines } from '../scripts/coverage-ratchet-text';

const SCRIPT = fileURLToPath(
	new URL('../scripts/coverage-ratchet.mjs', import.meta.url),
);
const COMMITTED = fileURLToPath(
	new URL('../coverage-baseline.json', import.meta.url),
);

/** The root that the cases of the reader use. */
const ROOT = '/root/repo';

/** How many of one thing a file holds, and how many of them the tests run. */
type Pair = readonly [covered: number, total: number];

/** One file of a run, as a case describes it. */
interface Sample {
	readonly path: string;
	readonly statements?: Pair;
	readonly branches?: Pair;
	readonly functions?: Pair;
	readonly lines?: Pair;
}

/** A file that holds nothing to count. */
const NOTHING: Pair = [0, 0];

function pairOf(sample: Sample, metric: Metric): Pair {
	return sample[metric] ?? NOTHING;
}

/** The counts of one file, in the shape that the summary holds. */
function countsJson(sample: Sample): Record<string, unknown> {
	const written: Record<string, unknown> = {};
	for (const metric of METRICS) {
		const [covered, total] = pairOf(sample, metric);
		written[metric] = {
			total,
			covered,
			skipped: 0,
			pct: percentOf({ total, covered }),
		};
	}
	return written;
}

/** The counts of a whole run, as the sums of these files. */
function totalOf(samples: readonly Sample[]): Sample {
	const sums: Record<string, Pair> = {};
	for (const metric of METRICS) {
		let covered = 0;
		let total = 0;
		for (const sample of samples) {
			const [reached, held] = pairOf(sample, metric);
			covered += reached;
			total += held;
		}
		sums[metric] = [covered, total];
	}
	return { path: 'total', ...sums };
}

/** A coverage summary in the shape that the json-summary reporter writes. */
function summaryText(samples: readonly Sample[], root = ROOT): string {
	const written: Record<string, unknown> = {
		total: countsJson(totalOf(samples)),
	};
	for (const sample of samples) {
		written[`${root}/${sample.path}`] = countsJson(sample);
	}
	return JSON.stringify(written);
}

/** The value of a reading. A refusal ends the case. */
function taken<T>(reading: Reading<T>): T {
	if (!reading.ok) {
		throw new Error(reading.reason);
	}
	return reading.value;
}

/** The reason of a refusal. A reading that is not a refusal fails the case. */
function refusal<T>(reading: Reading<T>): string {
	expect(reading.ok).toBe(false);
	return reading.ok ? '' : reading.reason;
}

/** The report of a run that these files describe. */
function reportOf(samples: readonly Sample[]): Report {
	return taken(readSummary(summaryText(samples), ROOT));
}

/** The baseline of a run that these files describe. */
function baselineOf(samples: readonly Sample[]): Baseline {
	return taken(readBaseline(JSON.stringify(recordOf(reportOf(samples)))));
}

/** The counts of one file of a report. */
function countsOf(report: Report, path: string): Counts {
	const file = report.files.find((held) => held.path === path);
	if (file === undefined) {
		throw new Error(`the report holds no file ${path}`);
	}
	return file.counts;
}

describe('the coverage summary reader', () => {
	it('reads the counts of each file and of the whole run', () => {
		const report = reportOf([
			{ path: 'src/a.ts', statements: [3, 4], branches: [1, 2] },
			{ path: 'src/b.ts', statements: [1, 1], functions: [2, 2] },
		]);
		expect(report.files.map((file) => file.path)).toStrictEqual([
			'src/a.ts',
			'src/b.ts',
		]);
		expect(countsOf(report, 'src/a.ts').statements).toStrictEqual({
			total: 4,
			covered: 3,
		});
		expect(report.total.statements).toStrictEqual({
			total: 5,
			covered: 4,
		});
		expect(report.total.functions).toStrictEqual({ total: 2, covered: 2 });
	});

	it('names each file relative to the root of the repository', () => {
		const report = taken(
			readSummary(summaryText([{ path: 'src/deep/c.ts' }]), `${ROOT}/`),
		);
		expect(report.files[0]?.path).toBe('src/deep/c.ts');
	});

	it('passes over the percentage that the summary states', () => {
		const written = JSON.parse(
			summaryText([{ path: 'src/a.ts', statements: [1, 2] }]),
		) as Record<string, Record<string, Record<string, number>>>;
		const file = written[`${ROOT}/src/a.ts`]?.statements;
		expect(file).toBeDefined();
		if (file !== undefined) {
			file.pct = 99;
		}
		const report = taken(readSummary(JSON.stringify(written), ROOT));
		expect(percentOf(countsOf(report, 'src/a.ts').statements)).toBe(50);
	});

	it.each([
		['text that is not JSON', 'not json', 'is not JSON'],
		['a summary that is not an object', '[]', 'is not a JSON object'],
		['a summary with no total', '{}', 'the whole run of the coverage'],
		[
			'a summary that gives a file no branches',
			`{"total":{},"${ROOT}/src/a.ts":{}}`,
			'the whole run of the coverage summary gives no statements',
		],
		[
			'a summary with no file',
			JSON.stringify({ total: countsJson({ path: 'total' }) }),
			'holds no file',
		],
	])('refuses %s', (_name, text, said) => {
		expect(refusal(readSummary(text, ROOT))).toContain(said);
	});

	it('refuses a file that is not under the root', () => {
		const text = summaryText([{ path: 'src/a.ts' }], '/somewhere/else');
		expect(refusal(readSummary(text, ROOT))).toBe(
			`the coverage summary holds the file /somewhere/else/src/a.ts, and that file is not under ${ROOT}`,
		);
	});

	it('refuses a file that runs more statements than it holds', () => {
		const text = JSON.stringify({
			total: countsJson({ path: 'total', statements: [5, 5] }),
			[`${ROOT}/src/a.ts`]: countsJson({
				path: 'src/a.ts',
				statements: [5, 4],
			}),
		});
		expect(refusal(readSummary(text, ROOT))).toBe(
			'the file src/a.ts of the coverage summary holds 4 statements, and it says that the tests run 5 of them',
		);
	});

	it('refuses a summary whose files do not add up to its total', () => {
		const written = JSON.parse(
			summaryText([{ path: 'src/a.ts', statements: [1, 2] }]),
		) as Record<string, Record<string, Record<string, number>>>;
		const total = written.total?.statements;
		expect(total).toBeDefined();
		if (total !== undefined) {
			total.total = 9;
		}
		expect(refusal(readSummary(JSON.stringify(written), ROOT))).toBe(
			'the coverage summary gives the whole run 9 statements, and its files add up to 2 statements',
		);
	});
});

describe('the percentage of a count', () => {
	it('gives a file that holds nothing to count 100 percent', () => {
		expect(percentOf({ total: 0, covered: 0 })).toBe(100);
	});

	it.each([
		[343, 373, 91.95],
		[254, 290, 87.58],
		[53, 66, 80.3],
		[12, 14, 85.71],
		[49, 49, 100],
		[0, 3, 0],
	])('gives %i of %i as %f percent', (covered, total, percent) => {
		expect(percentOf({ total, covered })).toBe(percent);
	});

	it('drops the places after the second one, and never rounds up', () => {
		// 2 of 3 is 66.666…, and a percentage that rounds up would state a
		// floor that the run does not reach.
		expect(percentOf({ total: 3, covered: 2 })).toBe(66.66);
	});

	it('gives a whole percentage no loss from binary arithmetic', () => {
		// A division before the multiplication makes a fraction that binary
		// arithmetic cannot hold, and the floor of it is then one hundredth
		// too small.
		for (let covered = 0; covered <= 100; covered += 1) {
			expect(percentOf({ total: 100, covered })).toBe(covered);
		}
	});
});

describe('the baseline reader', () => {
	/** The committed baseline, with one number of one file changed. */
	function tampered(
		change: (count: Record<string, number>) => void,
		path = 'src/a.ts',
	): string {
		const record = recordOf(
			reportOf([
				{ path, statements: [3, 4], branches: [1, 4] },
				{ path: 'src/b.ts', statements: [2, 2] },
			]),
		);
		const written = JSON.parse(JSON.stringify(record)) as {
			files: { path: string; statements: Record<string, number> }[];
		};
		const file = written.files.find((held) => held.path === path);
		expect(file).toBeDefined();
		if (file !== undefined) {
			change(file.statements);
		}
		return JSON.stringify(written);
	}

	it('reads the baseline that this repository commits', () => {
		const record = taken(readBaseline(readFileSync(COMMITTED, 'utf8')));
		expect(record.files.length).toBeGreaterThan(0);
		expect(record.total.statements.total).toBeGreaterThan(0);
		for (const file of record.files) {
			expect(file.path.startsWith('src/')).toBe(true);
		}
	});

	it('reads back the record that the check writes', () => {
		const report = reportOf([
			{ path: 'src/a.ts', statements: [3, 4], branches: [1, 4] },
			{ path: 'src/b.ts' },
		]);
		const read = taken(
			readBaseline(JSON.stringify(recordOf(report), undefined, '\t')),
		);
		expect(read).toStrictEqual(report);
	});

	it('refuses a percentage that the counts of the file do not give', () => {
		expect(
			refusal(
				readBaseline(
					tampered((statements) => {
						statements.pct = 10;
					}),
				),
			),
		).toBe(
			'the file src/a.ts of the coverage baseline gives the statements the percentage 10, and 3 of 4 statements is 75 percent',
		);
	});

	it('refuses a count that the counts of the whole run do not hold', () => {
		expect(
			refusal(
				readBaseline(
					tampered((statements) => {
						statements.covered = 1;
						statements.pct = 25;
					}),
				),
			),
		).toBe(
			'the coverage baseline says that the tests run 5 statements of the whole run, and its files add up to 3 statements',
		);
	});

	it('refuses a file that runs more statements than it holds', () => {
		expect(
			refusal(
				readBaseline(
					tampered((statements) => {
						statements.covered = 9;
						statements.pct = 100;
					}),
				),
			),
		).toBe(
			'the file src/a.ts of the coverage baseline holds 4 statements, and it says that the tests run 9 of them',
		);
	});

	it('refuses a file that stands in the baseline two times', () => {
		const record = recordOf(reportOf([{ path: 'src/a.ts' }]));
		const doubled = {
			...record,
			files: [...record.files, ...record.files],
		};
		expect(refusal(readBaseline(JSON.stringify(doubled)))).toBe(
			'the coverage baseline holds the file src/a.ts two times',
		);
	});

	it.each([
		['text that is not JSON', 'not json', 'is not JSON'],
		['a baseline that is not an object', '[]', 'is not a JSON object'],
		['a baseline with no whole run', '{"files":[]}', 'the whole run'],
		[
			'a baseline with no file',
			JSON.stringify({
				total: recordOf(reportOf([{ path: 'a' }])).total,
			}),
			'holds no file',
		],
		[
			'a baseline whose file has no path',
			JSON.stringify({
				...recordOf(reportOf([{ path: 'src/a.ts' }])),
				files: [{}],
			}),
			'holds a file with no path',
		],
	])('refuses %s', (_name, text, said) => {
		expect(refusal(readBaseline(text))).toContain(said);
	});

	it('refuses a baseline that gives a file no functions', () => {
		const record = recordOf(reportOf([{ path: 'src/a.ts' }]));
		const first = record.files[0];
		expect(first).toBeDefined();
		const stripped = {
			...record,
			files: [{ ...first, functions: undefined }],
		};
		expect(refusal(readBaseline(JSON.stringify(stripped)))).toBe(
			'the file src/a.ts of the coverage baseline gives no functions',
		);
	});
});

describe('the comparison against the baseline', () => {
	/** The comparison of a run against the baseline of another run. */
	function against(
		before: readonly Sample[],
		after: readonly Sample[],
	): ReturnType<typeof compare> {
		return compare(reportOf(after), baselineOf(before));
	}

	it('reports a run that matches its baseline as no change', () => {
		const samples = [{ path: 'src/a.ts', statements: [3, 4] as Pair }];
		const comparison = against(samples, samples);
		expect(comparison.fails).toBe(false);
		expect(comparison.changed).toStrictEqual([]);
		expect(comparison.gone).toStrictEqual([]);
		expect(comparison.fresh).toStrictEqual([]);
	});

	it('accepts a fall that stays inside the grace', () => {
		// 98 of 100 is 98 percent, and 96 of 100 is 96 percent.
		const comparison = against(
			[{ path: 'src/a.ts', statements: [98, 100] }],
			[{ path: 'src/a.ts', statements: [96, 100] }],
		);
		expect(comparison.fails).toBe(false);
		expect(comparison.changed[0]?.moves[0]?.change).toBe(-2);
		expect(comparison.changed[0]?.past).toBe(false);
	});

	it('fails on a fall that goes past the grace', () => {
		const comparison = against(
			[{ path: 'src/a.ts', statements: [98, 100] }],
			[{ path: 'src/a.ts', statements: [95, 100] }],
		);
		expect(comparison.fails).toBe(true);
		expect(comparison.changed[0]?.past).toBe(true);
		expect(comparison.changed[0]?.moves[0]).toMatchObject({
			metric: 'statements',
			floor: 98,
			now: 95,
			change: -3,
			past: true,
		});
	});

	it.each([
		[3133, false],
		[3132, true],
	])(
		'accepts a fall of exactly the grace and refuses the next hundredth',
		(covered, fails) => {
			// 3333 of 10000 is 33.33 percent, and 3133 of 10000 is 31.33
			// percent. The fall is then exactly two points. Neither
			// percentage has an exact form in binary arithmetic, so this
			// case also holds the arithmetic of the comparison to the
			// hundredth of a point.
			const comparison = against(
				[{ path: 'src/a.ts', branches: [3333, 10_000] }],
				[{ path: 'src/a.ts', branches: [covered, 10_000] }],
			);
			expect(GRACE).toBe(2);
			expect(comparison.fails).toBe(fails);
		},
	);

	it('never fails on the numbers of the whole run', () => {
		// The whole run falls because the file with the lower percentage
		// grows and takes a larger share of the counts. Each file holds its
		// own floor, and the run reports the same two files.
		const comparison = against(
			[
				{ path: 'src/a.ts', statements: [10, 10] },
				{ path: 'src/b.ts', statements: [45, 90] },
			],
			[
				{ path: 'src/a.ts', statements: [10, 10] },
				{ path: 'src/b.ts', statements: [450, 900] },
			],
		);
		expect(comparison.total[0]?.floor).toBe(55);
		expect(comparison.total[0]?.now).toBe(50.54);
		expect(comparison.changed).toStrictEqual([]);
		expect(comparison.fails).toBe(false);
	});

	it('fails when the run reports a file that the baseline does not hold', () => {
		const comparison = against(
			[{ path: 'src/a.ts', statements: [4, 4] }],
			[
				{ path: 'src/a.ts', statements: [4, 4] },
				{ path: 'src/new.ts', statements: [0, 96] },
			],
		);
		expect(comparison.fresh).toStrictEqual(['src/new.ts']);
		expect(comparison.changed).toStrictEqual([]);
		expect(comparison.fails).toBe(true);
	});

	it('fails when the run does not report a file of the baseline', () => {
		const comparison = against(
			[{ path: 'src/a.ts' }, { path: 'src/gone.ts', statements: [1, 4] }],
			[{ path: 'src/a.ts' }],
		);
		expect(comparison.gone).toStrictEqual(['src/gone.ts']);
		expect(comparison.fails).toBe(true);
	});

	it('reports coverage that rises, and does not fail', () => {
		const comparison = against(
			[{ path: 'src/a.ts', statements: [1, 4] }],
			[{ path: 'src/a.ts', statements: [4, 4] }],
		);
		expect(comparison.fails).toBe(false);
		expect(comparison.changed[0]?.moves[0]?.change).toBe(75);
	});

	it('puts the file with the worst fall first', () => {
		const comparison = against(
			[
				{ path: 'src/small.ts', statements: [99, 100] },
				{ path: 'src/large.ts', statements: [90, 100] },
			],
			[
				{ path: 'src/small.ts', statements: [96, 100] },
				{ path: 'src/large.ts', statements: [50, 100] },
			],
		);
		expect(comparison.changed.map((file) => file.path)).toStrictEqual([
			'src/large.ts',
			'src/small.ts',
		]);
		expect(comparison.fails).toBe(true);
	});

	it('names every metric of a file that moved', () => {
		const comparison = against(
			[{ path: 'src/a.ts', statements: [4, 4], branches: [4, 4] }],
			[{ path: 'src/a.ts', statements: [4, 4], branches: [1, 4] }],
		);
		expect(comparison.changed[0]?.moves).toHaveLength(1);
		expect(comparison.changed[0]?.moves[0]?.metric).toBe('branches');
	});
});

describe('the wording of the check', () => {
	function lines(
		before: readonly Sample[],
		after: readonly Sample[],
	): { report: readonly string[]; failure: readonly string[] } {
		const report = reportOf(after);
		const comparison = compare(report, baselineOf(before));
		return {
			report: reportLines(report, comparison),
			failure: failureLines(comparison),
		};
	}

	it('states the numbers of the run, the grace, and each file', () => {
		const steady = [{ path: 'src/a.ts', statements: [3, 4] as Pair }];
		const said = lines(steady, steady).report.join('\n');
		expect(said).toContain('3 of 4 statements (75%)');
		expect(said).toContain('the grace is 2 percentage points');
		expect(said).toContain('src/a.ts  statements 3 of 4 (75%)');
		expect(said).toContain('no file moved against its floor');
	});

	it('gives the counts of the floor and the counts of the run', () => {
		// The three consistency rules of the baseline accept an edit that
		// moves counts from one file to another. The baseline then holds a
		// floor with counts that the run does not report. The report gives
		// both pairs of counts, and not the percentages alone.
		const said = lines(
			[
				{ path: 'src/a.ts', statements: [20, 50] },
				{ path: 'src/b.ts', statements: [4, 4] },
			],
			[
				{ path: 'src/a.ts', statements: [3, 4] },
				{ path: 'src/b.ts', statements: [4, 4] },
			],
		).report.join('\n');
		expect(said).toContain('src/a.ts  statements 3 of 4 (75%)');
		expect(said).toContain(
			'src/a.ts  statements  from 20 of 50 (40%) to 3 of 4 (75%)  35 percentage points more',
		);
	});

	it('says nothing about a failure when nothing failed', () => {
		const steady = [{ path: 'src/a.ts' }];
		expect(lines(steady, steady).failure).toStrictEqual([]);
	});

	it('names the metric that fell, and the command that writes the file', () => {
		const said = lines(
			[{ path: 'src/a.ts', statements: [98, 100] }],
			[{ path: 'src/a.ts', statements: [90, 100] }],
		).failure.join('\n');
		expect(said).toContain(
			'the statements of src/a.ts fell from 98 of 100 (98%) to 90 of 100 (90%). The fall of 8 percentage points goes past the grace of 2 percentage points.',
		);
		expect(said).toContain(
			'node scripts/coverage-ratchet.mjs --write-baseline',
		);
	});

	it('names the file that the run does not report', () => {
		const said = lines(
			[{ path: 'src/a.ts' }, { path: 'src/gone.ts' }],
			[{ path: 'src/a.ts' }],
		).failure.join('\n');
		expect(said).toContain(
			'the run does not report src/gone.ts, and the baseline holds a floor for that file',
		);
	});

	it('names a file that the baseline does not hold, in both parts', () => {
		const said = lines(
			[{ path: 'src/a.ts' }],
			[{ path: 'src/a.ts' }, { path: 'src/new.ts', statements: [0, 4] }],
		);
		expect(said.report.join('\n')).toContain(
			'the baseline does not hold this file',
		);
		expect(said.failure.join('\n')).toContain(
			'the run reports src/new.ts, and the baseline holds no floor for that file',
		);
	});

	it('does not assume a deletion when the run also reports a new path', () => {
		// A change that moves a file makes both lines, and the wording of
		// the failure states what this run reports.
		const said = lines(
			[{ path: 'src/a.ts' }, { path: 'src/old.ts', statements: [1, 4] }],
			[{ path: 'src/a.ts' }, { path: 'src/new.ts', statements: [1, 4] }],
		).failure.join('\n');
		expect(said).toContain(
			'the run also reports 1 file that the baseline does not hold. A change that moves a file makes both of these lines.',
		);
		expect(said).toContain(
			'a change that deletes a file or moves a file writes the baseline in that same change.',
		);
		expect(said).not.toContain('the run reports no file');
	});

	it('says that nothing arrived when only a file left the report', () => {
		const said = lines(
			[{ path: 'src/a.ts' }, { path: 'src/old.ts', statements: [1, 4] }],
			[{ path: 'src/a.ts' }],
		).failure.join('\n');
		expect(said).toContain(
			'the run reports no file that the baseline does not hold',
		);
		expect(said).not.toContain('A change that moves a file makes both');
	});

	it('agrees in number when one file holds a statement', () => {
		const steady = [
			{ path: 'src/a.ts', statements: [3, 4] as Pair },
			{ path: 'src/b.ts' },
		];
		const said = lines(steady, steady).report.join('\n');
		expect(said).toContain('the run reports 2 files, and 1 of them holds');
		expect(said).toContain('the other file holds no statement');
	});
});

describe('the check as a process', () => {
	/** One directory that all the cases share. */
	let directory = '';

	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), 'davenport-coverage-'));
		mkdirSync(join(directory, 'coverage'));
	});

	afterAll(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	/** Writes a coverage summary, and gives back the path of the file. */
	function summary(name: string, samples: readonly Sample[]): string {
		const path = join(directory, 'coverage', `${name}-summary.json`);
		writeFileSync(path, summaryText(samples, directory));
		return path;
	}

	/** Writes a baseline, and gives back the path of the file. */
	function record(name: string, samples: readonly Sample[]): string {
		const path = join(directory, `${name}-baseline.json`);
		writeFileSync(
			path,
			JSON.stringify(
				recordOf(
					taken(
						readSummary(summaryText(samples, directory), directory),
					),
				),
			),
		);
		return path;
	}

	/** Runs the check with these arguments. */
	function run(...argv: readonly string[]): {
		status: number | null;
		output: string;
	} {
		const result = spawnSync(process.execPath, [SCRIPT, ...argv], {
			encoding: 'utf8',
		});
		return { status: result.status, output: result.stdout + result.stderr };
	}

	it('writes a baseline that the check then accepts', () => {
		const path = join(directory, 'steady-baseline.json');
		const written = run(
			'--write-baseline',
			summary('steady', [{ path: 'src/a.ts', statements: [3, 4] }]),
			path,
		);
		expect(written.status).toBe(0);
		expect(written.output).toContain('wrote the baseline');
		const again = run(
			summary('steady', [{ path: 'src/a.ts', statements: [3, 4] }]),
			path,
		);
		expect(again.status).toBe(0);
		expect(again.output).toContain('no file moved against its floor');
		expect(again.output).toContain('src/a.ts  statements 3 of 4 (75%)');
	});

	it('fails when the summary is absent, and says to run the coverage', () => {
		const result = run(join(directory, 'coverage', 'no-such.json'));
		expect(result.status).toBe(1);
		expect(result.output).toContain('cannot read the coverage summary');
		expect(result.output).toContain('npm run coverage');
	});

	it('fails when the baseline is absent, and writes no baseline', () => {
		const absent = join(directory, 'no-such-baseline.json');
		const result = run(summary('lonely', [{ path: 'src/a.ts' }]), absent);
		expect(result.status).toBe(1);
		expect(result.output).toContain('cannot read the coverage baseline');
		expect(result.output).toContain('--write-baseline');
		expect(existsSync(absent)).toBe(false);
	});

	it('passes on a fall that stays inside the grace', () => {
		const result = run(
			summary('creep', [{ path: 'src/a.ts', statements: [97, 100] }]),
			record('creep', [{ path: 'src/a.ts', statements: [98, 100] }]),
		);
		expect(result.status).toBe(0);
		expect(result.output).toContain('1 percentage point less');
	});

	it('fails on a fall past the grace, and names the file', () => {
		const result = run(
			summary('drop', [{ path: 'src/a.ts', statements: [50, 100] }]),
			record('drop', [{ path: 'src/a.ts', statements: [98, 100] }]),
		);
		expect(result.status).toBe(1);
		expect(result.output).toContain(
			'the statements of src/a.ts fell from 98 of 100 (98%) to 50 of 100 (50%)',
		);
	});

	it('fails when the run stops reporting a file of the baseline', () => {
		const result = run(
			summary('lost', [{ path: 'src/a.ts' }]),
			record('lost', [{ path: 'src/a.ts' }, { path: 'src/gone.ts' }]),
		);
		expect(result.status).toBe(1);
		expect(result.output).toContain('the run does not report src/gone.ts');
	});

	it('fails on a new file that the tests do not reach', () => {
		const result = run(
			summary('arrival', [
				{ path: 'src/a.ts', statements: [4, 4] },
				{
					path: 'src/engine.ts',
					statements: [0, 300],
					branches: [0, 120],
					functions: [0, 40],
					lines: [0, 300],
				},
			]),
			record('arrival', [{ path: 'src/a.ts', statements: [4, 4] }]),
		);
		expect(result.status).toBe(1);
		expect(result.output).toContain(
			'the run reports src/engine.ts, and the baseline holds no floor for that file',
		);
		// No file that the baseline holds moved. The arrival is the whole
		// of the fall, and the first rule of the check cannot see it.
		expect(result.output).toContain('no file moved against its floor');
	});

	it('fails on a baseline that drops one file and keeps its sums true', () => {
		// The three consistency rules accept this baseline: the entry of
		// src/a.ts is gone, and the counts of that file left the whole run
		// with it. That file then has no floor. The third rule of the
		// check refuses the run, and no rule of the reader does.
		const dropped = record('dropped', [
			{ path: 'src/kept.ts', statements: [2, 2] },
		]);
		const result = run(
			summary('dropped', [
				{ path: 'src/a.ts', statements: [3, 4] },
				{ path: 'src/kept.ts', statements: [2, 2] },
			]),
			dropped,
		);
		expect(result.status).toBe(1);
		expect(result.output).not.toContain('add up to');
		expect(result.output).toContain(
			'the run reports src/a.ts, and the baseline holds no floor for that file',
		);
	});

	it('passes on coverage that rises, and moves no baseline', () => {
		const path = record('rise', [{ path: 'src/a.ts', statements: [1, 4] }]);
		const before = readFileSync(path, 'utf8');
		const result = run(
			summary('rise', [{ path: 'src/a.ts', statements: [4, 4] }]),
			path,
		);
		expect(result.status).toBe(0);
		expect(result.output).toContain('75 percentage points more');
		expect(readFileSync(path, 'utf8')).toBe(before);
	});

	it.each([
		[
			'a percentage that its counts do not give',
			(count: Record<string, number>) => {
				count.pct = 10;
			},
			'gives the statements the percentage 10',
		],
		[
			'a count that the whole run does not hold',
			(count: Record<string, number>) => {
				count.covered = 1;
				count.pct = 25;
			},
			'and its files add up to',
		],
	])('fails on a baseline with %s', (name, change, said) => {
		const key = name.split(' ')[1] ?? 'edit';
		const path = join(directory, `${key}-tampered.json`);
		const written = JSON.parse(
			readFileSync(
				record(key, [{ path: 'src/a.ts', statements: [3, 4] }]),
				'utf8',
			),
		) as { files: { statements: Record<string, number> }[] };
		const first = written.files[0];
		expect(first).toBeDefined();
		if (first !== undefined) {
			change(first.statements);
		}
		writeFileSync(path, JSON.stringify(written));
		const result = run(
			summary(key, [{ path: 'src/a.ts', statements: [3, 4] }]),
			path,
		);
		expect(result.status).toBe(1);
		expect(result.output).toContain(said);
	});
});

/** The counts that a case gives one metric. */
function pair(count: Count): Pair {
	return [count.covered, count.total];
}

describe('the committed baseline against the suite that it records', () => {
	it('holds a floor for every file that the coverage run reports', () => {
		const record = taken(readBaseline(readFileSync(COMMITTED, 'utf8')));
		const rebuilt = baselineOf(
			record.files.map((file) => ({
				path: file.path,
				statements: pair(file.counts.statements),
				branches: pair(file.counts.branches),
				functions: pair(file.counts.functions),
				lines: pair(file.counts.lines),
			})),
		);
		expect(compare(rebuilt, record).fails).toBe(false);
		expect(compare(rebuilt, record).changed).toStrictEqual([]);
	});
});
