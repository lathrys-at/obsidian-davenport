/**
 * The decisions behind the mutation ratchet:
 *
 * - what the check reads out of the JSON report of a mutation run;
 * - which mutants the score counts, and which mutants it does not count;
 * - which report says so little that the check refuses to score it;
 * - whether the number in a baseline is a score at all;
 * - how the score of a run compares with the floor, and that a fall of one
 *   hundredth of a point fails;
 * - what the comparison says, and the wording that the check prints;
 * - what the check does when the report or the baseline is absent.
 *
 * The committed baseline is the floor that this repository holds. One case
 * reads that file, and not a copy of it. A copy would drift, and then the
 * case would prove the copy.
 *
 * The script itself only finds the files, reads them, and prints. A run can
 * end in several ways, and these cases exercise each way as a process. The
 * interface includes the exit status, and not only the words that the run
 * prints.
 */

import { spawnSync } from 'node:child_process';
import {
	existsSync,
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
	Reading,
	Report,
	Status,
	Tally,
} from '../scripts/mutation-ratchet-core';
import vitestConfig from '../vitest.config';
import {
	MUTATED,
	compare,
	countedOf,
	detectedOf,
	excludedOf,
	mutantsOf,
	readBaseline,
	readReport,
	recordOf,
	scoreOf,
	undetectedOf,
	untestedOf,
} from '../scripts/mutation-ratchet-core';
import { failureLines, reportLines } from '../scripts/mutation-ratchet-text';

const SCRIPT = fileURLToPath(
	new URL('../scripts/mutation-ratchet.mjs', import.meta.url),
);
const COMMITTED = fileURLToPath(
	new URL('../mutation-baseline.json', import.meta.url),
);

/** One file of a run, as a case describes it. */
interface Sample {
	readonly path: string;
	readonly killed?: number;
	readonly timeout?: number;
	readonly survived?: number;
	readonly noCoverage?: number;
	readonly compileError?: number;
	readonly runtimeError?: number;
	readonly ignored?: number;
}

/** The status of the report for each count of a sample. */
const COUNTS: readonly (readonly [keyof Sample, Status])[] = [
	['killed', 'Killed'],
	['timeout', 'Timeout'],
	['survived', 'Survived'],
	['noCoverage', 'NoCoverage'],
	['compileError', 'CompileError'],
	['runtimeError', 'RuntimeError'],
	['ignored', 'Ignored'],
];

/** The mutants of one file, in the shape that the JSON report holds. */
function mutantsJson(sample: Sample): Record<string, unknown>[] {
	const mutants: Record<string, unknown>[] = [];
	for (const [key, status] of COUNTS) {
		const held = sample[key];
		const many = typeof held === 'number' ? held : 0;
		for (let index = 0; index < many; index += 1) {
			mutants.push({
				id: String(mutants.length),
				mutatorName: 'EqualityOperator',
				replacement: '<=',
				status,
				location: {
					start: { line: mutants.length + 1, column: 1 },
					end: { line: mutants.length + 1, column: 9 },
				},
			});
		}
	}
	return mutants;
}

/** A mutation report in the shape that the JSON reporter writes. */
function reportText(samples: readonly Sample[]): string {
	const files: Record<string, unknown> = {};
	for (const sample of samples) {
		files[sample.path] = {
			language: 'typescript',
			source: 'export const value = 1;\n',
			mutants: mutantsJson(sample),
		};
	}
	return JSON.stringify({ schemaVersion: '1.0', files });
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
	return taken(readReport(reportText(samples)));
}

/** The tally of one file of a report. */
function tallyOf(report: Report, path: string): Tally {
	const file = report.files.find((held) => held.path === path);
	if (file === undefined) {
		throw new Error(`the report holds no file ${path}`);
	}
	return file.tally;
}

/** A baseline that holds this score. */
function floorOf(score: number): Baseline {
	return taken(readBaseline(JSON.stringify({ score })));
}

