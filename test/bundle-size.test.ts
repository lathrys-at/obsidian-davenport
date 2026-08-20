/**
 * The decisions behind the bundle-size check:
 *
 * - what the check reads out of the metafile of a build;
 * - which module gets the bytes of one input;
 * - what the measurement of the built files adds up to;
 * - whether the numbers of a baseline agree with each other;
 * - how much growth past the baseline the check accepts;
 * - which output files the check requires the build to keep making;
 * - which output files the check does not count, and what the report says
 *   about them;
 * - what the comparison says, and the wording that the check prints;
 * - what the check does when the metafile or the baseline is absent.
 *
 * The committed baseline is the record of the build that this repository
 * ships. One case reads that file, and not a copy of it. A copy would drift,
 * and then the case would prove the copy.
 *
 * The script itself only finds the files, measures them, and prints. A run
 * can end in several ways, and these cases exercise each way as a process.
 * The interface includes the exit status, and not only the words that the
 * run prints.
 */

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
	Measurement,
	Metafile,
	Reading,
	Report,
} from '../scripts/bundle-size-core';
import {
	OVERHEAD,
	compare,
	contributorName,
	measure,
	readBaseline,
	readMetafile,
	stepFor,
} from '../scripts/bundle-size-core';
import { failureLines, reportLines } from '../scripts/bundle-size-text';
import { runNode } from './harness/run-node';

const SCRIPT = fileURLToPath(
	new URL('../scripts/bundle-size.mjs', import.meta.url),
);
const COMMITTED = fileURLToPath(
	new URL('../bundle-baseline.json', import.meta.url),
);

/** One output file of a build, as a case describes it. */
interface Output {
	readonly path: string;
	readonly bytes: number;
	readonly entry?: boolean;
	readonly modules?: Record<string, number>;
}

/** A metafile in the shape that esbuild writes. */
function metafileText(outputs: readonly Output[]): string {
	const written: Record<string, unknown> = {};
	for (const output of outputs) {
		const inputs: Record<string, unknown> = {};
		for (const [name, bytes] of Object.entries(output.modules ?? {})) {
			inputs[name] = { bytesInOutput: bytes };
		}
		written[output.path] = {
			bytes: output.bytes,
			inputs,
			...(output.entry === false ? {} : { entryPoint: 'src/main.ts' }),
		};
	}
	return JSON.stringify({ inputs: {}, outputs: written });
}

/** The value of a reading. A refusal ends the case. */
function taken<T>(reading: Reading<T>): T {
	if (!reading.ok) {
		throw new Error(reading.reason);
	}
	return reading.value;
}

/** The metafile that these outputs describe, read back. */
function metafileOf(outputs: readonly Output[]): Metafile {
	return taken(readMetafile(metafileText(outputs)));
}

/** A measurement of an output file. The compressed size is a third. */
function measurementOf(path: string, raw: number): Measurement {
	return { path, raw, compressed: Math.floor(raw / 3) };
}

/** The reason of a refusal. A reading that is not a refusal fails the case. */
function refusal<T>(reading: Reading<T>): string {
	expect(reading.ok).toBe(false);
	return reading.ok ? '' : reading.reason;
}

/** The report of a build that these outputs describe. */
function reportOf(outputs: readonly Output[]): Report {
	return taken(
		measure(
			metafileOf(outputs),
			outputs.map((output) => measurementOf(output.path, output.bytes)),
		),
	);
}

