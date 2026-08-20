/**
 * The wording of everything that the stage-and-claim traceability check
 * prints. The check prints three kinds of line. The fault names what the check
 * needs and did not find. The report says what the check found. The failure
 * names each ID that fails the check.
 *
 * Each line that states a fact carries the name of the check, so that the line
 * stays legible in a log that holds the output of many steps. A line that
 * continues a statement carries no name, and it stands indented under the line
 * that it continues.
 */

import type { PlanCorpus } from './plan-ids-core.ts';
import { prefixOf } from './plan-ids-core.ts';
import type {
	Adjudicated,
	ClaimFault,
	ClaimScan,
	Disagreement,
	Reconciliation,
	StageCorpus,
	StageFault,
} from './stage-claims-core.ts';

/**
 * Staging moves as the work proceeds. A disagreement between a stage list and
 * a milestone is therefore a thing to read, and it is not a thing to fix at
 * once. The check says this each time it reports a disagreement.
 */
const MOVES = [
	'a disagreement here fails nothing.',
	'Staging moves as the work proceeds.',
	'Read each line above, and correct the stage list or the issue where the',
	'two are out of step.',
].join(' ');

/** The lines of the fault of the plan. The check fails after these lines. */
export function faultLines(faults: readonly StageFault[]): readonly string[] {
	if (faults.length === 0) {
		return [];
	}
	const lines = faults.map((fault) => say(faultText(fault)));
	lines.push(
		say('The comparison did not run. The plan failed the checks above.'),
	);
	return lines;
}

function faultText(fault: StageFault): string {
	switch (fault.kind) {
		case 'no-part':
			return 'the plan holds no part of ordering and stage gates. The check expects a heading that starts with the words Part 8.';
		case 'no-stage':
			return 'the plan declares no stage. The check expects a list item that starts with a bold name of the form Stage 1 (feeds, read path):';
		case 'empty-stage':
			return `the plan declares stage ${String(fault.stage)} and gives that stage no test ID.`;
	}
}

/** The lines of the fault of the issues. The check fails after these lines. */
export function issueFaultLines(
	faults: readonly ClaimFault[],
): readonly string[] {
	if (faults.length === 0) {
		return [];
	}
	const lines = faults.map((fault) => say(issueFaultText(fault)));
	lines.push(
		say('The comparison did not run. The issues failed the checks above.'),
	);
	return lines;
}

function issueFaultText(fault: ClaimFault): string {
	switch (fault.kind) {
		case 'no-issue':
			return 'the repository gave no issue. The check compares the stage lists with the claims of the issues, and it cannot make that comparison.';
		case 'no-trailer':
			return 'no issue carries a claim line. The check expects a list item of the body that starts with the words Test plan and a colon.';
	}
}

/** The lines that state what the stage lists hold. */
export function stageLines(
	plan: PlanCorpus,
	stages: StageCorpus,
): readonly string[] {
	const held = new Set(stages.holds.map((hold) => hold.id));
	const lines = [
		say(
			`the plan declares ${count(stages.stages, 'stage')}. The stages hold ${String(held.size)} of the ${String(plan.suiteIds.length)} test IDs of the plan.`,
		),
		say(
			`the count of test IDs that more than one stage holds is ${String(stages.splitHalves.length)}. Each of these IDs needs a claim for each stage that holds it.`,
		),
		say(
			'the check compares the test IDs. The plan does not give the sweeps and the appendix items to the stages one by one, so the check passes over those IDs.',
		),
	];
	return lines;
}

/**
 * The lines that name the suite tags that the check passed over. A suite tag
 * counts only where the tag opens an entry of a stage list. A tag inside a
 * phrase names a thing, and the entry then gives the stage the IDs that the
 * entry names. These lines make that choice visible.
 */
export function passedLines(stages: StageCorpus): readonly string[] {
	const lines: string[] = [];
	for (const stage of stages.stages) {
		for (const entry of stage.entries) {
			for (const tag of entry.passed) {
				lines.push(
					say(
						`stage ${String(stage.number)} names the suite ${tag} inside an entry, and the entry does not start with that suite`,
					),
					`  entry: ${entry.text}`,
				);
			}
		}
	}
	if (lines.length === 0) {
		return [];
	}
	lines.push(
		say(
			'the check gives such a stage the IDs that the entry names, and it does not give that stage the whole suite.',
		),
	);
	return lines;
}

