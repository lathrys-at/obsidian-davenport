/**
 * The decisions behind the repeat-build check:
 *
 * - which files of a build the check compares;
 * - where two files first differ, and what the report shows around that
 *   place;
 * - what makes the check fail, and the wording that the check prints.
 *
 * The script itself runs the build two times and compares what the two runs
 * wrote. A run can end in several ways, and these cases exercise each way as
 * a process. The interface includes the exit status, and not only the words
 * that the run prints.
 *
 * A case that runs the script gives the script a directory and a build of its
 * own. That build is a small script that these cases write. A case can then
 * make a build that repeats itself, and a case can make a build that does
 * not. The real build of the plugin repeats itself, so no case can get a
 * difference out of it.
 *
 * Each of these builds refuses to run when a file of an earlier run stands in
 * the directory. A pass therefore proves that the check removes the files of
 * the first run before the second run starts.
 */

import { spawnSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { Artifact } from '../scripts/repeat-build-core';
import {
	compare,
	firstDifference,
	outputPaths,
	windowOf,
} from '../scripts/repeat-build-core';
import { failureLines, reportLines } from '../scripts/repeat-build-text';

const SCRIPT = fileURLToPath(
	new URL('../scripts/repeat-build.mjs', import.meta.url),
);

/** The directories that these cases made. The last case removes them. */
const made: string[] = [];

afterAll(() => {
	for (const directory of made) {
		rmSync(directory, { recursive: true, force: true });
	}
});

/** One file of a build, with text in place of the bytes. */
function artifact(path: string, text: string): Artifact {
	return {
		path,
		digest: `digest of ${path}`,
		bytes: new TextEncoder().encode(text),
	};
}

/** The start of every build that these cases write. */
const START = `
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const here = new URL('./', import.meta.url);
const at = (name) => fileURLToPath(new URL('./' + name, here));
let runs = 0;
try {
	runs = Number(readFileSync(at('runs.txt'), 'utf8'));
} catch {
	runs = 0;
}
runs += 1;
writeFileSync(at('runs.txt'), String(runs));
for (const name of ['main.js', 'extra.js', 'bundle-meta.json']) {
	if (existsSync(at(name))) {
		console.error('the build found ' + name + ' from an earlier run');
		process.exit(3);
	}
}
const meta = (outputs) =>
	writeFileSync(at('bundle-meta.json'), JSON.stringify({ inputs: {}, outputs }));
const declare = (name) => ({ [name]: { bytes: 1, inputs: {} } });
`;

/** A directory with a build of its own in it. */
function place(name: string, body: string): string {
	const directory = mkdtempSync(join(tmpdir(), `davenport-repeat-${name}-`));
	made.push(directory);
	writeFileSync(join(directory, 'build.mjs'), START + body);
	return directory;
}

/** Runs the check over the build of a directory. */
function run(directory: string): { status: number | null; output: string } {
	const result = spawnSync(
		process.execPath,
		[SCRIPT, directory, join(directory, 'build.mjs')],
		{ encoding: 'utf8' },
	);
	return { status: result.status, output: result.stdout + result.stderr };
}

/** The count of runs that a build of a directory made. */
function runs(directory: string): string {
	return readFileSync(join(directory, 'runs.txt'), 'utf8');
}

describe('the reader of the metafile', () => {
	it('takes every output file, in sorted order', () => {
		const reading = outputPaths(
			'{"outputs":{"main.js":{},"chunk.js":{},"main.js.map":{}}}',
		);
		expect(reading).toStrictEqual({
			ok: true,
			value: ['chunk.js', 'main.js', 'main.js.map'],
		});
	});

	it.each([
		['text that is not JSON', 'not json at all', 'is not JSON'],
		['a metafile that is not an object', '[]', 'is not a JSON object'],
		[
			'a metafile with no outputs object',
			'{"inputs":{}}',
			'holds no outputs',
		],
		[
			'a metafile that declares no output file',
			'{"outputs":{}}',
			'declares no output file',
		],
	])('refuses %s', (_name, text, reason) => {
		const reading = outputPaths(text);
		expect(reading.ok).toBe(false);
		expect(reading.ok ? '' : reading.reason).toContain(reason);
	});
});

describe('the search for the first difference', () => {
	it('finds no place when the two files hold the same bytes', () => {
		const bytes = new Uint8Array([1, 2, 3]);
		expect(
			firstDifference(bytes, new Uint8Array([1, 2, 3])),
		).toBeUndefined();
	});

	it('finds no place when both files are empty', () => {
		expect(
			firstDifference(new Uint8Array(), new Uint8Array()),
		).toBeUndefined();
	});

	it('gives the place of the first byte that the two files do not share', () => {
		expect(
			firstDifference(
				new Uint8Array([1, 2, 3, 4]),
				new Uint8Array([1, 2, 9, 4]),
			),
		).toBe(2);
	});

	it('gives the length of the shorter file when one file is the start of the other', () => {
		expect(
			firstDifference(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])),
		).toBe(2);
		expect(
			firstDifference(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2])),
		).toBe(2);
	});
});