describe('the metafile reader', () => {
	it('reads the size and the modules of the entry file', () => {
		const reading = readMetafile(
			metafileText([
				{
					path: 'main.js',
					bytes: 900,
					modules: { 'src/main.ts': 100 },
				},
			]),
		);
		expect(reading).toStrictEqual({
			ok: true,
			value: {
				outputs: [
					{
						path: 'main.js',
						kind: 'entry',
						bytes: 900,
						modules: [{ name: 'src/main.ts', bytes: 100 }],
					},
				],
				skipped: [],
			},
		});
	});

	it('names an output file without an entry point a chunk', () => {
		const metafile = metafileOf([
			{ path: 'main.js', bytes: 900 },
			{ path: 'chunk-A.js', bytes: 400, entry: false },
		]);
		expect(metafile.outputs.map((output) => output.kind)).toStrictEqual([
			'entry',
			'chunk',
		]);
	});

	it('passes over a source map, because a release carries none', () => {
		const metafile = metafileOf([
			{ path: 'main.js', bytes: 900 },
			{ path: 'main.js.map', bytes: 90_000, entry: false },
		]);
		expect(metafile.outputs.map((output) => output.path)).toStrictEqual([
			'main.js',
		]);
		expect(metafile.skipped).toStrictEqual([
			{ path: 'main.js.map', bytes: 90_000 },
		]);
	});

	it('holds a source map that the metafile gives no size', () => {
		const metafile = taken(
			readMetafile(
				'{"outputs":{"main.js":{"bytes":10,"inputs":{}},"main.js.map":{}}}',
			),
		);
		expect(metafile.outputs.map((output) => output.path)).toStrictEqual([
			'main.js',
		]);
		expect(metafile.skipped).toStrictEqual([
			{ path: 'main.js.map', bytes: undefined },
		]);
	});

	it.each([
		['text that is not JSON', 'not json at all'],
		['a metafile that is not an object', '[]'],
		['a metafile with no outputs object', '{"inputs":{}}'],
		['a metafile that declares no output file', '{"outputs":{}}'],
		[
			'an output with no count of bytes',
			'{"outputs":{"main.js":{"inputs":{}}}}',
		],
		[
			'an output with no inputs object',
			'{"outputs":{"main.js":{"bytes":10}}}',
		],
		[
			'an input with no count of bytes',
			'{"outputs":{"main.js":{"bytes":10,"inputs":{"a.ts":{}}}}}',
		],
	])('refuses %s', (_name, text) => {
		expect(refusal(readMetafile(text))).toContain('metafile');
	});
});

describe('the module that gets the bytes of an input', () => {
	it.each([
		['a file of the plugin', 'src/core/model/event.ts'],
		['a file that the bundler generates', '<runtime>'],
	])('counts %s against its own path', (_name, input) => {
		expect(contributorName(input)).toBe(input);
	});

	it('counts a file under node_modules against its package', () => {
		expect(contributorName('node_modules/ical.js/lib/ical/event.js')).toBe(
			'ical.js',
		);
	});

	it('keeps the scope of a scoped package', () => {
		expect(contributorName('node_modules/@scope/thing/index.js')).toBe(
			'@scope/thing',
		);
	});

	it('names a nested copy for the whole chain of packages', () => {
		expect(
			contributorName('node_modules/a/node_modules/b/lib/index.js'),
		).toBe('a/node_modules/b');
	});

	it('keeps the scope of each package of a chain', () => {
		expect(
			contributorName(
				'node_modules/@one/a/node_modules/@two/b/lib/index.js',
			),
		).toBe('@one/a/node_modules/@two/b');
	});

	it('passes over a directory whose name only ends in node_modules', () => {
		expect(contributorName('src/my_node_modules/thing.ts')).toBe(
			'src/my_node_modules/thing.ts',
		);
	});
});