/**
 * The line that states where the issues came from. The check gets the issues
 * from GitHub, and a person can give it a file of issues instead. The report
 * says which of the two it read, so that a reader knows what the comparison
 * stands on.
 */
export function sourceLines(path: string | undefined): readonly string[] {
	return [
		say(
			path === undefined
				? 'the check read the issues of the repository through the GitHub command line tool'
				: `the check read the issues from the file ${path}, and it read no issue of the repository`,
		),
	];
}

/** The lines that state what the issues claim. */
export function claimLines(scan: ClaimScan): readonly string[] {
	const ids = new Set(scan.claims.map((claim) => claim.id));
	const lines = [
		say(
			`the check read a claim line in ${plural(scan.trailers, 'issue')}. Those lines make ${count(scan.claims, 'claim')} of a test ID, and the claims name ${String(ids.size)} different test IDs.`,
		),
	];
	for (const [stage, names] of [...scan.milestones].sort(
		(left, right) => left[0] - right[0],
	)) {
		lines.push(`  stage ${String(stage)}: ${names.join(', ')}`);
	}
	for (const loose of scan.loose) {
		lines.push(
			say(
				`issue #${String(loose.issue)} claims ${loose.ids.join(' ')}, and the milestone of that issue names no stage`,
			),
			`  milestone: ${loose.milestone ?? '(the issue has no milestone)'}`,
		);
	}
	return lines;
}

/** The lines that name each disagreement of a stage list and a milestone. */
export function disagreementLines(result: Reconciliation): readonly string[] {
	const named = result.unclaimed.filter((item) => item.named);
	const spread = result.unclaimed.filter((item) => !item.named);
	const lines: string[] = [];
	for (const item of named) {
		lines.push(
			say(
				`stage ${String(item.stage)} names ${item.id}, and no issue of the milestone of stage ${String(item.stage)} claims ${item.id}`,
			),
			`  ${claimants(item)}`,
		);
	}
	lines.push(...spreadLines(spread));
	for (const item of result.unheld) {
		lines.push(
			say(
				`${issues(item)} ${item.issues.length === 1 ? 'claims' : 'claim'} ${item.id} for stage ${String(item.stage)}, and stage ${String(item.stage)} does not hold ${item.id}`,
			),
			`  the stages that hold ${item.id}: ${numbers(item.stages)}`,
		);
	}
	if (result.neverClaimed.length > 0) {
		lines.push(
			say(
				`the count of test IDs that no issue claims for any stage is ${String(result.neverClaimed.length)}`,
			),
		);
		for (const row of group(result.neverClaimed)) {
			lines.push(`  ${row}`);
		}
	}
	if (lines.length === 0) {
		return [
			say(
				'every stage that holds a test ID has an issue of its milestone that claims that ID, and every claim of an issue stands in the stage of its milestone',
			),
		];
	}
	lines.push(say(MOVES));
	return lines;
}

/**
 * The lines that name the IDs that a suite tag gave to a stage, and that no
 * issue of the milestone of that stage claims. A stage that names a suite asks
 * for the whole suite, and an earlier stage can have delivered a member of
 * that suite already. These lines therefore stand together, with one line for
 * each stage.
 */
function spreadLines(items: readonly Disagreement[]): readonly string[] {
	if (items.length === 0) {
		return [];
	}
	const rows = new Map<number, string[]>();
	for (const item of items) {
		const row = rows.get(item.stage) ?? [];
		row.push(item.id);
		rows.set(item.stage, row);
	}
	const lines = [
		say(
			`the count of test IDs that a suite name gave to a stage, and that no issue of the milestone of that stage claims, is ${String(items.length)}`,
		),
	];
	for (const [stage, row] of [...rows].sort(
		(left, right) => left[0] - right[0],
	)) {
		lines.push(`  stage ${String(stage)}: ${row.join(' ')}`);
	}
	lines.push(
		say(
			'a stage that names a suite asks for the whole suite. An earlier stage can have delivered a member of that suite already.',
		),
	);
	return lines;
}

/** The issues that make one claim, as the report names them. */
function issues(item: Disagreement): string {
	return item.issues
		.map((number) => `issue #${String(number)}`)
		.join(' and ');
}

/** The sentence that says which milestones claim the ID of a disagreement. */
function claimants(item: Disagreement): string {
	if (item.claimed.length === 0) {
		return `no issue claims ${item.id} for any stage`;
	}
	return `the issues of ${numbers(item.claimed)} claim ${item.id}`;
}

