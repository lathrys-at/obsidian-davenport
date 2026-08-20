import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GitHost, GitRun } from './run-git';
import {
	GREP_ANSWERS,
	GREP_MATCH,
	GREP_NO_MATCH,
	LS_FILES_ANSWERS,
	runGit,
} from './run-git';
import type { ProcessResult } from './run-node';
import { WINDOWS_ABORT_STATUS } from './run-node';

/** This directory. Each case that names a directory for git names this one. */
const HERE = fileURLToPath(new URL('.', import.meta.url));

const ABORTED: ProcessResult = {
	status: WINDOWS_ABORT_STATUS,
	stdout: '',
	stderr: 'the host aborted git',
};

const REFUSED: ProcessResult = {
	status: 128,
	stdout: '',
	stderr: 'fatal: git refused the command',
};

const KILLED: ProcessResult = { status: null, stdout: '', stderr: '' };

const MATCHED: ProcessResult = {
	status: GREP_MATCH,
	stdout: 'a line that holds the pattern',
	stderr: '',
};

const MISSED: ProcessResult = {
	status: GREP_NO_MATCH,
	stdout: '',
	stderr: '',
};

interface FakeHost extends GitHost {
	readonly runs: readonly GitRun[];
}

/** A host that answers every run with this result. */
function fakeHost(platform: string, result: ProcessResult): FakeHost {
	const runs: GitRun[] = [];
	return {
		platform,
		runs,
		run: (run) => {
			runs.push(run);
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

describe('the run over real git', () => {
	it('gives back the match that a search found', () => {
		const found = runGit({
			args: ['grep', '-nl', 'WINDOWS_ABORT_STATUS'],
			answers: GREP_ANSWERS,
		});
		expect(found.status).toBe(GREP_MATCH);
		expect(found.stdout).toContain('run-node.ts');
	});

	it('gives back the empty output of a search that found nothing', () => {
		// git grep reads the tracked files, and this file is one of them.
		// The case therefore joins the search text from two parts. A search
		// text written as one string would stand in this file, and the
		// search would find that line.
		const absent = 'a-text-that-no' + '-tracked-file-holds';
		const missed = runGit({
			args: ['grep', '-nF', absent],
			answers: GREP_ANSWERS,
		});
		expect(missed.status).toBe(GREP_NO_MATCH);
		expect(missed.stdout).toBe('');
	});

	it('runs git in the directory that the run names', () => {
		const listed = runGit({
			args: ['ls-files', 'run-node.ts'],
			answers: LS_FILES_ANSWERS,
			cwd: HERE,
		});
		expect(listed.stdout.trim()).toBe('run-node.ts');
	});

	it('throws and names the status of a command that git refused', () => {
		const message = messageFrom(() =>
			runGit({ args: ['grep', '-nE', '['], answers: GREP_ANSWERS }),
		);
		expect(message).toContain('128');
		expect(message).toContain('gives 0 or 1 as an answer');
	});

	// A host that cannot start git writes no output stream, and the typings
	// of the platform declare a string for each stream. A directory that is
	// not there makes the host fail in that way. This case measures what the
	// host reports for such a run, and it then asks the module for the same
	// status. A module that reads a stream that is not there throws an error
	// about that stream, and the status reaches nobody.
	it('names the status when the host could not start git', () => {
		const absent = join(HERE, 'a-directory-that-is-not-there');
		const measured = spawnSync('git', ['ls-files'], {
			cwd: absent,
			encoding: 'utf8',
		});
		const message = messageFrom(() =>
			runGit({
				args: ['ls-files'],
				answers: LS_FILES_ANSWERS,
				cwd: absent,
			}),
		);
		expect(message).toContain(`exited with ${String(measured.status)}`);
		expect(message).toContain('gives 0 as an answer');
		expect(message).not.toContain('Cannot read properties');
	});
});

describe('the run that git answered', () => {
	it('gives back each status that the caller named', () => {
		const answers = GREP_ANSWERS;
		expect(
			runGit(
				{ args: ['grep', 'x'], answers },
				fakeHost('linux', MATCHED),
			),
		).toStrictEqual(MATCHED);
		expect(
			runGit({ args: ['grep', 'x'], answers }, fakeHost('linux', MISSED)),
		).toStrictEqual(MISSED);
	});

	it('hands the whole run to the host', () => {
		const host = fakeHost('linux', MATCHED);
		const run: GitRun = {
			args: ['ls-files', '.vaults'],
			answers: LS_FILES_ANSWERS,
			cwd: HERE,
		};
		runGit(run, host);
		expect(host.runs).toStrictEqual([run]);
	});
});

describe('the run that git did not answer', () => {
	const grep: GitRun = { args: ['grep', '-nE', 'x'], answers: GREP_ANSWERS };

	it('names the abort of a host that stopped git', () => {
		const message = messageFrom(() =>
			runGit(grep, fakeHost('win32', ABORTED)),
		);
		expect(message).toContain('Windows abort');
		expect(message).toContain(String(WINDOWS_ABORT_STATUS));
		expect(message).toContain('0xC0000409');
		expect(message).toContain('git did not answer');
		expect(message).toContain('the host aborted git');
	});

	it('refuses the abort status on a host that is not Windows', () => {
		const message = messageFrom(() =>
			runGit(grep, fakeHost('darwin', ABORTED)),
		);
		expect(message).toContain(String(WINDOWS_ABORT_STATUS));
		expect(message).not.toContain('Windows abort');
	});

	it('names the status of a git that refused the command', () => {
		const message = messageFrom(() =>
			runGit(grep, fakeHost('linux', REFUSED)),
		);
		expect(message).toContain('128');
		expect(message).toContain('fatal: git refused the command');
		expect(message).not.toContain('Windows abort');
	});

	it('refuses a status that a signal took away', () => {
		const message = messageFrom(() =>
			runGit(grep, fakeHost('linux', KILLED)),
		);
		expect(message).toContain('null');
		expect(message).toContain('(no stderr)');
	});

	// The caller names the statuses of the command, and not the answer that
	// the caller expects. A caller that leaves out a status that the command
	// gives makes the module throw for a run that git answered.
	it('refuses a status of the command that the caller left out', () => {
		const message = messageFrom(() =>
			runGit(
				{ args: ['grep', 'x'], answers: [GREP_NO_MATCH] },
				fakeHost('linux', MATCHED),
			),
		);
		expect(message).toContain('gives 1 as an answer');
	});

	it('names the command and the empty output rule', () => {
		const message = messageFrom(() =>
			runGit(grep, fakeHost('linux', REFUSED)),
		);
		expect(message).toContain('["grep","-nE","x"]');
		expect(message).toContain('does not read an empty output as a pass');
	});
});