describe('the measurement of a build', () => {
	it('adds the output files up, and gives each one a line', () => {
		const report = reportOf([
			{ path: 'main.js', bytes: 900, modules: { 'src/main.ts': 100 } },
			{ path: 'chunk-A.js', bytes: 300, entry: false },
		]);
		expect(report.raw).toBe(1200);
		expect(report.compressed).toBe(400);
		expect(report.outputs).toStrictEqual([
			{ path: 'main.js', kind: 'entry', raw: 900, compressed: 300 },
			{ path: 'chunk-A.js', kind: 'chunk', raw: 300, compressed: 100 },
		]);
	});

	it('adds the bytes of one package over every output file', () => {
		const report = reportOf([
			{
				path: 'main.js',
				bytes: 900,
				modules: { 'node_modules/ical.js/a.js': 300 },
			},
			{
				path: 'chunk-A.js',
				bytes: 300,
				entry: false,
				modules: { 'node_modules/ical.js/b.js': 200 },
			},
		]);
		expect(report.modules).toStrictEqual([{ name: 'ical.js', bytes: 500 }]);
	});

	it('gives a package that the build holds two times two rows', () => {
		const report = reportOf([
			{
				path: 'main.js',
				bytes: 20_000,
				modules: {
					'node_modules/a/node_modules/b/lib/index.js': 5000,
					'node_modules/b/lib/index.js': 7000,
				},
			},
		]);
		expect(report.modules).toStrictEqual([
			{ name: 'b', bytes: 7000 },
			{ name: 'a/node_modules/b', bytes: 5000 },
		]);
	});

	it('sorts the modules by size, and ties by name', () => {
		const report = reportOf([
			{
				path: 'main.js',
				bytes: 900,
				modules: { 'b.ts': 100, 'c.ts': 300, 'a.ts': 100 },
			},
		]);
		expect(report.modules.map((module) => module.name)).toStrictEqual([
			'c.ts',
			'a.ts',
			'b.ts',
		]);
	});

	it('counts no byte of a source map in any total', () => {
		const built = metafileOf([
			{ path: 'main.js', bytes: 900, modules: { 'src/main.ts': 100 } },
			{ path: 'main.js.map', bytes: 90_000, entry: false },
		]);
		const report = taken(measure(built, [measurementOf('main.js', 900)]));
		expect(report.raw).toBe(900);
		expect(report.compressed).toBe(300);
		expect(report.outputs.map((output) => output.path)).toStrictEqual([
			'main.js',
		]);
	});

	it('gives the bytes that no module holds to the overhead', () => {
		const report = reportOf([
			{ path: 'main.js', bytes: 900, modules: { 'src/main.ts': 100 } },
		]);
		expect(report.overhead).toBe(800);
	});

	it('refuses a metafile that disagrees with the file on disk', () => {
		const built = metafileOf([{ path: 'main.js', bytes: 900 }]);
		expect(
			refusal(measure(built, [measurementOf('main.js', 901)])),
		).toContain('Build again');
	});

	it('refuses an output file that nobody measured', () => {
		const built = metafileOf([{ path: 'main.js', bytes: 900 }]);
		expect(refusal(measure(built, []))).toContain('no measurement');
	});

	it('refuses a measured file that the metafile does not declare', () => {
		const built = metafileOf([{ path: 'main.js', bytes: 900 }]);
		expect(
			refusal(
				measure(built, [
					measurementOf('main.js', 900),
					measurementOf('stray.js', 10),
				]),
			),
		).toContain('stray.js');
	});
});

describe('the step that the check accepts', () => {
	it('is 50 kB beside a bundle of a few hundred bytes', () => {
		expect(stepFor(662)).toBe(50_000);
	});

	it('is half of a bundle that is larger than 100 kB', () => {
		expect(stepFor(400_000)).toBe(200_000);
	});
});