/** The lines that name the mentions that a person adjudicated. */
export function adjudicatedLines(result: Reconciliation): readonly string[] {
	const lines: string[] = [];
	if (result.applied.length > 0) {
		lines.push(
			say(
				`the check met ${count(result.applied, 'adjudicated mention')}. A person ruled that each of these is correct as it stands, so the report above does not hold it as a disagreement.`,
			),
		);
		for (const entry of result.applied) {
			lines.push(`  ${describe(entry)}`);
		}
	}
	if (result.stale.length > 0) {
		lines.push(
			say(
				`${count(result.stale, 'adjudicated mention')} of the check meets no disagreement in this run. Remove each of these from scripts/stage-claims-core.ts.`,
			),
		);
		for (const entry of result.stale) {
			lines.push(`  ${describe(entry)}`);
		}
	}
	return lines;
}

function describe(entry: Adjudicated): string {
	return `${entry.id} at stage ${String(entry.stage)}: ${entry.reason}`;
}

/**
 * The lines that state that the check read the plan and did not read the
 * issues. The check reads the plan from a file, and it reads the issues from
 * GitHub. A machine with no credentials and no network can run the first half
 * alone. The check says so, and it never passes the second half in silence.
 */
export function offlineLines(reason: string): readonly string[] {
	return [
		say('the check cannot read the issues of the repository'),
		...reason.split('\n').map((line) => `  ${line}`),
		say(
			'the check compared the stage lists of the plan, and it compared nothing against the issues. Run the check again on a machine that can reach GitHub.',
		),
	];
}

/**
 * The lines of the failure. Two things fail the check. The plan gives an ID to
 * no stage. An issue claims an ID that no stage holds.
 */
export function failureLines(result: Reconciliation): readonly string[] {
	return [...unstagedLines(result), ...unstagedClaimLines(result)];
}

/** The lines that name the test IDs that no stage holds. */
function unstagedLines(result: Reconciliation): readonly string[] {
	if (result.unstaged.length === 0) {
		return [];
	}
	const lines = [
		say(
			`the count of test IDs that no stage holds is ${String(result.unstaged.length)}. Give each of these IDs to a stage of Part 8, or take the ID out of the plan.`,
		),
	];
	for (const row of group(result.unstaged)) {
		lines.push(`  ${row}`);
	}
	return lines;
}

/** The lines that name the claims of an ID that no stage holds. */
function unstagedClaimLines(result: Reconciliation): readonly string[] {
	if (result.unstagedClaims.length === 0) {
		return [];
	}
	const lines: string[] = [];
	for (const claim of result.unstagedClaims) {
		lines.push(
			say(
				`issue #${String(claim.issue)} claims ${claim.id}, and no stage holds ${claim.id}`,
			),
		);
	}
	lines.push(
		say(
			`the count of claims of an ID that no stage holds is ${String(result.unstagedClaims.length)}. Correct the claim of each issue, or give the ID to a stage of Part 8.`,
		),
	);
	return lines;
}

/** The name that the check prints in front of each line that it says. */
export function say(text: string): string {
	return `stage check: ${text}`;
}

/** A count and the thing that it counts, with the plural of that thing. */
function count(items: readonly unknown[], thing: string): string {
	return plural(items.length, thing);
}

/** A number and the thing that it counts, with the plural of that thing. */
function plural(total: number, thing: string): string {
	return `${String(total)} ${thing}${total === 1 ? '' : 's'}`;
}

/** A list of stage numbers, with the word and in front of the last one. */
function numbers(stages: readonly number[]): string {
	const sorted = [...stages].sort((left, right) => left - right).map(String);
	const last = sorted[sorted.length - 1];
	if (last === undefined) {
		return 'no stage';
	}
	if (sorted.length === 1) {
		return `stage ${last}`;
	}
	return `stages ${sorted.slice(0, -1).join(', ')} and ${last}`;
}

/** The IDs of one prefix on one line, and one line for each prefix. */
function group(ids: readonly string[]): readonly string[] {
	const rows = new Map<string, string[]>();
	for (const id of ids) {
		const prefix = prefixOf(id);
		const row = rows.get(prefix) ?? [];
		row.push(id);
		rows.set(prefix, row);
	}
	return [...rows.values()].map((row) => row.join(' '));
}