describe('the window that the report shows', () => {
	const long = new Uint8Array(300).fill(0x61);

	it('starts at the beginning when the difference is near the beginning', () => {
		const window = windowOf(long, 5);
		expect(window.start).toBe(0);
		expect(window.bytes.length).toBe(64);
	});

	it('starts one line before the line that holds the difference', () => {
		expect(windowOf(long, 100).start).toBe(80);
		expect(windowOf(long, 111).start).toBe(80);
		expect(windowOf(long, 112).start).toBe(96);
	});

	it('is empty when the file ends before the place', () => {
		const window = windowOf(new Uint8Array(), 0);
		expect(window.bytes.length).toBe(0);
	});
});

describe('the comparison of two runs', () => {
	it('passes when the two runs wrote the same files with the same bytes', () => {
		const comparison = compare(
			[artifact('main.js', 'same'), artifact('bundle-meta.json', '{}')],
			[artifact('main.js', 'same'), artifact('bundle-meta.json', '{}')],
		);
		expect(comparison.fails).toBe(false);
		expect(comparison.matches).toStrictEqual([
			{
				path: 'bundle-meta.json',
				size: 2,
				digest: 'digest of bundle-meta.json',
			},
			{ path: 'main.js', size: 4, digest: 'digest of main.js' },
		]);
		expect(comparison.differences).toStrictEqual([]);
	});

	it('fails on a file whose bytes are not the same in the two runs', () => {
		const comparison = compare(
			[artifact('main.js', 'abcdefghij')],
			[artifact('main.js', 'abcdefghiJ')],
		);
		expect(comparison.fails).toBe(true);
		expect(comparison.matches).toStrictEqual([]);
		expect(comparison.differences).toHaveLength(1);
		expect(comparison.differences[0]).toMatchObject({
			path: 'main.js',
			offset: 9,
			firstSize: 10,
			secondSize: 10,
		});
	});

	it('fails on a file that only the first run wrote', () => {
		const comparison = compare(
			[artifact('main.js', 'same'), artifact('chunk.js', 'one')],
			[artifact('main.js', 'same')],
		);
		expect(comparison.fails).toBe(true);
		expect(comparison.onlyFirst).toStrictEqual(['chunk.js']);
		expect(comparison.onlySecond).toStrictEqual([]);
	});

	it('fails on a file that only the second run wrote', () => {
		const comparison = compare(
			[artifact('main.js', 'same')],
			[artifact('main.js', 'same'), artifact('chunk.js', 'two')],
		);
		expect(comparison.fails).toBe(true);
		expect(comparison.onlyFirst).toStrictEqual([]);
		expect(comparison.onlySecond).toStrictEqual(['chunk.js']);
	});

	it('fails when the two runs wrote no file at all', () => {
		expect(compare([], []).fails).toBe(true);
	});
});

