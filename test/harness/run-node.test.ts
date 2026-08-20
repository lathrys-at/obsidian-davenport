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
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import type { Host, ProcessResult } from './run-node';
import { WINDOWS_ABORT_STATUS, isWindowsAbort, runNode } from './run-node';

/** One directory for the scripts of every case. */
let directory = '';

beforeAll(() => {
	directory = mkdtempSync(join(tmpdir(), 'davenport-run-node-'));
});

afterAll(() => {
	rmSync(directory, { recursive: true, force: true });
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** Writes a script that exits with this status, and gives back its path. */
function scriptThatExits(name: string, status: number): string {
	const path = join(directory, `${name}.mjs`);
	writeFileSync(path, `process.exit(${String(status)});\n`, 'utf8');
	return path;
}

/**
 * Writes a script that counts its own runs in a file beside it. The script
 * exits with the first status on the first run, and with the second status
 * on every run after that. This helper also gives back a function that tells
 * how many times the script ran.
 */
function countedScript(
	name: string,
	first: number,
	later: number,
): { path: string; runs: () => number } {
	const marker = join(directory, `${name}.runs`);
	const path = join(directory, `${name}.mjs`);
	const runs = (): number =>
		existsSync(marker) ? readFileSync(marker, 'utf8').length : 0;
	writeFileSync(
		path,
		[
			"import { appendFileSync, readFileSync } from 'node:fs';",
			`const marker = ${JSON.stringify(marker)};`,
			"appendFileSync(marker, 'x');",
			"const count = readFileSync(marker, 'utf8').length;",
			`process.exit(count === 1 ? ${String(first)} : ${String(later)});`,
		].join('\n'),
		'utf8',
	);
	return { path, runs };
}

const ABORTED: ProcessResult = {
	status: WINDOWS_ABORT_STATUS,
	stdout: '',
	stderr: 'the host aborted the first run',
};

const ABORTED_AGAIN: ProcessResult = {
	status: WINDOWS_ABORT_STATUS,
	stdout: '',
	stderr: 'the host aborted the second run',
};

const PASSED: ProcessResult = { status: 0, stdout: 'the output', stderr: '' };

const REFUSED: ProcessResult = {
	status: 1,
	stdout: '',
	stderr: 'the check refused the input',
};

const KILLED: ProcessResult = { status: null, stdout: '', stderr: '' };

interface FakeHost extends Host {
	readonly calls: readonly (readonly string[])[];
}

/**
 * A host that answers with these results, one for each run, in this order. A
 * run that the list does not cover makes the fake host throw an error. A
 * retry that this file does not expect therefore fails the case that made
 * the retry.
 */
function fakeHost(platform: string, ...results: ProcessResult[]): FakeHost {
	const calls: string[][] = [];
	return {
		platform,
		calls,
		run: (args) => {
			calls.push([...args]);
			const result = results[calls.length - 1];
			if (result === undefined) {
				throw new Error(
					`the fake host has no result for run ${String(calls.length)}`,
				);
			}
			return result;
		},
	};
}

/** The message of the error that this call throws. */
function messageFrom(call: () => unknown): string {
	try {
		call();
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	expect.fail('the call gave back a result, and it must throw');
}

describe('the run over a real child', () => {
	it('gives back the status and both streams of the child', () => {
		const path = join(directory, 'streams.mjs');
		writeFileSync(
			path,
			[
				"process.stdout.write('to out');",
				"process.stderr.write('to err');",
				'process.exit(3);',
			].join('\n'),
			'utf8',
		);
		const result = runNode([path]);
		expect(result.status).toBe(3);
		expect(result.stdout).toBe('to out');
		expect(result.stderr).toBe('to err');
	});

	it('runs the child one time when the child exits with a plain status', () => {
		const script = countedScript('refuses', 1, 0);
		expect(runNode([script.path]).status).toBe(1);
		expect(script.runs()).toBe(1);
	});

	// A host that is not Windows cannot report the abort status. The exit
	// status of such a host carries eight bits, so a child that asks to exit
	// with 3221226505 ends with the lowest byte of that number. Windows
	// carries the whole number. This case therefore measures what this host
	// reports for such a child, and states the retry against that
	// measurement. On the Windows leg of CI the case runs the retry against
	// a real child.
	it('runs the child again where the host reports the abort status', () => {
		const measured = spawnSync(process.execPath, [
			scriptThatExits('measure', WINDOWS_ABORT_STATUS),
		]).status;
		// The measurement below follows the host. A Windows that reported
		// another form of the status would stop the retry, and a measurement
		// alone would follow that change and keep this case green. Windows
		// therefore also states the number that the retry rule holds.
		if (process.platform === 'win32') {
			expect(measured).toBe(WINDOWS_ABORT_STATUS);
		}
		const reports = measured === WINDOWS_ABORT_STATUS;
		const script = countedScript('aborts-once', WINDOWS_ABORT_STATUS, 0);
		const result = runNode([script.path]);
		expect(script.runs()).toBe(reports ? 2 : 1);
		expect(result.status).toBe(reports ? 0 : measured);
	});
});

describe('the retry rule', () => {
	it('holds for the abort status on Windows alone', () => {
		expect(isWindowsAbort(ABORTED, 'win32')).toBe(true);
		expect(isWindowsAbort(ABORTED, 'darwin')).toBe(false);
		expect(isWindowsAbort(ABORTED, 'linux')).toBe(false);
	});

	it('holds for no other status', () => {
		expect(isWindowsAbort(PASSED, 'win32')).toBe(false);
		expect(isWindowsAbort(REFUSED, 'win32')).toBe(false);
		expect(isWindowsAbort(KILLED, 'win32')).toBe(false);
		expect(
			isWindowsAbort(
				{ ...ABORTED, status: WINDOWS_ABORT_STATUS - 1 },
				'win32',
			),
		).toBe(false);
	});
});

describe('the run against a host that aborts the child', () => {
	it('runs the child again and gives back the second result', () => {
		const host = fakeHost('win32', ABORTED, PASSED);
		expect(runNode(['check.mjs', '--flag'], host)).toStrictEqual(PASSED);
		expect(host.calls).toStrictEqual([
			['check.mjs', '--flag'],
			['check.mjs', '--flag'],
		]);
	});

	it('writes one line that names the status and the retry', () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {
			// The assertions below read the line. The run must not print it.
		});
		runNode(['check.mjs'], fakeHost('win32', ABORTED, PASSED));
		expect(log).toHaveBeenCalledTimes(1);
		const line = log.mock.calls[0]?.[0] as string;
		expect(line).not.toContain('\n');
		expect(line).toContain(String(WINDOWS_ABORT_STATUS));
		expect(line).toContain('0xC0000409');
		expect(line).toContain('does not come from the script');
		expect(line).toContain('one more time');
		expect(line).toContain('check.mjs');
	});

	it('throws and names both attempts when the host aborts the child twice', () => {
		const host = fakeHost('win32', ABORTED, ABORTED_AGAIN);
		const log = vi.spyOn(console, 'error').mockImplementation(() => {
			// The retry line is not the subject of this case.
		});
		const message = messageFrom(() => runNode(['check.mjs'], host));
		expect(message).toContain('two times');
		expect(message).toContain('attempt 1');
		expect(message).toContain('the host aborted the first run');
		expect(message).toContain('attempt 2');
		expect(message).toContain('the host aborted the second run');
		expect(host.calls).toHaveLength(2);
		expect(log).toHaveBeenCalledTimes(1);
	});

	it('names an empty stream in the report of an attempt', () => {
		const silent: ProcessResult = {
			status: WINDOWS_ABORT_STATUS,
			stdout: '',
			stderr: '  \n',
		};
		vi.spyOn(console, 'error').mockImplementation(() => {
			// The retry line is not the subject of this case.
		});
		const message = messageFrom(() =>
			runNode(['check.mjs'], fakeHost('win32', silent, silent)),
		);
		expect(message).toContain('(no stderr)');
	});
});

describe('the run that the rule does not cover', () => {
	it('gives back a plain nonzero status without a second run', () => {
		const log = vi.spyOn(console, 'error');
		const host = fakeHost('win32', REFUSED);
		expect(runNode(['check.mjs'], host)).toStrictEqual(REFUSED);
		expect(host.calls).toHaveLength(1);
		expect(log).not.toHaveBeenCalled();
	});

	it('gives back a status that a signal took away without a second run', () => {
		const host = fakeHost('win32', KILLED);
		expect(runNode(['check.mjs'], host)).toStrictEqual(KILLED);
		expect(host.calls).toHaveLength(1);
	});

	it('gives back the abort status itself on a host that is not Windows', () => {
		const log = vi.spyOn(console, 'error');
		const host = fakeHost('darwin', ABORTED);
		expect(runNode(['check.mjs'], host)).toStrictEqual(ABORTED);
		expect(host.calls).toHaveLength(1);
		expect(log).not.toHaveBeenCalled();
	});

	it('writes nothing to the log for a child that passes', () => {
		const log = vi.spyOn(console, 'error');
		expect(runNode(['check.mjs'], fakeHost('win32', PASSED))).toStrictEqual(
			PASSED,
		);
		expect(log).not.toHaveBeenCalled();
	});
});