describe('the mutation report reader', () => {
	it('reads the mutants of each file and of the whole run', () => {
		const report = reportOf([
			{ path: 'src/a.ts', killed: 3, survived: 1 },
			{ path: 'src/b.ts', killed: 2, timeout: 1, noCoverage: 4 },
		]);
		expect(report.files.map((file) => file.path)).toStrictEqual([
			'src/a.ts',
			'src/b.ts',
		]);
		expect(mutantsOf(report.total)).toBe(11);
		expect(detectedOf(report.total)).toBe(6);
		expect(undetectedOf(report.total)).toBe(5);
		expect(tallyOf(report, 'src/b.ts').NoCoverage).toBe(4);
	});

	it('keeps the name that the report gives each file', () => {
		const report = reportOf([{ path: 'src/core/ics/fold.ts', killed: 1 }]);
		expect(report.files[0]?.path).toBe('src/core/ics/fold.ts');
	});

	it('collects each mutant that the tests do not detect', () => {
		const report = reportOf([
			{ path: 'src/a.ts', killed: 1, survived: 1, noCoverage: 1 },
		]);
		expect(report.files[0]?.survivors).toStrictEqual([
			{ mutator: 'EqualityOperator', line: 2, status: 'Survived' },
			{ mutator: 'EqualityOperator', line: 3, status: 'NoCoverage' },
		]);
	});

	it('collects no mutant that a test killed', () => {
		const report = reportOf([{ path: 'src/a.ts', killed: 2, timeout: 1 }]);
		expect(report.files[0]?.survivors).toStrictEqual([]);
	});

	it('refuses a report that is not JSON', () => {
		expect(refusal(readReport('{'))).toContain(
			'the mutation report is not JSON',
		);
	});

	it('refuses a report that gives no files', () => {
		expect(refusal(readReport('{"schemaVersion":"1.0"}'))).toContain(
			'gives no files',
		);
	});

	it('refuses a report that holds no file', () => {
		expect(refusal(readReport('{"files":{}}'))).toContain('holds no file');
	});

	it('refuses a report that holds no mutant', () => {
		expect(
			refusal(readReport(reportText([{ path: 'src/a.ts' }]))),
		).toContain('holds no mutant');
	});

	it('refuses a status that the check does not know', () => {
		const written = JSON.parse(
			reportText([{ path: 'src/a.ts', killed: 1 }]),
		) as { files: Record<string, { mutants: { status: string }[] }> };
		const mutant = written.files['src/a.ts']?.mutants[0];
		expect(mutant).toBeDefined();
		if (mutant !== undefined) {
			mutant.status = 'Undecided';
		}
		expect(refusal(readReport(JSON.stringify(written)))).toContain(
			'the status Undecided, and this check knows no such status',
		);
	});

	it('refuses a mutant that the run did not reach', () => {
		const written = JSON.parse(
			reportText([{ path: 'src/a.ts', killed: 1 }]),
		) as { files: Record<string, { mutants: { status: string }[] }> };
		const mutant = written.files['src/a.ts']?.mutants[0];
		expect(mutant).toBeDefined();
		if (mutant !== undefined) {
			mutant.status = 'Pending';
		}
		expect(refusal(readReport(JSON.stringify(written)))).toContain(
			'holds a mutant that the run did not reach',
		);
	});
});

/**
 * The score divides by the mutants that it counts. A mutant that leaves that
 * division lifts the score, so a run that measures less scores more. These
 * cases hold the two rules that stop a run from scoring on nothing. The two
 * constructions are the two shapes that a degraded run takes: every mutant
 * fails to compile, and the mutants that the tests do not detect break the
 * run of the tests instead.
 */