describe('what the check says', () => {
	it('names each file that the two runs wrote in the same way', () => {
		const comparison = compare(
			[artifact('main.js', 'same')],
			[artifact('main.js', 'same')],
		);
		expect(reportLines(comparison)).toStrictEqual([
			'repeat build: the check ran the build two times. Before the second run it removed every file that the first run wrote, so no file of the first run reached the second run.',
			'repeat build: the two runs wrote 1 file with the same bytes',
			'  main.js  4 bytes  sha256 digest of main.js',
		]);
		expect(failureLines(comparison)).toStrictEqual([]);
	});

	it('shows the place, the sizes, and the bytes around one difference', () => {
		const comparison = compare(
			[artifact('main.js', 'abcdefghij')],
			[artifact('main.js', 'abcdefghiJ')],
		);
		const padding = ' '.repeat(18);
		expect(failureLines(comparison)).toStrictEqual([
			'repeat build: main.js is not the same in the two runs. The first byte that differs is at 9. The first run wrote 10 bytes, and the second run wrote 10 bytes.',
			'  the first run',
			`    00000000  61 62 63 64 65 66 67 68 69 6a${padding}  |abcdefghij|`,
			'  the second run',
			`    00000000  61 62 63 64 65 66 67 68 69 4a${padding}  |abcdefghiJ|`,
			'repeat build: the build is not a function of the source alone. Find the input that changed between the two runs. A time stamp, an absolute path, and an order that a set or a map gives are the usual causes.',
		]);
	});

	it('shows a full line of bytes without padding, and hides what a terminal cannot show', () => {
		// The string holds sixteen letters, then the bytes 0x00 and
		// 0x01. A terminal cannot show those two bytes.
		const first = 'ABCDEFGHIJKLMNOP\x00\x01';
		const comparison = compare(
			[artifact('main.js', first)],
			[artifact('main.js', `${first}!`)],
		);
		expect(failureLines(comparison)[2]).toBe(
			'    00000000  41 42 43 44 45 46 47 48 49 4a 4b 4c 4d 4e 4f 50  |ABCDEFGHIJKLMNOP|',
		);
		expect(failureLines(comparison)[3]).toContain('|..|');
	});

	it('says that a file ends before the place when the file is empty', () => {
		const comparison = compare(
			[artifact('main.js', '')],
			[artifact('main.js', 'x')],
		);
		expect(failureLines(comparison)).toStrictEqual([
			'repeat build: main.js is not the same in the two runs. The first byte that differs is at 0. The first run wrote 0 bytes, and the second run wrote 1 bytes.',
			'  the first run',
			'    the file ends before that place',
			'  the second run',
			`    00000000  78${' '.repeat(45)}  |x|`,
			'repeat build: the build is not a function of the source alone. Find the input that changed between the two runs. A time stamp, an absolute path, and an order that a set or a map gives are the usual causes.',
		]);
	});

	it('names each file that only one of the two runs wrote', () => {
		const comparison = compare(
			[artifact('main.js', 'same'), artifact('chunk.js', 'one')],
			[artifact('main.js', 'same'), artifact('other.js', 'two')],
		);
		expect(failureLines(comparison).slice(0, 2)).toStrictEqual([
			'repeat build: the first run wrote chunk.js, and the second run did not',
			'repeat build: the second run wrote other.js, and the first run did not',
		]);
	});

	it('says that a pair of runs that wrote no file proves nothing', () => {
		expect(failureLines(compare([], []))).toStrictEqual([
			'repeat build: the two runs wrote no file. The check compared no byte, and it therefore proves nothing.',
			'repeat build: the build must write a metafile, and that metafile must name at least one output file.',
		]);
	});
});

