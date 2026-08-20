/**
 * Gets the issues of the repository. The check reads the claim of each issue
 * out of the body of that issue, and the milestone of the issue states the
 * stage of that claim.
 *
 * The GitHub command line tool answers the question. The tool holds the
 * address of the repository and the credentials of the caller, so the check
 * needs neither of those. On a developer machine the tool uses the login of
 * the developer. In a workflow the tool uses the token of the workflow.
 *
 * The tool answers this command with the exit status 0 and with nothing else.
 * This module gives back the result for that status. For every other status
 * the module throws an error, and the error names the status. Two events make
 * the tool write an empty output without an answer: a host that aborts the
 * process, and a tool that the host could not start. An empty output is
 * therefore an answer only with the status 0, and this module never reads an
 * empty output as an empty repository.
 *
 * The command takes a limit, and the tool gives back the first issues up to
 * that limit. A repository with more issues than the limit gives a part of the
 * set, and a part of the set makes the comparison wrong. This module therefore
 * refuses a result that holds as many issues as the limit.
 *
 * The caller supplies the host that runs the command. A test supplies a host
 * of its own, so no test of this repository reaches GitHub.
 */

import { spawnSync } from 'node:child_process';
import type { Issue } from './stage-claims-core.ts';

/** The status that Windows gives to a process that the host aborted. */
export const WINDOWS_ABORT_STATUS = 3221226505;

/** The count of issues that the command asks for. */
export const LIMIT = 1000;