describe('the comparison against the baseline', () => {
	const baseline: Baseline = reportOf([
		{
			path: 'main.js',
			bytes: 900,
			modules: { 'src/main.ts': 100, 'node_modules/ical.js/a.js': 400 },
		},
	]);

	it('accepts growth that stays inside the step', () => {
		const grown = reportOf([
			{
				path: 'main.js',
				bytes: 40_000,
				modules: {
					'src/main.ts': 100,
					'node_modules/ical.js/a.js': 39_000,
				},
			},
		]);
		const comparison = compare(grown, baseline);
		expect(comparison.fails).toBe(false);
		expect(comparison.raw.change).toBe(39_100);
		expect(comparison.grew.map((move) => move.name)).toContain('ical.js');
	});

	it('fails on growth past the step, and names the modules that grew', () => {
		const grown = reportOf([
			{
				path: 'main.js',
				bytes: 200_000,
				modules: {
					'src/main.ts': 100,
					'node_modules/ical.js/a.js': 190_000,
				},
			},
		]);
		const comparison = compare(grown, baseline);
		expect(comparison.fails).toBe(true);
		expect(comparison.raw.past).toBe(true);
		expect(comparison.grew).toStrictEqual([
			{
				name: 'ical.js',
				baseline: 400,
				now: 190_000,
				change: 189_600,
			},
		]);
		expect(failureLines(comparison).join('\n')).toContain('ical.js');
	});

	it('keeps the build overhead out of the modules that grew', () => {
		const grown = reportOf([
			{
				path: 'main.js',
				bytes: 200_000,
				modules: {
					'src/main.ts': 100,
					'node_modules/ical.js/a.js': 190_000,
				},
			},
		]);
		const comparison = compare(grown, baseline);
		expect(comparison.grew.map((move) => move.name)).not.toContain(
			OVERHEAD,
		);
		expect(comparison.overhead).toStrictEqual({
			name: OVERHEAD,
			baseline: 400,
			now: 9900,
			change: 9500,
		});
		const lines = failureLines(comparison).join('\n');
		expect(lines).toContain('the 1 module that grew');
		expect(lines).toContain(
			'the build overhead is 9500 bytes (9.5 kB) more',
		);
	});

	it('says that no module grew when only the overhead moved', () => {
		const grown = reportOf([
			{
				path: 'main.js',
				bytes: 200_000,
				modules: {
					'src/main.ts': 100,
					'node_modules/ical.js/a.js': 400,
				},
			},
		]);
		const lines = failureLines(compare(grown, baseline)).join('\n');
		expect(lines).toContain('no module grew');
		expect(lines).toContain('the build overhead is');
	});

	it('names a module that the baseline does not hold', () => {
		const grown = reportOf([
			{
				path: 'main.js',
				bytes: 200_000,
				modules: {
					'src/main.ts': 100,
					'node_modules/@scope/table/data.js': 150_000,
				},
			},
		]);
		const comparison = compare(grown, baseline);
		expect(
			comparison.grew.find((move) => move.name === '@scope/table'),
		).toStrictEqual({
			name: '@scope/table',
			baseline: 0,
			now: 150_000,
			change: 150_000,
		});
	});

	it('reports a build that is smaller, and does not fail on it', () => {
		const smaller = reportOf([
			{ path: 'main.js', bytes: 300, modules: { 'src/main.ts': 100 } },
		]);
		const comparison = compare(smaller, baseline);
		expect(comparison.fails).toBe(false);
		expect(comparison.raw.change).toBe(-600);
		expect(comparison.shrank.map((move) => move.name)).toStrictEqual([
			'ical.js',
		]);
		expect(comparison.overhead.change).toBe(-200);
	});

	/** A build of one entry file and one chunk beside it. */
	const split: Baseline = reportOf([
		{ path: 'main.js', bytes: 900 },
		{ path: 'chunk-A.js', bytes: 300, entry: false },
	]);

	it('fails on an output file that the build stopped making', () => {
		const merged = reportOf([{ path: 'main.js', bytes: 1200 }]);
		const comparison = compare(merged, split);
		expect(comparison.gone).toStrictEqual(['chunk-A.js']);
		expect(comparison.fails).toBe(true);
		expect(comparison.raw.past).toBe(false);
		expect(comparison.raw.change).toBe(0);
		expect(comparison.outputs[0]?.was).toStrictEqual({
			raw: 900,
			compressed: 300,
		});
		const lines = failureLines(comparison).join('\n');
		expect(lines).toContain('the build no longer produces chunk-A.js');
		expect(lines).toContain('the totals did not move');
	});

	it('states the real change when a file goes and the totals move', () => {
		const smaller = reportOf([{ path: 'main.js', bytes: 900 }]);
		const comparison = compare(smaller, split);
		expect(comparison.gone).toStrictEqual(['chunk-A.js']);
		expect(comparison.fails).toBe(true);
		const lines = failureLines(comparison).join('\n');
		expect(lines).toContain('the build no longer produces chunk-A.js');
		expect(lines).not.toContain('the totals did not move');
		expect(lines).toContain(
			'the raw size is 300 bytes less, and the compressed size is 100 bytes less',
		);
	});

	it('accepts an output file that the baseline does not hold', () => {
		const comparison = compare(split, baseline);
		expect(comparison.outputs[1]?.was).toBeUndefined();
		expect(comparison.gone).toStrictEqual([]);
		expect(comparison.fails).toBe(false);
		expect(reportLines(split, comparison, []).join('\n')).toContain(
			'chunk-A.js  chunk  300 bytes raw  100 bytes compressed  the baseline does not hold this file',
		);
	});

	it('accepts bytes that move between the output files it still makes', () => {
		const moved = reportOf([
			{ path: 'main.js', bytes: 600 },
			{ path: 'chunk-A.js', bytes: 600, entry: false },
		]);
		const comparison = compare(moved, split);
		expect(comparison.raw.change).toBe(0);
		expect(comparison.compressed.change).toBe(0);
		expect(comparison.gone).toStrictEqual([]);
		expect(comparison.fails).toBe(false);
		expect(failureLines(comparison)).toStrictEqual([]);
	});
});