describe('a run that measured too little to score', () => {
	/** A report of the shape of the committed run, with these counts. */
	function whole(counts: Omit<Sample, 'path'>): string {
		return reportText([{ path: 'src/core/ics/values.ts', ...counts }]);
	}

	it('refuses a run whose every mutant failed to compile', () => {
		const reason = refusal(readReport(whole({ compileError: 1245 })));
		expect(reason).toContain(
			'holds 1245 mutants that the run could not test',
		);
		expect(reason).toContain('1245 that did not compile');
	});

	it('refuses a run whose undetected mutants broke the tests', () => {
		const reason = refusal(
			readReport(whole({ killed: 1002, runtimeError: 243 })),
		);
		expect(reason).toContain(
			'holds 243 mutants that the run could not test',
		);
		expect(reason).toContain('243 that broke the run of the tests');
	});

	it('refuses one mutant that the run could not test, and accepts none', () => {
		expect(
			refusal(readReport(whole({ killed: 99, compileError: 1 }))),
		).toContain('holds 1 mutant that the run could not test');
		expect(
			refusal(readReport(whole({ killed: 99, runtimeError: 1 }))),
		).toContain('holds 1 mutant that the run could not test');
		const clean = taken(readReport(whole({ killed: 99, survived: 1 })));
		expect(untestedOf(clean.total)).toBe(0);
		expect(scoreOf(clean.total)).toBe(99);
	});

	it('refuses a run whose mutants a comment takes out of the run', () => {
		const reason = refusal(readReport(whole({ ignored: 1245 })));
		expect(reason).toContain(
			'holds 1245 mutants, and the score counts none',
		);
	});

	it('accepts a run that counts one mutant beside the excluded ones', () => {
		const report = taken(readReport(whole({ killed: 1, ignored: 1244 })));
		expect(countedOf(report.total)).toBe(1);
		expect(excludedOf(report.total)).toBe(1244);
		expect(scoreOf(report.total)).toBe(100);
	});
});

describe('the score of a run', () => {
	it('gives a file that counts no mutant 100 percent', () => {
		// A comment at the site takes each mutant of the file out of the run.
		// The whole run still counts a mutant, so the reader accepts it.
		const report = reportOf([
			{ path: 'src/a.ts', ignored: 3 },
			{ path: 'src/b.ts', killed: 1 },
		]);
		expect(countedOf(tallyOf(report, 'src/a.ts'))).toBe(0);
		expect(scoreOf(tallyOf(report, 'src/a.ts'))).toBe(100);
	});

	it('does not count a mutant that a comment takes out of the run', () => {
		const report = reportOf([
			{ path: 'src/a.ts', killed: 1, survived: 1, ignored: 5 },
		]);
		expect(excludedOf(report.total)).toBe(5);
		expect(countedOf(report.total)).toBe(2);
		expect(scoreOf(report.total)).toBe(50);
	});

	it('counts a mutant that ran past the time limit as detected', () => {
		const report = reportOf([
			{ path: 'src/a.ts', timeout: 1, survived: 1 },
		]);
		expect(detectedOf(report.total)).toBe(1);
		expect(scoreOf(report.total)).toBe(50);
	});

	it('drops the places after the second one, and never rounds up', () => {
		const report = reportOf([{ path: 'src/a.ts', killed: 2, survived: 1 }]);
		expect(scoreOf(report.total)).toBe(66.66);
	});

	it('gives a whole percentage no loss from binary arithmetic', () => {
		const report = reportOf([
			{ path: 'src/a.ts', killed: 57, survived: 43 },
		]);
		expect(scoreOf(report.total)).toBe(57);
	});
});

