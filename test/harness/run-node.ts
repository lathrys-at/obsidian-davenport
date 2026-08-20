/**
 * Runs a script under node as a child process. The tests that read the exit
 * status of a script use this module. That status says whether the script
 * accepted or refused its input.
 *
 * Windows can stop a process and give it the status 3221226505, which is
 * 0xC0000409. The host writes that status, and the script does not. A test
 * that reads this status as the answer of the script therefore reports a
 * failure that the script did not cause.
 *
 * On Windows, and for that status alone, this module runs the child one more
 * time. The module writes one line to the log when it runs the child again.
 * A second run that ends with the same status makes the module throw an
 * error, because the status is still not the answer of the script. For every
 * other status, and on every other host, the module gives back the result of
 * the first run and writes nothing to the log.
 */

import { spawnSync } from 'node:child_process';

/** The status that Windows gives to a process that the host stopped. */
export const WINDOWS_ABORT_STATUS = 3221226505;

export interface ProcessResult {
	readonly status: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

/**
 * The parts of the host that this module reads. The tests of this module
 * supply their own parts, because a host that is not Windows cannot make the
 * abort status.
 */
export interface Host {
	readonly platform: string;
	readonly run: (args: readonly string[]) => ProcessResult;
}

const REAL_HOST: Host = {
	platform: process.platform,
	run: (args) => {
		const result = spawnSync(process.execPath, [...args], {
			encoding: 'utf8',
		});
		return {
			status: result.status,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	},
};

/**
 * Tells whether the host stopped this child. Only Windows writes the abort
 * status, so the answer for every other platform is no.
 */
export function isWindowsAbort(
	result: ProcessResult,
	platform: string,
): boolean {
	return platform === 'win32' && result.status === WINDOWS_ABORT_STATUS;
}

function stderrOf(result: ProcessResult): string {
	const text = result.stderr.trim();
	return text === '' ? '(no stderr)' : text;
}

/**
 * Runs node with these arguments. Gives back the exit status and the two
 * output streams of the child.
 *
 * The status in the result never comes from the host. A child that the host
 * stops two times makes this function throw an error.
 */
export function runNode(
	args: readonly string[],
	host: Host = REAL_HOST,
): ProcessResult {
	const first = host.run(args);
	if (!isWindowsAbort(first, host.platform)) return first;
	console.error(
		`windows abort: node ${JSON.stringify(args)} exited with ` +
			`${String(WINDOWS_ABORT_STATUS)} (0xC0000409). The host stopped ` +
			`the process. This status does not come from the script. The ` +
			`harness runs the child one more time.`,
	);
	const second = host.run(args);
	if (!isWindowsAbort(second, host.platform)) return second;
	throw new Error(
		[
			`windows abort: node ${JSON.stringify(args)} exited with ` +
				`${String(WINDOWS_ABORT_STATUS)} (0xC0000409) two times.`,
			'The host stopped the process both times. This status does not ' +
				'come from the script.',
			`attempt 1: status ${String(first.status)}, stderr ${stderrOf(first)}`,
			`attempt 2: status ${String(second.status)}, stderr ${stderrOf(second)}`,
		].join('\n'),
	);
}
