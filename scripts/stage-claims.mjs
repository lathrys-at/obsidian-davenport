/**
 * The test plan gives each test ID to a stage, and the issue tree gives each
 * test ID to a milestone. The two must say the same thing. This check compares
 * them.
 *
 * The check reads the stage lists of Part 8 of the test plan. It then reads
 * the claim line of each issue body, and the milestone of each issue states
 * the stage of that claim. Two things fail the check. The plan gives a test ID
 * to no stage. An issue claims an ID that no stage holds.
 *
 * The check reports, and does not fail on, each disagreement between a stage
 * list and a milestone. Staging moves as the work proceeds, so a disagreement
 * is a thing to read and not a build to stop. The check also fails when the
 * plan or the issue tree gives it nothing to compare. Therefore a change to
 * the format of either one turns this check red, and it never leaves a check
 * that reads nothing and reports success.
 *
 * The check compares the test IDs. The plan does not give the sweeps and the
 * appendix items to the stages one by one, so the check passes over those IDs.
 *
 * The check reads the plan from a file, and it reads the issues from GitHub
 * through the GitHub command line tool. A machine with no credentials and no
 * network runs the first half alone, and the check says that it did. The
 * option --require-issues makes an issue half that cannot run a failure. The
 * workflow that runs this check uses that option.
 *
 * The option --issues=<file> reads the issues from a file. The file holds the
 * answer of the command, which is a list of issues in JSON. Then the check
 * runs over a set of issues that a person keeps, and the tests of the check
 * reach no server.
 *
 * The check reads the plan of this repository. If you give a path, the check
 * reads that plan instead. Then the same rules run over a plan in any
 * location.
 *
 *     node scripts/stage-claims.mjs
 *     node scripts/stage-claims.mjs --require-issues
 *     node scripts/stage-claims.mjs --issues=answer.json <plan-file>
 *
 * This file finds the plan, gets the issues, prints the report, and sets the
 * exit status. `stage-claims-core.ts` holds the rules of the stage lists, the
 * rules of the claims, and the comparison. `stage-claims-issues.ts` gets the
 * issues. `stage-claims-text.ts` holds the wording that the check prints.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planFaults, readPlan } from './plan-ids-core.ts';
import {
	claimFaults,
	readClaims,
	readStages,
	reconcile,
	stageFaults,
} from './stage-claims-core.ts';
import { getIssues, readAnswer } from './stage-claims-issues.ts';
import {
	adjudicatedLines,
	claimLines,
	disagreementLines,
	failureLines,
	faultLines,
	issueFaultLines,
	offlineLines,
	passedLines,
	say,
	sourceLines,
	stageLines,
} from './stage-claims-text.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLAN = 'docs/davenport-test-plan.md';

/** The claims of a run that did not read the issues. */
const NO_CLAIM = {
	claims: [],
	trailers: 0,
	loose: [],
	milestones: new Map(),
};

/** The reason that an error carries. */
function said(error) {
	return error instanceof Error ? error.message : String(error);
}

function fail(lines) {
	for (const line of lines) {
		console.error(line);
	}
	process.exit(1);
}

const args = process.argv.slice(2);
const required = args.includes('--require-issues');
const answerPath = args
	.find((arg) => arg.startsWith('--issues='))
	?.slice('--issues='.length);
const planPath = args.find((arg) => !arg.startsWith('--')) ?? join(ROOT, PLAN);

let text;
try {
	text = readFileSync(planPath, 'utf8');
} catch (error) {
	fail([
		say(
			`the check cannot read the plan file at ${planPath}: ${said(error)}`,
		),
	]);
}

const plan = readPlan(text);
if (planFaults(plan).length > 0) {
	fail([
		say(
			'the plan gives the check no vocabulary of IDs. Run node scripts/plan-ids.mjs, and that check names each fault of the plan.',
		),
	]);
}

const stages = readStages(text, plan);
const faults = faultLines(stageFaults(stages));
if (faults.length > 0) {
	fail(faults);
}

for (const line of stageLines(plan, stages)) {
	console.log(line);
}
for (const line of passedLines(stages)) {
	console.log(line);
}

let issues;
let reason;
try {
	issues =
		answerPath === undefined
			? getIssues()
			: readAnswer(readFileSync(answerPath, 'utf8'));
} catch (error) {
	reason = said(error);
}

if (issues === undefined) {
	const result = reconcile(plan, stages, NO_CLAIM);
	for (const line of offlineLines(reason ?? 'the check gave no reason')) {
		console.log(line);
	}
	const failures = failureLines(result);
	if (failures.length > 0 || required) {
		fail([
			...failures,
			...(required
				? [
						say(
							'the check ran with --require-issues, and the check could not read the issues.',
						),
					]
				: []),
		]);
	}
	process.exit(0);
}

const scan = readClaims(issues, plan);
const issueFaults = issueFaultLines(claimFaults(issues, scan));
if (issueFaults.length > 0) {
	fail(issueFaults);
}

const result = reconcile(plan, stages, scan);
for (const line of [
	...sourceLines(answerPath),
	...claimLines(scan),
	...disagreementLines(result),
	...adjudicatedLines(result),
]) {
	console.log(line);
}

const failures = failureLines(result);
if (failures.length > 0) {
	fail(failures);
}