describe('the baseline reader', () => {
	it('reads the baseline that this repository commits', () => {
		const baseline = taken(readBaseline(readFileSync(COMMITTED, 'utf8')));
		expect(baseline.score).toBeGreaterThan(0);
		expect(baseline.score).toBeLessThanOrEqual(100);
	});

	it('holds the committed baseline in the shape that the check writes', () => {
		const baseline = taken(readBaseline(readFileSync(COMMITTED, 'utf8')));
		expect(readFileSync(COMMITTED, 'utf8')).toBe(
			`${JSON.stringify({ score: baseline.score }, undefined, '\t')}\n`,
		);
	});

	it('reads back the record that the check writes', () => {
		const report = reportOf([{ path: 'src/a.ts', killed: 3, survived: 1 }]);
		const record = recordOf(report);
		expect(record).toStrictEqual({ score: 75 });
		expect(taken(readBaseline(JSON.stringify(record))).score).toBe(75);
	});

	it('refuses a baseline that is not a JSON object', () => {
		expect(refusal(readBaseline('80.48'))).toContain(
			'is not a JSON object',
		);
	});

	it('refuses a baseline that gives no score', () => {
		expect(refusal(readBaseline('{}'))).toContain('gives no score');
	});

	it('refuses a score that is not a number', () => {
		expect(refusal(readBaseline('{"score":"80.48"}'))).toContain(
			'gives no score',
		);
	});

	it.each([
		['below zero', -1],
		['above one hundred', 101],
	])('refuses a score %s', (name, score) => {
		expect(refusal(readBaseline(JSON.stringify({ score })))).toContain(
			'a score is a number from 0 to 100',
		);
	});

	it('refuses a baseline that holds a key beside the score', () => {
		expect(refusal(readBaseline('{"score":80.48,"grace":2}'))).toContain(
			'holds the key grace',
		);
	});
});

describe('the comparison against the floor', () => {
	const run = reportOf([{ path: 'src/a.ts', killed: 8048, survived: 1952 }]);

	it('reports a run equal to the floor as no change', () => {
		const comparison = compare(run, floorOf(80.48));
		expect(comparison.score).toBe(80.48);
		expect(comparison.change).toBe(0);
		expect(comparison.fails).toBe(false);
	});

	it('accepts a score above the floor', () => {
		const comparison = compare(run, floorOf(70));
		expect(comparison.change).toBe(10.48);
		expect(comparison.fails).toBe(false);
	});

	it('fails on a fall of one hundredth of a point', () => {
		const comparison = compare(run, floorOf(80.49));
		expect(comparison.change).toBe(-0.01);
		expect(comparison.fails).toBe(true);
	});

	it('names each file that holds a mutant the tests do not detect', () => {
		const comparison = compare(
			reportOf([
				{ path: 'src/high.ts', killed: 9, survived: 1 },
				{ path: 'src/whole.ts', killed: 4 },
				{ path: 'src/low.ts', killed: 1, noCoverage: 3 },
			]),
			floorOf(0),
		);
		expect(comparison.weak.map((file) => file.path)).toStrictEqual([
			'src/low.ts',
			'src/high.ts',
		]);
	});
});