describe('the wording of the check', () => {
	const report = reportOf([
		{ path: 'main.js', bytes: 900, modules: { 'src/main.ts': 100 } },
	]);

	it('says the size, the baseline, the step and each output file', () => {
		const lines = reportLines(report, compare(report, report), []).join(
			'\n',
		);
		expect(lines).toContain('900 bytes raw and 300 bytes compressed');
		expect(lines).toContain('50000 bytes (50.0 kB) raw');
		expect(lines).toContain('main.js  entry');
		expect(lines).toContain('(build overhead)  800 bytes');
	});

	it('counts the modules that the table leaves out', () => {
		const modules: Record<string, number> = {};
		for (let index = 0; index < 20; index += 1) {
			modules[`m${String(index).padStart(2, '0')}.ts`] = 10;
		}
		const many = reportOf([{ path: 'main.js', bytes: 900, modules }]);
		const lines = reportLines(many, compare(many, many), []).join('\n');
		expect(lines).toContain('the other 5 modules hold 50 bytes');
		expect(lines).toContain('(build overhead)  700 bytes');
	});

	it('names an output file that the check does not count', () => {
		const lines = reportLines(report, compare(report, report), [
			{ path: 'main.js.map', bytes: 90_000 },
		]).join('\n');
		expect(lines).toContain(
			'bundle size: the check does not count main.js.map, because a release carries no source map. That file holds 90000 bytes (90.0 kB), and no total in this report holds those bytes.',
		);
	});

	it('says that the metafile gives such a file no count of bytes', () => {
		const lines = reportLines(report, compare(report, report), [
			{ path: 'main.js.map', bytes: undefined },
		]).join('\n');
		expect(lines).toContain(
			'the check does not count main.js.map, because a release carries no source map. The metafile gives that file no count of bytes.',
		);
	});

	it('says nothing about a skip when the build skips nothing', () => {
		const lines = reportLines(report, compare(report, report), []).join(
			'\n',
		);
		expect(lines).not.toContain('does not count');
	});

	it('says nothing when the check passes', () => {
		expect(failureLines(compare(report, report))).toStrictEqual([]);
	});

	it('says which size went past the step, and how to accept it', () => {
		const grown = reportOf([{ path: 'main.js', bytes: 200_000 }]);
		const lines = failureLines(compare(grown, report)).join('\n');
		expect(lines).toContain('the raw size grew from 900 bytes');
		expect(lines).toContain('the compressed size grew from 300 bytes');
		expect(lines).toContain('--write-baseline');
	});
});

