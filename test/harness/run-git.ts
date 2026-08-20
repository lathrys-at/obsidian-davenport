/**
 * Runs git as a child process. The tests that ask git a question about the
 * repository use this module.
 *
 * Some of those questions are guards. A guard passes when git finds nothing,
 * and the test reads an empty output as that answer. A git command that did
 * not search also leaves an empty output. The test then passes, and the test
 * reports nothing about the repository. Two things make git leave an empty
 * output without a search. The first is a host that aborts the process. The
 * second is a command that git refuses.
 *
 * The caller of this module states each exit status that the command gives as
 * an answer. The module gives back the result for those statuses. For every
 * other status the module throws an error, and the error names the status. A
 * guard therefore fails when git did not answer.
 *
 * The module names the abort of a host in that error, in the terms that
 * `run-node.ts` states. The module does not run the command again. A caller
 * that needs a second run must make that run itself.
 */

import { spawnSync } from 'node:child_process';
import type { ProcessResult } from './run-node';
import { WINDOWS_ABORT_STATUS, isWindowsAbort } from './run-node';

/** The status that `git grep` gives when it finds a match. */
export const GREP_MATCH = 0;

/** The status that `git grep` gives when it finds no match. */
export const GREP_NO_MATCH = 1;

/**
 * The two statuses that `git grep` gives as an answer. The command gives 128
 * for a pattern that it refuses. The command also gives 128 in a directory
 * that holds no repository. That status says nothing about the tracked
 * files.
 */
export const GREP_ANSWERS: readonly number[] = [GREP_MATCH, GREP_NO_MATCH];

/**
 * The one status that `git ls-files` gives as an answer. The command gives 0
 * when it lists a file, and it gives 0 when it lists nothing. Therefore an
 * empty output is an answer only when the status is 0.
 */
export const LS_FILES_ANSWERS: readonly number[] = [0];

/** One run of git. */
export interface GitRun {
	/** The arguments that follow the word git. */
	readonly args: readonly string[];
	/** Each exit status that this command gives as an answer. */
	readonly answers: readonly number[];
	/**
	 * The directory that git runs in. The default is the working directory of
	 * the test process.
	 */
	readonly cwd?: string;
}

/**
 * The part of the host that this module reads. The tests of this module
 * supply their own part. A host that runs git makes no status that this
 * module refuses, and a test cannot wait for one.
 */
export interface GitHost {
	readonly platform: string;
	readonly run: (run: GitRun) => ProcessResult;
}

const REAL_HOST: GitHost = {
	platform: process.platform,
	run: (run) => {
		const result = spawnSync('git', [...run.args], {
			cwd: run.cwd,
			encoding: 'utf8',
		});
		return {
			status: result.status,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	},
};

function stderrOf(result: ProcessResult): string {
	const text = result.stderr.trim();
	return text === '' ? '(no stderr)' : text;
}

function refusal(run: GitRun, result: ProcessResult, platform: string): string {
	const command = `git ${JSON.stringify(run.args)}`;
	const answers = run.answers.map(String).join(' or ');
	const opening = isWindowsAbort(result, platform)
		? `Windows abort: ${command} exited with ` +
			`${String(WINDOWS_ABORT_STATUS)} (0xC0000409). The host aborted ` +
			`the process, and git did not answer.`
		: `${command} exited with ${String(result.status)}. This status is ` +
			`not an answer to the question.`;
	return [
		opening,
		`This command gives ${answers} as an answer.`,
		'The output of a run with another status says nothing about the ' +
			'repository. The harness therefore fails this run. The harness ' +
			'does not read an empty output as a pass.',
		`stderr: ${stderrOf(result)}`,
	].join('\n');
}

/**
 * Runs git and gives back the exit status and the two output streams. The
 * status in the result is always one that the caller named as an answer.
 *
 * Any other status makes this function throw an error, and the error names
 * the status. A caller therefore never reads the output of a git that did
 * not answer.
 */
export function runGit(run: GitRun, host: GitHost = REAL_HOST): ProcessResult {
	const result = host.run(run);
	if (result.status !== null && run.answers.includes(result.status)) {
		return result;
	}
	throw new Error(refusal(run, result, host.platform));
}