describe('the wording of the check', () => {
	/** The lines that a run of these files prints against this floor. */
	function lines(
		samples: readonly Sample[],
		floor: number,
	): { report: readonly string[]; failure: readonly string[] } {
		const report = reportOf(samples);
		const comparison = compare(report, floorOf(floor));
		return {
			report: reportLines(report, comparison),
			failure: failureLines(comparison),
		};
	}

	it('states the mutants of the run, the score, and the floor', () => {
		const said = lines(
			[{ path: 'src/a.ts', killed: 3, timeout: 1, survived: 1 }],
			80,
		).report.join('\n');
		expect(said).toContain(
			'the run holds 5 mutants: 3 that a test killed, 1 that ran past the time limit, 1 that survived and 0 that no test ran',
		);
		expect(said).toContain(
			'the score is 80.00% (4 of 5), and the floor is 80.00%',
		);
		expect(said).toContain('The score is equal to the floor.');
	});

	it('names each mutant that a comment takes out of the run', () => {
		const said = lines(
			[{ path: 'src/a.ts', killed: 1, ignored: 2 }],
			100,
		).report.join('\n');
		expect(said).toContain('3 mutants:');
		expect(said).toContain('2 that a comment takes out of the run');
	});

	it('says how far the score is from the floor', () => {
		const above = lines([{ path: 'src/a.ts', killed: 3, survived: 1 }], 50);
		expect(above.report.join('\n')).toContain(
			'The score is 25 percentage points more than the floor.',
		);
		const below = lines([{ path: 'src/a.ts', killed: 3, survived: 1 }], 76);
		expect(below.failure.join('\n')).toContain('The fall is 1 percentage');
		expect(below.report.join('\n')).toContain(
			'The score is 1 percentage point less than the floor.',
		);
	});

	it('states the rounding rule beside the table of the files', () => {
		const said = lines([{ path: 'src/a.ts', killed: 2 }], 100).report.join(
			'\n',
		);
		expect(said).toContain(
			'it removes the decimal places after the second one',
		);
		expect(said).toContain('the last digit of a row can differ');
	});

	it('gives the line and the rule of each mutant that survives', () => {
		const said = lines(
			[{ path: 'src/a.ts', killed: 1, survived: 1, noCoverage: 1 }],
			0,
		).report.join('\n');
		expect(said).toContain('src/a.ts  33.33% (1 of 3)  1 survived and 1');
		expect(said).toContain('line 2  EqualityOperator  it survived');
		expect(said).toContain('line 3  EqualityOperator  no test ran it');
	});

	it('names five mutants of a file, and counts the rest', () => {
		const said = lines(
			[{ path: 'src/a.ts', killed: 1, survived: 8 }],
			0,
		).report.join('\n');
		expect(said).toContain('line 6  EqualityOperator  it survived');
		expect(said).not.toContain('line 7  EqualityOperator  it survived');
		expect(said).toContain('and 3 mutants more');
	});

	it('says that the tests detect every mutant when none survives', () => {
		const said = lines([{ path: 'src/a.ts', killed: 2 }], 100).report.join(
			'\n',
		);
		expect(said).toContain(
			'the tests detect every mutant that the score counts',
		);
	});

	it('says nothing about a failure when nothing failed', () => {
		expect(
			lines([{ path: 'src/a.ts', killed: 2 }], 100).failure,
		).toStrictEqual([]);
	});

	it('names the score, the floor, the fall, and the report', () => {
		const said = lines(
			[{ path: 'src/a.ts', killed: 3, survived: 1 }],
			90,
		).failure.join('\n');
		expect(said).toContain(
			'the score fell to 75.00%, and the floor is 90.00%. The fall is 15 percentage points.',
		);
		expect(said).toContain('reports/mutation/mutation.html');
		expect(said).toContain(
			'node scripts/mutation-ratchet.mjs --write-baseline',
		);
	});

	/**
	 * A person who reads a failed run reads the error stream. The list of the
	 * files therefore belongs in the failure, and the report of a run that
	 * fails leaves the list out. One log then holds one copy of the list.
	 */
	it('names each weak file in the failure, and one time', () => {
		const said = lines(
			[
				{ path: 'src/high.ts', killed: 9, survived: 1 },
				{ path: 'src/low.ts', killed: 1, noCoverage: 3 },
			],
			99,
		);
		const failure = said.failure.join('\n');
		expect(failure).toContain(
			'the tests do not detect 4 mutants in 2 files. The list starts with the file that has the lowest score.',
		);
		expect(failure).toContain('src/low.ts  25.00% (1 of 4)');
		expect(failure).toContain('line 2  EqualityOperator  no test ran it');
		expect(failure.indexOf('src/low.ts  25.00% (1 of 4)')).toBeLessThan(
			failure.indexOf('src/high.ts  90.00% (9 of 10)'),
		);
		expect(failure).toContain('it does not say which file made the fall');
		// The report keeps its table of every mutated file. The list of the
		// weak files, with the header and the mutants under each file, is
		// what moves to the failure.
		const rows = said.report.filter(
			(line) =>
				line.includes('the tests do not detect 4 mutants') ||
				line.includes('EqualityOperator'),
		);
		expect(rows).toStrictEqual([]);
		expect(said.report.join('\n')).toContain('src/low.ts  25.00% (1 of 4)');
	});

	it('keeps the list of weak files in the report when the run passes', () => {
		const said = lines([{ path: 'src/a.ts', killed: 9, survived: 1 }], 90);
		expect(said.failure).toStrictEqual([]);
		expect(said.report.join('\n')).toContain(
			'the tests do not detect 1 mutant in 1 file',
		);
	});
});