/** The result of one run of the command. */
export interface CommandResult {
	readonly status: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

/**
 * The part of the host that this module reads. The tests of this module supply
 * their own part.
 */
export interface IssueHost {
	readonly platform: string;
	readonly run: (args: readonly string[]) => CommandResult;
}

/** The one exit status that this command gives as an answer. */
export const ANSWERS: readonly number[] = [0];

/** The arguments that follow the word gh. */
export function commandArgs(limit: number): readonly string[] {
	return [
		'issue',
		'list',
		'--state',
		'all',
		'--limit',
		String(limit),
		'--json',
		'number,title,body,milestone',
	];
}

/**
 * The text of one output stream of the child. A host that could not start the
 * tool leaves both streams empty, and the platform declares a string that it
 * does not always supply.
 */
function streamOf(text: string | undefined): string {
	return text ?? '';
}

const REAL_HOST: IssueHost = {
	platform: process.platform,
	run: (args) => {
		const result = spawnSync('gh', [...args], { encoding: 'utf8' });
		// A host that could not start the tool gives no status and no output.
		// The reason then stands in the error alone, so the error goes into
		// the stream that the refusal prints.
		return {
			status: result.status,
			stdout: streamOf(result.stdout),
			stderr:
				result.error === undefined
					? streamOf(result.stderr)
					: `${streamOf(result.stderr)}${result.error.message}`,
		};
	},
};

function stderrOf(result: CommandResult): string {
	const text = result.stderr.trim();
	return text === '' ? '(no stderr)' : text;
}

function refusal(
	args: readonly string[],
	result: CommandResult,
	platform: string,
): string {
	const command = `gh ${JSON.stringify(args)}`;
	let opening: string;
	if (platform === 'win32' && result.status === WINDOWS_ABORT_STATUS) {
		opening =
			`Windows abort: ${command} exited with ` +
			`${String(WINDOWS_ABORT_STATUS)} (0xC0000409). The host aborted ` +
			`the process, and the tool did not answer.`;
	} else if (result.status === null) {
		opening =
			`${command} gave no exit status. The host could not start the ` +
			`tool, or the host stopped the tool. Install the GitHub command ` +
			`line tool, or run the check with --issues=<file>.`;
	} else {
		opening =
			`${command} exited with ${String(result.status)}. This status ` +
			`is not an answer to this command.`;
	}
	return [
		opening,
		`This command gives ${ANSWERS.map(String).join(' or ')} as an answer.`,
		'The output of a run with another status says nothing about the ' +
			'issues. The check therefore stops here. The check does not read ' +
			'an empty output as a repository with no issue.',
		`stderr: ${stderrOf(result)}`,
	].join('\n');
}

/** The value at a key of an object, or nothing. */
function field(holder: object, key: string): unknown {
	return key in holder ? (holder as Record<string, unknown>)[key] : undefined;
}

/** The name of the milestone that one row of the answer carries. */
function milestoneOf(row: object): string | undefined {
	const holder = field(row, 'milestone');
	if (typeof holder !== 'object' || holder === null) {
		return undefined;
	}
	const title = field(holder, 'title');
	return typeof title === 'string' ? title : undefined;
}

/**
 * The issues that the answer of the command holds. A row that carries no
 * number, no title, or no body is not an issue that the check can read, and
 * this function throws on such a row.
 *
 * The command asks for the body of each issue, and GitHub gives an empty body
 * as an empty string. A row with no body, or with a body of another type, is
 * therefore an answer of a shape that this module does not know. Such a row
 * would carry no claim, and a set of such rows would make the comparison small
 * and leave the check green. The function throws instead.
 */
export function readAnswer(text: string): readonly Issue[] {
	let held: unknown;
	try {
		held = JSON.parse(text);
	} catch (error) {
		const said = error instanceof Error ? error.message : String(error);
		throw new Error(`the answer of the command is not JSON: ${said}`);
	}
	if (!Array.isArray(held)) {
		throw new Error('the answer of the command is not a list of issues');
	}
	return held.map((row: unknown, index) => {
		if (typeof row !== 'object' || row === null) {
			throw new Error(
				`issue ${String(index + 1)} of the answer is not an object`,
			);
		}
		const number = field(row, 'number');
		const title = field(row, 'title');
		const body = field(row, 'body');
		if (typeof number !== 'number' || typeof title !== 'string') {
			throw new Error(
				`issue ${String(index + 1)} of the answer carries no number and no title`,
			);
		}
		if (typeof body !== 'string') {
			throw new Error(
				`issue #${String(number)} of the answer carries no body. The command asks for the body of each issue, and the answer gives an empty body as an empty string.`,
			);
		}
		return { number, title, body, milestone: milestoneOf(row) };
	});
}

/**
 * The answer of the command, as text.
 *
 * The function throws an error when the tool gives a status that is not an
 * answer. The caller can keep this text. The bodies and the milestones of the
 * issues change when nobody changes the tree, so the text is the only record
 * of what one run compared.
 */
export function getAnswer(
	host: IssueHost = REAL_HOST,
	limit: number = LIMIT,
): string {
	const args = commandArgs(limit);
	const result = host.run(args);
	if (result.status === null || !ANSWERS.includes(result.status)) {
		throw new Error(refusal(args, result, host.platform));
	}
	return result.stdout;
}

/**
 * The issues that the answer of the command holds, under the limit of the
 * command. The function throws an error when the answer is not a list of
 * issues, and when the answer holds as many issues as the limit. The caller
 * therefore never compares a part of the set of issues.
 */
export function issuesOf(
	text: string,
	limit: number = LIMIT,
): readonly Issue[] {
	const issues = readAnswer(text);
	if (issues.length >= limit) {
		throw new Error(
			[
				`the command gave ${String(issues.length)} issues, and the ` +
					`limit of the command is ${String(limit)}.`,
				'The repository can hold more issues than the command gave. ' +
					'A part of the set makes the comparison wrong. Raise the ' +
					'limit in scripts/stage-claims-issues.ts.',
			].join('\n'),
		);
	}
	return issues;
}

/**
 * Gets the issues of the repository.
 *
 * The function throws an error when the tool gives a status that is not an
 * answer, when the answer is not a list of issues, or when the answer holds as
 * many issues as the limit.
 */
export function getIssues(
	host: IssueHost = REAL_HOST,
	limit: number = LIMIT,
): readonly Issue[] {
	return issuesOf(getAnswer(host, limit), limit);
}