describe('the check as a process', () => {
	it('passes on a build that writes the same bytes each time', () => {
		const directory = place(
			'steady',
			`writeFileSync(at('main.js'), 'the same content each run');\nmeta(declare('main.js'));\n`,
		);
		const result = run(directory);
		expect(result.status).toBe(0);
		expect(result.output).toContain(
			'repeat build: the two runs wrote 2 files with the same bytes',
		);
		expect(result.output).toContain('  main.js  25 bytes  sha256 ');
		expect(result.output).toContain('  bundle-meta.json  ');
	});

	it('removes the files of the first run before the second run starts', () => {
		const directory = place(
			'clean',
			`writeFileSync(at('main.js'), 'steady');\nmeta(declare('main.js'));\n`,
		);
		const result = run(directory);
		// Each build here ends with the status 3 when a file of an earlier run
		// stands in the directory. The build ran two times and never did that.
		expect(result.status).toBe(0);
		expect(runs(directory)).toBe('2');
		expect(readFileSync(join(directory, 'main.js'), 'utf8')).toBe('steady');
	});

	it('fails on a build that writes one byte differently, and shows that byte', () => {
		const directory = place(
			'drift',
			`writeFileSync(at('main.js'), 'abcdefghijklmnop' + (runs === 1 ? 'A' : 'B') + ' and the rest repeats');\nmeta(declare('main.js'));\n`,
		);
		const result = run(directory);
		expect(result.status).toBe(1);
		expect(result.output).toContain(
			'repeat build: main.js is not the same in the two runs. The first byte that differs is at 16. The first run wrote 38 bytes, and the second run wrote 38 bytes.',
		);
		expect(result.output).toContain(
			'    00000010  41 20 61 6e 64 20 74 68 65 20 72 65 73 74 20 72  |A and the rest r|',
		);
		expect(result.output).toContain(
			'    00000010  42 20 61 6e 64 20 74 68 65 20 72 65 73 74 20 72  |B and the rest r|',
		);
		expect(result.output).toContain(
			'repeat build: the build is not a function of the source alone.',
		);
	});

	it('fails on a build that writes a file in one run only', () => {
		const directory = place(
			'extra',
			`writeFileSync(at('main.js'), 'steady');\nif (runs === 1) {\n\twriteFileSync(at('extra.js'), 'once');\n\tmeta({ ...declare('main.js'), ...declare('extra.js') });\n} else {\n\tmeta(declare('main.js'));\n}\n`,
		);
		const result = run(directory);
		expect(result.status).toBe(1);
		expect(result.output).toContain(
			'repeat build: the first run wrote extra.js, and the second run did not',
		);
	});

	it('fails when the build writes no metafile', () => {
		const directory = place(
			'nometa',
			`writeFileSync(at('main.js'), 'steady');\n`,
		);
		const result = run(directory);
		expect(result.status).toBe(1);
		expect(result.output).toContain(
			'the first run of the build wrote no metafile',
		);
	});

	it('fails when the build ends with a status that is not zero', () => {
		const directory = place('broken', `process.exit(4);\n`);
		const result = run(directory);
		expect(result.status).toBe(1);
		expect(result.output).toContain(
			'repeat build: the first run of the build ended with the status 4',
		);
	});

	it('fails when the metafile declares no output file', () => {
		const directory = place('barren', `meta({});\n`);
		const result = run(directory);
		expect(result.status).toBe(1);
		expect(result.output).toContain('declares no output file');
	});

	it('fails when the metafile is not JSON', () => {
		const directory = place(
			'garbled',
			`writeFileSync(at('bundle-meta.json'), 'not json at all');\n`,
		);
		const result = run(directory);
		expect(result.status).toBe(1);
		expect(result.output).toContain('is not JSON');
	});

	it('fails when the metafile names a file that the build did not write', () => {
		const directory = place(
			'absent',
			`writeFileSync(at('main.js'), 'steady');\nmeta({ ...declare('main.js'), ...declare('ghost.js') });\n`,
		);
		const result = run(directory);
		expect(result.status).toBe(1);
		expect(result.output).toContain('the check cannot read the file at');
		expect(result.output).toContain('ghost.js');
	});

	it('says how a build stopped when the build does not end on its own', () => {
		const directory = place(
			'killed',
			`process.kill(process.pid, 'SIGKILL');\n`,
		);
		const result = run(directory);
		expect(result.status).toBe(1);
		// Windows has no signals. A process that another process ends there
		// reports an exit status, and it never reports a signal. So the
		// check can name a signal on the other platforms only, and this case
		// asserts what each platform does.
		expect(result.output).toContain(
			process.platform === 'win32'
				? 'repeat build: the first run of the build ended with the status'
				: 'repeat build: the first run of the build stopped on the signal SIGKILL',
		);
	});

	it('fails when every output file that the metafile names is empty', () => {
		const directory = place(
			'hollow',
			`writeFileSync(at('main.js'), '');\nmeta(declare('main.js'));\n`,
		);
		const result = run(directory);
		expect(result.status).toBe(1);
		expect(result.output).toContain(
			'repeat build: the first run of the build wrote no byte',
		);
	});
});