describe('the check as a process', () => {
	/** One directory that all the cases share. */
	let directory = '';

	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), 'davenport-mutation-'));
	});

	afterAll(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	/** Writes a mutation report, and gives back the path of the file. */
	function report(name: string, samples: readonly Sample[]): string {
		const path = join(directory, `${name}-report.json`);
		writeFileSync(path, reportText(samples));
		return path;
	}

	/** Writes a baseline, and gives back the path of the file. */
	function record(name: string, score: number): string {
		const path = join(directory, `${name}-baseline.json`);
		writeFileSync(path, JSON.stringify({ score }));
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
		const samples = [{ path: 'src/a.ts', killed: 3, survived: 1 }];
		const written = run(
			'--write-baseline',
			report('steady', samples),
			path,
		);
		expect(written.status).toBe(0);
		expect(written.output).toContain('wrote the baseline');
		expect(readFileSync(path, 'utf8')).toBe('{\n\t"score": 75\n}\n');
		const again = run(report('steady', samples), path);
		expect(again.status).toBe(0);
		expect(again.output).toContain('the score is 75.00% (3 of 4)');
		expect(again.output).toContain('The score is equal to the floor.');
	});

	it('fails when the report is absent, and says to run the mutation', () => {
		const result = run(join(directory, 'no-such-report.json'));
		expect(result.status).toBe(1);
		expect(result.output).toContain('cannot read the mutation report');
		expect(result.output).toContain('npm run mutation');
	});

	it('fails when the baseline is absent, and writes no baseline', () => {
		const absent = join(directory, 'no-such-baseline.json');
		const result = run(
			report('lonely', [{ path: 'src/a.ts', killed: 1 }]),
			absent,
		);
		expect(result.status).toBe(1);
		expect(result.output).toContain('cannot read the mutation baseline');
		expect(result.output).toContain('--write-baseline');
		expect(existsSync(absent)).toBe(false);
	});

	it('passes on a score above the floor, and moves no baseline', () => {
		const path = record('rise', 50);
		const before = readFileSync(path, 'utf8');
		const result = run(
			report('rise', [{ path: 'src/a.ts', killed: 3, survived: 1 }]),
			path,
		);
		expect(result.status).toBe(0);
		expect(result.output).toContain(
			'The score is 25 percentage points more than the floor.',
		);
		expect(readFileSync(path, 'utf8')).toBe(before);
	});

	it('fails on a fall of one hundredth of a point', () => {
		const result = run(
			report('creep', [{ path: 'src/a.ts', killed: 3, survived: 1 }]),
			record('creep', 75.01),
		);
		expect(result.status).toBe(1);
		expect(result.output).toContain(
			'the score fell to 75.00%, and the floor is 75.01%',
		);
	});

	it('fails on a fall, and names the file that holds the survivors', () => {
		const result = run(
			report('drop', [
				{ path: 'src/kept.ts', killed: 4 },
				{ path: 'src/weak.ts', killed: 1, survived: 3 },
			]),
			record('drop', 90),
		);
		expect(result.status).toBe(1);
		expect(result.output).toContain(
			'src/weak.ts  25.00% (1 of 4)  3 survived',
		);
		expect(result.output).toContain('The fall is 27.5 percentage points.');
	});

	it.each([
		[
			'holds a key beside the score',
			'{"score":75,"grace":2}',
			'the key grace',
		],
		[
			'gives a score above one hundred',
			'{"score":101}',
			'a score is a number from 0 to 100',
		],
		['gives no number', '{"score":"75"}', 'gives no score'],
		['is not an object', '[75]', 'is not a JSON object'],
	])('fails on a baseline that %s', (name, text, said) => {
		const path = join(directory, `${name.replace(/ /g, '-')}.json`);
		writeFileSync(path, text);
		const result = run(
			report('tamper', [{ path: 'src/a.ts', killed: 3, survived: 1 }]),
			path,
		);
		expect(result.status).toBe(1);
		expect(result.output).toContain(said);
	});

	it('fails on a report that holds a status it does not know', () => {
		const path = join(directory, 'unknown-report.json');
		writeFileSync(
			path,
			JSON.stringify({
				files: {
					'src/a.ts': { mutants: [{ id: '0', status: 'Undecided' }] },
				},
			}),
		);
		const result = run(path, record('unknown', 50));
		expect(result.status).toBe(1);
		expect(result.output).toContain('knows no such status');
	});

	/**
	 * These two cases hold the numbers of the committed run. The first is a
	 * run whose sandbox stopped compiling. The second is a run where the
	 * mutants that the tests do not detect broke the run of the tests instead.
	 * Both scored 100 percent before, and both passed the floor of 80.48.
	 */
	it('fails on a run whose every mutant failed to compile', () => {
		const result = run(
			report('vacuous', [
				{ path: 'src/core/ics/values.ts', compileError: 1245 },
			]),
			record('vacuous', 80.48),
		);
		expect(result.status).toBe(1);
		expect(result.output).toContain(
			'holds 1245 mutants that the run could not test',
		);
		expect(result.output).not.toContain('the score is 100');
	});

	it('fails on a run whose undetected mutants broke the tests', () => {
		const result = run(
			report('broken', [
				{
					path: 'src/core/ics/values.ts',
					killed: 1002,
					runtimeError: 243,
				},
			]),
			record('broken', 80.48),
		);
		expect(result.status).toBe(1);
		expect(result.output).toContain(
			'holds 243 mutants that the run could not test',
		);
		expect(result.output).not.toContain('the score is 100');
	});

	it('fails on a run whose mutants a comment takes out of the run', () => {
		const result = run(
			report('excluded', [
				{ path: 'src/core/ics/values.ts', ignored: 1245 },
			]),
			record('excluded', 80.48),
		);
		expect(result.status).toBe(1);
		expect(result.output).toContain(
			'holds 1245 mutants, and the score counts none of them',
		);
	});
});