describe('the committed baseline', () => {
	it('is a record that the check can read', () => {
		const record = taken(readBaseline(readFileSync(COMMITTED, 'utf8')));
		expect(record.outputs[0]?.path).toBe('main.js');
		expect(record.raw).toBeGreaterThan(0);
		expect(record.compressed).toBeGreaterThan(0);
	});

	it.each([
		['text that is not JSON', 'not json'],
		['a baseline with no sizes', '{}'],
		[
			'a baseline with no output file',
			'{"raw":1,"compressed":1,"overhead":0,"outputs":[],"modules":[]}',
		],
		[
			'a baseline with no overhead',
			'{"raw":1,"compressed":1,"outputs":[{"path":"a","kind":"entry","raw":1,"compressed":1}],"modules":[]}',
		],
		[
			'a baseline with a module that has no size',
			'{"raw":1,"compressed":1,"overhead":0,"outputs":[{"path":"a","kind":"entry","raw":1,"compressed":1}],"modules":[{"name":"a"}]}',
		],
	])('refuses %s', (_name, text) => {
		expect(refusal(readBaseline(text))).toContain('baseline');
	});

	/** The record that `--write-baseline` writes for one build. */
	const sound = reportOf([
		{ path: 'main.js', bytes: 900, modules: { 'src/main.ts': 100 } },
	]);

	/** That record, with one number replaced. */
	function tampered(key: string, value: number): string {
		return JSON.stringify({ ...sound, [key]: value });
	}

	it('refuses a raw size that the output files do not add up to', () => {
		expect(refusal(readBaseline(tampered('raw', 600_000)))).toBe(
			'the baseline gives the whole build 600000 bytes raw, and its output files add up to 900 bytes',
		);
	});

	it('refuses a compressed size that the output files do not add up to', () => {
		expect(refusal(readBaseline(tampered('compressed', 5)))).toBe(
			'the baseline gives the whole build 5 bytes compressed, and its output files add up to 300 bytes',
		);
	});

	it('refuses an overhead that does not close the raw size', () => {
		expect(refusal(readBaseline(tampered('overhead', 0)))).toBe(
			'the baseline gives the whole build 900 bytes raw, and its modules and its build overhead add up to 100 bytes',
		);
	});
});