/**
 * The state that the directory of a build holds before the check runs. A
 * build leaves files behind, and a person can leave any file behind. The
 * check removes the files of the build before it builds, and these cases
 * describe what it removes and what it refuses to touch.
 */
describe('the state that the check finds before the first run', () => {
	/** A build that writes one file and declares it. */
	const STEADY = `writeFileSync(at('main.js'), 'steady');\nmeta(declare('main.js'));\n`;

	it('removes an output file that no metafile names', () => {
		const directory = place('stale', STEADY);
		// A watch build writes main.js and writes no metafile. The build of
		// this case ends with the status 3 when it finds main.js, so a pass
		// proves that the check removed the file.
		writeFileSync(join(directory, 'main.js'), 'STALE CONTENT');
		const result = run(directory);
		expect(result.status).toBe(0);
		expect(readFileSync(join(directory, 'main.js'), 'utf8')).toBe('steady');
	});

	it('removes a metafile that it cannot read, and builds', () => {
		const directory = place('leftover', STEADY);
		writeFileSync(join(directory, 'bundle-meta.json'), '{"outputs":{"ma');
		const result = run(directory);
		expect(result.status).toBe(0);
		expect(result.output).not.toContain('is not JSON');
	});

	it('refuses a metafile path that leaves the build directory', () => {
		const directory = place('escape', STEADY);
		const outside = join(
			directory,
			'..',
			`precious-${String(process.pid)}.txt`,
		);
		writeFileSync(outside, 'PRECIOUS');
		made.push(outside);
		writeFileSync(
			join(directory, 'bundle-meta.json'),
			JSON.stringify({
				outputs: {
					[join('..', `precious-${String(process.pid)}.txt`)]: {},
				},
			}),
		);
		const result = run(directory);
		expect(result.status).toBe(1);
		expect(result.output).toContain('leaves the build directory at');
		expect(result.output).toContain(
			'the check reads and removes files inside that directory only',
		);
		// The file outside the build directory is untouched.
		expect(readFileSync(outside, 'utf8')).toBe('PRECIOUS');
	});

	// Windows gives the right to make a symbolic link to an administrator and
	// to a machine in developer mode, and the runner of the tests is neither.
	// The build of this case cannot make its link there.
	it.skipIf(process.platform === 'win32')(
		'refuses to read a link that reaches outside the build directory',
		() => {
			const name = `repeat-build-outside-${String(process.pid)}.txt`;
			const directory = place(
				'linked',
				`writeFileSync(at('main.js'), 'steady');\nsymlinkSync(at('../${name}'), at('link.js'));\nmeta({ ...declare('main.js'), ...declare('link.js') });\n`,
			);
			const outside = join(directory, '..', name);
			writeFileSync(outside, 'THE BYTES OF A FILE OUTSIDE THE DIRECTORY');
			made.push(outside);
			const result = run(directory);
			expect(result.status).toBe(1);
			expect(result.output).toContain('link.js is a link to');
			expect(result.output).toContain('outside the build directory at');
			// No byte of the outside file reached the report.
			expect(result.output).not.toContain('link.js  41 bytes');
			expect(readFileSync(outside, 'utf8')).toBe(
				'THE BYTES OF A FILE OUTSIDE THE DIRECTORY',
			);
		},
	);

	it('names itself when it cannot remove a file that the metafile names', () => {
		const directory = place('locked', STEADY);
		mkdirSync(join(directory, 'a-directory'));
		writeFileSync(
			join(directory, 'bundle-meta.json'),
			JSON.stringify({ outputs: { 'a-directory': {} } }),
		);
		const result = run(directory);
		expect(result.status).toBe(1);
		// Every line of a failure carries the name of the check. A raw error
		// of the runtime carries no name and a path of the machine.
		for (const line of result.output.trim().split('\n')) {
			expect(line.startsWith('repeat build: ')).toBe(true);
		}
		expect(result.output).toContain('the check cannot remove the file at');
	});
});