describe('the files that the lane mutates', () => {
	/**
	 * The lane must mutate the files that the coverage instrument reads. A
	 * file outside the coverage selection has no floor for its lines, and a
	 * file outside the mutation selection has no floor for its mutants. The
	 * configuration of the lane reads the same list that this case reads.
	 */
	it('mutates the files that the coverage instrument reads', () => {
		const covered = vitestConfig.test?.coverage?.include;
		const skipped = vitestConfig.test?.coverage?.exclude ?? [];
		expect(covered).toStrictEqual(['src/**/*.ts']);
		expect(skipped).toContain('src/**/*.test.ts');
		expect([...MUTATED]).toStrictEqual([
			...(covered ?? []),
			...['src/**/*.test.ts'].map((pattern) => `!${pattern}`),
		]);
	});

	/**
	 * The case above pins the list. This case pins the configuration to that
	 * list. A `mutate` field written out in the configuration would take the
	 * lane off the list, and the score would then measure the files that the
	 * field names. No other gate reads the configuration file: ESLint ignores
	 * it, and the TypeScript project does not hold it.
	 *
	 * The case reads the configuration the way Stryker reads it. Node imports
	 * the file and prints the value of `mutate`. A comparison of the text of
	 * the file would instead pin the shape of the source, and the formatter
	 * moves that shape.
	 */
	it('gives Stryker the list that this repository pins', () => {
		const url = new URL('../stryker.config.mjs', import.meta.url).href;
		const result = spawnSync(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				`import config from ${JSON.stringify(url)};
				process.stdout.write(JSON.stringify(config.mutate));`,
			],
			{ encoding: 'utf8' },
		);
		expect(result.stderr).toBe('');
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout) as unknown).toStrictEqual([
			...MUTATED,
		]);
	});
});