describe('the check as a process', () => {
	/** One directory that all the cases share. */
	let directory = '';

	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), 'davenport-bundle-size-'));
	});

	afterAll(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	/** Writes a build, and gives back the path of its metafile. */
	function build(name: string, outputs: readonly Output[]): string {
		const meta = join(directory, `${name}-meta.json`);
		for (const output of outputs) {
			writeFileSync(
				join(directory, output.path),
				'x'.repeat(output.bytes),
			);
		}
		writeFileSync(meta, metafileText(outputs));
		return meta;
	}

	/** Writes a baseline, and gives back the path of the file. */
	function record(name: string, baseline: Baseline): string {
		const path = join(directory, `${name}-baseline.json`);
		writeFileSync(path, JSON.stringify(baseline));
		return path;
	}

	/** Runs the check with these arguments. */
	function run(...argv: readonly string[]): {
		status: number | null;
		output: string;
	} {
		const result = runNode([SCRIPT, ...argv]);
		return { status: result.status, output: result.stdout + result.stderr };
	}

	it('writes a baseline that the check then accepts', () => {
		const meta = build('steady', [
			{ path: 'steady.js', bytes: 900, modules: { 'src/main.ts': 100 } },
		]);
		const path = join(directory, 'steady-baseline.json');
		const written = run('--write-baseline', meta, path);
		expect(written.status).toBe(0);
		expect(written.output).toContain('wrote the baseline');
		const again = run(meta, path);
		expect(again.status).toBe(0);
		expect(again.output).toContain('The raw size is the same');
		expect(again.output).toContain('src/main.ts  100 bytes');
	});

	it('fails when the metafile is absent, and says to build', () => {
		const result = run(join(directory, 'no-such-meta.json'));
		expect(result.status).toBe(1);
		expect(result.output).toContain('cannot read the metafile');
		expect(result.output).toContain('npm run build');
	});

	it('fails when the baseline is absent, and writes no baseline', () => {
		const meta = build('lonely', [{ path: 'lonely.js', bytes: 900 }]);
		const absent = join(directory, 'no-such-baseline.json');
		const result = run(meta, absent);
		expect(result.status).toBe(1);
		expect(result.output).toContain('cannot read the baseline');
		expect(result.output).toContain('--write-baseline');
		expect(existsSync(absent)).toBe(false);
	});

	it('fails when an output file of the metafile is absent', () => {
		const meta = join(directory, 'ghost-meta.json');
		writeFileSync(meta, metafileText([{ path: 'ghost.js', bytes: 900 }]));
		const baseline = record(
			'ghost',
			reportOf([{ path: 'ghost.js', bytes: 900 }]),
		);
		const result = run(meta, baseline);
		expect(result.status).toBe(1);
		expect(result.output).toContain('cannot read the output file');
	});

	it('passes on growth that stays inside the step', () => {
		const small = reportOf([{ path: 'creep.js', bytes: 900 }]);
		const meta = build('creep', [
			{ path: 'creep.js', bytes: 10_000, modules: { 'a.ts': 9000 } },
		]);
		const result = run(meta, record('creep', small));
		expect(result.status).toBe(0);
		expect(result.output).toContain('more');
	});

	it('fails on growth past the step, and names the module that grew', () => {
		const small = reportOf([{ path: 'burst.js', bytes: 900 }]);
		const meta = build('burst', [
			{
				path: 'burst.js',
				bytes: 200_000,
				modules: { 'node_modules/ical.js/a.js': 190_000 },
			},
		]);
		const result = run(meta, record('burst', small));
		expect(result.status).toBe(1);
		expect(result.output).toContain('goes past the step');
		expect(result.output).toContain('ical.js  from 0 bytes to 190000');
	});

	it.each([
		[
			'a raw size that the output files do not add up to',
			'raw',
			600_000,
			'600000 bytes raw, and its output files add up to 900 bytes',
		],
		[
			'a compressed size that the output files do not add up to',
			'compressed',
			5,
			'5 bytes compressed, and its output files add up to',
		],
		[
			'an overhead that does not close the raw size',
			'overhead',
			0,
			'900 bytes raw, and its modules and its build overhead add up to 100 bytes',
		],
	])('fails on a baseline with %s', (_name, key, value, said) => {
		const outputs = [
			{ path: `${key}.js`, bytes: 900, modules: { 'src/main.ts': 100 } },
		];
		const meta = build(key, outputs);
		const path = join(directory, `${key}-tampered.json`);
		writeFileSync(
			path,
			JSON.stringify({ ...reportOf(outputs), [key]: value }),
		);
		const result = run(meta, path);
		expect(result.status).toBe(1);
		expect(result.output).toContain(said);
	});

	it('fails when the build stops making an output file of the baseline', () => {
		const lazy = reportOf([
			{ path: 'merged.js', bytes: 600 },
			{ path: 'merged-chunk.js', bytes: 600, entry: false },
		]);
		const meta = build('merged', [{ path: 'merged.js', bytes: 1200 }]);
		const result = run(meta, record('merged', lazy));
		expect(result.status).toBe(1);
		expect(result.output).toContain(
			'the build no longer produces merged-chunk.js',
		);
	});

	it('adds one line when the build makes a source map, and passes', () => {
		const outputs = [
			{ path: 'mapped.js', bytes: 900, modules: { 'src/main.ts': 100 } },
		];
		const baseline = record('mapped', reportOf(outputs));
		const plain = run(build('mapped', outputs), baseline);
		const mapped = run(
			build('mapped-map', [
				...outputs,
				{ path: 'mapped.js.map', bytes: 4000, entry: false },
			]),
			baseline,
		);
		expect(plain.status).toBe(0);
		expect(mapped.status).toBe(0);
		expect(plain.output).not.toContain('does not count');
		expect(mapped.output).toContain(
			'bundle size: the check does not count mapped.js.map, because a release carries no source map. That file holds 4000 bytes (4.0 kB), and no total in this report holds those bytes.',
		);
		// The two runs differ by the skip line only. No total moved.
		const rest = mapped.output
			.split('\n')
			.filter((line) => !line.includes('does not count'))
			.join('\n');
		expect(rest).toBe(plain.output);
	});

	it('passes on a build that is smaller than its baseline', () => {
		const large = reportOf([{ path: 'slim.js', bytes: 200_000 }]);
		const meta = build('slim', [{ path: 'slim.js', bytes: 900 }]);
		const result = run(meta, record('slim', large));
		expect(result.status).toBe(0);
		expect(result.output).toContain('less');
	});
});
