/**
 * The decisions behind the stage-and-claim traceability check:
 *
 * - which test IDs each stage of the plan holds;
 * - which forms a list of IDs uses, and what each form means;
 * - what the check does with a plan that gives it no stage list;
 * - which line of an issue body states the claim of that issue;
 * - what the check does with issues that carry no claim;
 * - what the comparison of the two sets says;
 * - the wording that the check prints around all of that;
 * - which exit status a run of the script gives.
 *
 * The tests of the stage lists run against the real plan, and not against a
 * copy of it. A copy would drift, and then the tests would prove the copy. The
 * plan is a file of this repository, so a test can hold it to a number.
 *
 * The issues are not a file of this repository. They change when nobody
 * changes the tree, so no test here holds them to a number, and no test here
 * reaches GitHub. The tests of the claims build their own issues. The tests of
 * the command supply a host of their own. The tests of the script give it a
 * file of issues.
 *
 * The script itself only finds the files and gets the issues. A run can end in
 * several ways, and these tests exercise each way as a process. The interface
 * includes the exit status, and not only the words that the run prints.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { readPlan } from '../scripts/plan-ids-core';
import type {
	Adjudicated,
	ClaimScan,
	Issue,
	StageCorpus,
} from '../scripts/stage-claims-core';
import {
	ADJUDICATED,
	claimFaults,
	readClaims,
	readEntry,
	readStages,
	reconcile,
	stageFaults,
} from '../scripts/stage-claims-core';
import type { CommandResult, IssueHost } from '../scripts/stage-claims-issues';
import {
	ANSWERS,
	commandArgs,
	getIssues,
	readAnswer,
	WINDOWS_ABORT_STATUS,
} from '../scripts/stage-claims-issues';
import {
	adjudicatedLines,
	claimLines,
	disagreementLines,
	failureLines,
	faultLines,
	issueFaultLines,
	offlineLines,
	passedLines,
	sourceLines,
	stageLines,
} from '../scripts/stage-claims-text';
import { runNode } from './harness/run-node';

const PLAN_PATH = fileURLToPath(
	new URL('../docs/davenport-test-plan.md', import.meta.url),
);
const SCRIPT = fileURLToPath(
	new URL('../scripts/stage-claims.mjs', import.meta.url),
);

const PLAN = readPlan(readFileSync(PLAN_PATH, 'utf8'));
const STAGES = readStages(readFileSync(PLAN_PATH, 'utf8'), PLAN);

/** A plan of two suites, in the shape of the real plan. */
const SMALL_TEXT = [
	'## Part 5 — Suites',
	'',
	'### 5.1 First suite [QQ] — §1.1',
	'',
	'- **QQ-1 [D]** The first item.',
	'- **QQ-2 [E]** The second item.',
	'- **QQ-3** The third item.',
	'',
	'### 5.2 Second suite [ZQ] — §1.2',
	'',
	'- **ZQ-1** The first item.',
	'- **ZQ-2** The second item.',
	'',
	'## Part 8 — Ordering and stage gates',
	'',
	'- **Stage 1 (the first stage):** QQ complete except QQ-3, ZQ-1. Consumes: B-1.',
	'- **Stage 2 (the second stage):** ZQ, QQ-3.',
].join('\n');
const SMALL = readPlan(SMALL_TEXT);
const SMALL_STAGES = readStages(SMALL_TEXT, SMALL);

/** The IDs of one stage, in the order of the plan. */
function heldBy(corpus: StageCorpus, stage: number): readonly string[] {
	return corpus.holds
		.filter((hold) => hold.stage === stage)
		.map((hold) => hold.id);
}

/** The stages that hold one ID. */
function stagesOf(corpus: StageCorpus, id: string): readonly number[] {
	return corpus.holds
		.filter((hold) => hold.id === id)
		.map((hold) => hold.stage);
}

/** An issue with a claim line, in the shape of a real issue. */
function issueOf(
	number: number,
	milestone: string | undefined,
	claim: string,
): Issue {
	return {
		number,
		title: `feat: the work of ${String(number)}`,
		body: ['The problem.', '', `- Test plan: ${claim}`, ''].join('\n'),
		milestone,
	};
}

describe('the test IDs that each stage holds', () => {
	it('takes the number and the name of every stage', () => {
		expect(STAGES.stages.map((stage) => stage.number)).toEqual([
			1, 2, 3, 4, 5, 6, 7,
		]);
		expect(STAGES.stages[0]?.label).toBe('feeds, read path');
	});

	// The stage lists are the second traceability surface of the plan. Every
	// test ID must reach a stage, or the plan schedules nothing for it.
	it('gives every test ID of the real plan to a stage', () => {
		const held = new Set(STAGES.holds.map((hold) => hold.id));
		expect(PLAN.suiteIds).toHaveLength(227);
		expect(held.size).toBe(227);
	});

	it('keeps the sweeps and the appendix items out of the holds', () => {
		const held = new Set(STAGES.holds.map((hold) => hold.id));
		for (const id of PLAN.otherIds) {
			expect(held.has(id)).toBe(false);
		}
	});

	it('reads the items that a stage consumes', () => {
		expect(STAGES.stages[1]?.consumes).toContain('A-11');
		expect(STAGES.stages[0]?.consumes).not.toContain('A-11');
	});

	it('takes the whole suite from a tag, and the named ID from an entry', () => {
		expect(heldBy(SMALL_STAGES, 1)).toEqual(['QQ-1', 'QQ-2', 'ZQ-1']);
		expect(heldBy(SMALL_STAGES, 2)).toEqual(['QQ-3', 'ZQ-1', 'ZQ-2']);
	});

	it('names the test IDs that more than one stage holds', () => {
		expect(SMALL_STAGES.splitHalves).toEqual(['ZQ-1']);
		expect(stagesOf(SMALL_STAGES, 'ZQ-1')).toEqual([1, 2]);
	});

	// The plan gives some IDs to more than one stage. The count below is the
	// count of the real plan under the rules of this check.
	it('counts the split halves of the real plan', () => {
		expect(STAGES.splitHalves).toHaveLength(31);
		expect(stagesOf(STAGES, 'UI-11')).toEqual([3, 4]);
		expect(stagesOf(STAGES, 'IN-13')).toEqual([1, 3, 4]);
	});

	it('holds an ID one time for one stage, and not one time for each mention', () => {
		expect(stagesOf(STAGES, 'PU-7')).toEqual([3, 4]);
	});
});

describe('the forms that a list of IDs uses', () => {
	it('takes one ID that the entry names', () => {
		const entry = readEntry('DL-3', PLAN);
		expect(entry.named).toEqual(['DL-3']);
		expect(entry.expanded).toEqual([]);
	});

	it('takes a range that counts up from one number to another', () => {
		expect(readEntry('ID-1..ID-6', PLAN).named).toEqual([
			'ID-1',
			'ID-2',
			'ID-3',
			'ID-4',
			'ID-5',
			'ID-6',
		]);
	});

	it('takes a range whose second end carries no prefix', () => {
		expect(readEntry('FM-1..4', PLAN).named).toEqual([
			'FM-1',
			'FM-2',
			'FM-3',
			'FM-4',
		]);
	});

	// A range across two suites means nothing, and a range that counts down
	// means nothing. The reader then takes the two ends as two plain IDs, so
	// the entry loses no ID that a person wrote.
	it.each([
		['a range across two suites', 'FM-1..LG-3', ['FM-1', 'LG-3']],
		['a range that counts down', 'FM-5..2', ['FM-5']],
	])('reads %s as its two ends', (_what, text, wanted) => {
		expect(readEntry(text, PLAN).named).toEqual(wanted);
	});

	it('takes a group of numbers behind one prefix', () => {
		expect(readEntry('UI-1/2/8', PLAN).named).toEqual([
			'UI-1',
			'UI-2',
			'UI-8',
		]);
	});

	it('takes a group that writes the prefix again', () => {
		expect(readEntry('TS-6/TS-7', PLAN).named).toEqual(['TS-6', 'TS-7']);
	});

	it('takes a group whose members carry different prefixes', () => {
		expect(readEntry('UI-2/IV-12', PLAN).named).toEqual(['UI-2', 'IV-12']);
	});

	it('takes a range and a group in one entry', () => {
		expect(readEntry('RG-1..RG-3/RG-5/RG-7..RG-10', PLAN).named).toEqual([
			'RG-1',
			'RG-2',
			'RG-3',
			'RG-7',
			'RG-8',
			'RG-9',
			'RG-10',
			'RG-5',
		]);
	});

	it('takes the whole suite from a tag that opens the entry', () => {
		expect(readEntry('QQ complete', SMALL).expanded).toEqual([
			'QQ-1',
			'QQ-2',
			'QQ-3',
		]);
	});

	it('takes the whole suite from a tag that stands alone', () => {
		expect(readEntry('ZQ', SMALL).expanded).toEqual(['ZQ-1', 'ZQ-2']);
	});

	it('takes the whole suite from a tag behind the word and', () => {
		expect(readEntry('and ZQ', SMALL).expanded).toEqual(['ZQ-1', 'ZQ-2']);
	});

	it('takes IDs back out of the suite after the word except', () => {
		const entry = readEntry('QQ complete except QQ-3 (a reason)', SMALL);
		expect(entry.expanded).toEqual(['QQ-1', 'QQ-2']);
		expect(entry.removed).toEqual(['QQ-3']);
		expect(entry.named).toEqual([]);
	});

	// A suite tag inside a phrase names a thing, and it does not name a list
	// of IDs. The check gives the stage the IDs of the entry, and it reports
	// the tag that it passed over.
	it('passes over a suite tag that does not open the entry', () => {
		const entry = readEntry('and the group of ZQ (the ZQ-1 table)', SMALL);
		expect(entry.expanded).toEqual([]);
		expect(entry.named).toEqual(['ZQ-1']);
		expect(entry.passed).toEqual(['ZQ']);
	});

	// An entry that opens with a suite tag gives the stage that whole suite.
	// An ID of the same suite inside the entry then says where a member
	// started, and it claims nothing of its own.
	it('names no ID of the suite that opens the entry', () => {
		const entry = readEntry(
			'ZQ complete (the ZQ-1 display is live from stage 1)',
			SMALL,
		);
		expect(entry.named).toEqual([]);
		expect(entry.expanded).toEqual(['ZQ-1', 'ZQ-2']);
	});

	it('names an ID of another suite inside such an entry', () => {
		const entry = readEntry('ZQ complete (with QQ-1)', SMALL);
		expect(entry.named).toEqual(['QQ-1']);
		expect(entry.expanded).toEqual(['ZQ-1', 'ZQ-2']);
	});

	// A comma inside brackets ends nothing. The words inside the brackets
	// qualify the entry that carries them.
	it('keeps an entry whole across a comma inside brackets', () => {
		const stages = readStages(
			[
				'## Part 8 — Ordering',
				'- **Stage 1 (one):** QQ complete except QQ-3, ZQ-1 (a first reason, a second reason).',
			].join('\n'),
			SMALL,
		);
		expect(heldBy(stages, 1)).toEqual(['QQ-1', 'QQ-2', 'ZQ-1']);
	});

	it('reads no ID out of a technical word of the same shape', () => {
		const entry = readEntry(
			'the digest is SHA-256 and the text is UTF-8',
			PLAN,
		);
		expect(entry.named).toEqual([]);
	});

	it('reads no ID out of a prefix that the plan never defines', () => {
		expect(readEntry('XX-1 and XX-2', PLAN).named).toEqual([]);
	});
});

describe('a plan that gives the check no stage list', () => {
	it('finds no fault in the real plan', () => {
		expect(stageFaults(STAGES)).toEqual([]);
	});

	it('reports a plan that holds no part of ordering', () => {
		const corpus = readStages(
			SMALL_TEXT.split('## Part 8')[0] ?? '',
			SMALL,
		);
		expect(stageFaults(corpus)).toEqual([
			{ kind: 'no-part' },
			{ kind: 'no-stage' },
		]);
	});

	it('reports a part that declares no stage', () => {
		const corpus = readStages(
			['## Part 8 — Ordering', 'The stages are elsewhere.'].join('\n'),
			SMALL,
		);
		expect(stageFaults(corpus)).toEqual([
			{ kind: 'no-part' },
			{ kind: 'no-stage' },
		]);
	});

	// A stage that lost its list holds nothing, and a comparison against
	// nothing passes. The check must catch that shape.
	it('reports a stage that holds no test ID', () => {
		const corpus = readStages(
			[
				'## Part 8 — Ordering',
				'- **Stage 1 (one):** QQ complete.',
				'- **Stage 2 (two):** the rest lands here.',
			].join('\n'),
			SMALL,
		);
		expect(stageFaults(corpus)).toEqual([
			{ kind: 'empty-stage', stage: 2 },
		]);
	});

	it('states each fault and the consequence of the faults', () => {
		const lines = faultLines(stageFaults(readStages('', SMALL))).join('\n');
		expect(lines).toContain('the plan holds no part of ordering');
		expect(lines).toContain('the plan declares no stage');
		expect(lines).toContain(
			'The comparison did not run. The plan failed the checks above.',
		);
	});

	it('says nothing about a plan that carries its stage lists', () => {
		expect(faultLines(stageFaults(STAGES))).toEqual([]);
	});
});

describe('the claims that an issue body carries', () => {
	it('takes the IDs of the claim line and the stage of the milestone', () => {
		const scan = readClaims(
			[issueOf(7, 'M2 — Stage 2: the second stage', 'ZQ-1, QQ-3')],
			SMALL,
		);
		expect(scan.claims).toEqual([
			{
				issue: 7,
				milestone: 'M2 — Stage 2: the second stage',
				stage: 2,
				id: 'ZQ-1',
			},
			{
				issue: 7,
				milestone: 'M2 — Stage 2: the second stage',
				stage: 2,
				id: 'QQ-3',
			},
		]);
		expect(scan.trailers).toBe(1);
	});

	// The body of an issue names an ID for many reasons. It gives the reason
	// for the work, it points at a neighbour, and it says which milestone
	// delivers another half. Only the claim line states a claim.
	it('reads no claim out of the prose of a body', () => {
		const scan = readClaims(
			[
				{
					number: 8,
					title: 'feat: the work',
					body: [
						'Stage 2 delivers the other half (ZQ-2).',
						'The condition of QQ-2 stands here.',
						'',
						'- Test plan: QQ-1',
					].join('\n'),
					milestone: 'M1 — Stage 1: the first stage',
				},
			],
			SMALL,
		);
		expect(scan.claims.map((claim) => claim.id)).toEqual(['QQ-1']);
	});

	it('reads the claim line that stands in bold', () => {
		const scan = readClaims(
			[
				{
					number: 9,
					title: 'feat: the work',
					body: '- **Test plan**: QQ-1',
					milestone: 'M1 — Stage 1: the first stage',
				},
			],
			SMALL,
		);
		expect(scan.claims.map((claim) => claim.id)).toEqual(['QQ-1']);
	});

	it('passes over an issue that carries no claim line', () => {
		const scan = readClaims(
			[
				{
					number: 10,
					title: 'chore: the tool',
					body: 'The tool needs a fix. QQ-1 is not the subject.',
					milestone: 'M1 — Stage 1: the first stage',
				},
			],
			SMALL,
		);
		expect(scan.claims).toEqual([]);
		expect(scan.trailers).toBe(0);
	});

	// A claim line names the parts of the plan as well as the IDs. The check
	// compares the test IDs, so it takes those alone.
	it('takes no sweep and no appendix item out of a claim line', () => {
		const scan = readClaims(
			[issueOf(11, 'M1 — Stage 1: one', 'FM-1, Part 6.1; A-16, IV-13')],
			PLAN,
		);
		expect(scan.claims.map((claim) => claim.id)).toEqual(['FM-1']);
	});

	it('keeps a claim of an ID that the plan does not contain', () => {
		const scan = readClaims(
			[issueOf(12, 'M1 — Stage 1: one', 'FM-999')],
			PLAN,
		);
		expect(scan.claims.map((claim) => claim.id)).toEqual(['FM-999']);
	});

	it('names the milestone of each stage', () => {
		const scan = readClaims(
			[
				issueOf(13, 'M1 — Stage 1: the first stage', 'QQ-1'),
				issueOf(14, 'M2 — Stage 2: the second stage', 'ZQ-2'),
			],
			SMALL,
		);
		expect([...scan.milestones]).toEqual([
			[1, ['M1 — Stage 1: the first stage']],
			[2, ['M2 — Stage 2: the second stage']],
		]);
	});

	// A milestone that names no stage gives the check nothing to compare. The
	// check reports the issue rather than dropping the claim in silence.
	it.each([
		['a milestone with no stage in its name', 'M0 — Foundations'],
		['no milestone at all', undefined],
	])('reports an issue with %s', (_what, milestone) => {
		const scan = readClaims([issueOf(15, milestone, 'QQ-1')], SMALL);
		expect(scan.claims).toEqual([]);
		expect(scan.loose).toEqual([{ issue: 15, milestone, ids: ['QQ-1'] }]);
	});

	it('passes over such an issue when the claim names no test ID', () => {
		const scan = readClaims(
			[issueOf(16, 'M0 — Foundations', 'Part 6.1, A-11')],
			PLAN,
		);
		expect(scan.loose).toEqual([]);
		expect(scan.trailers).toBe(1);
	});
});

describe('issues that give the check nothing to compare', () => {
	it('finds no fault in a set of issues that carries a claim', () => {
		const issues = [issueOf(17, 'M1 — Stage 1: one', 'QQ-1')];
		expect(claimFaults(issues, readClaims(issues, SMALL))).toEqual([]);
	});

	it('reports a set of issues that holds no issue', () => {
		expect(claimFaults([], readClaims([], SMALL))).toEqual([
			{ kind: 'no-issue' },
			{ kind: 'no-trailer' },
		]);
	});

	// A set of issues whose bodies lost the claim line makes every comparison
	// empty, and an empty comparison passes.
	it('reports a set of issues in which no body carries a claim line', () => {
		const issues: Issue[] = [
			{
				number: 18,
				title: 'feat: the work',
				body: 'The body says QQ-1 and states no claim.',
				milestone: 'M1 — Stage 1: one',
			},
		];
		expect(claimFaults(issues, readClaims(issues, SMALL))).toEqual([
			{ kind: 'no-trailer' },
		]);
	});

	it('states each fault and the consequence of the faults', () => {
		const lines = issueFaultLines(
			claimFaults([], readClaims([], SMALL)),
		).join('\n');
		expect(lines).toContain('the repository gave no issue');
		expect(lines).toContain('no issue carries a claim line');
		expect(lines).toContain(
			'The comparison did not run. The issues failed the checks above.',
		);
	});
});

describe('what the stage lists and the claims say about each other', () => {
	/** The comparison of one set of issues against the small plan. */
	function compare(
		issues: readonly Issue[],
		adjudicated: readonly Adjudicated[] = [],
	) {
		return reconcile(
			SMALL,
			SMALL_STAGES,
			readClaims(issues, SMALL),
			adjudicated,
		);
	}

	it('finds no unstaged ID in the real plan', () => {
		const empty: ClaimScan = {
			claims: [],
			trailers: 0,
			loose: [],
			milestones: new Map(),
		};
		expect(reconcile(PLAN, STAGES, empty).unstaged).toEqual([]);
	});

	it('reports a test ID that no stage holds', () => {
		const text = [
			'### 5.1 First suite [QQ] — §1',
			'- **QQ-1 [D]** One.',
			'- **QQ-2 [D]** Two.',
			'## Part 8 — Ordering',
			'- **Stage 1 (one):** QQ-1.',
		].join('\n');
		const plan = readPlan(text);
		const result = reconcile(plan, readStages(text, plan), {
			claims: [],
			trailers: 0,
			loose: [],
			milestones: new Map(),
		});
		expect(result.unstaged).toEqual(['QQ-2']);
	});

	it('reports a claim of an ID that no stage holds', () => {
		const result = compare([issueOf(20, 'M1 — Stage 1: one', 'QQ-9')]);
		expect(result.unstagedClaims).toEqual([
			{ issue: 20, milestone: 'M1 — Stage 1: one', stage: 1, id: 'QQ-9' },
		]);
	});

	// The plan gives some IDs to more than one stage. A claim for one stage
	// therefore leaves the other stages open, and the comparison asks its
	// question one time for each pair of an ID and a stage.
	it('gives a split-half ID a claim status for each stage', () => {
		const result = compare([issueOf(21, 'M1 — Stage 1: one', 'ZQ-1')]);
		expect(
			result.unclaimed.map((item) => `${item.id}@${String(item.stage)}`),
		).toContain('ZQ-1@2');
		expect(
			result.unclaimed.map((item) => `${item.id}@${String(item.stage)}`),
		).not.toContain('ZQ-1@1');
	});

	it('keeps every pair of each set, and not the counts alone', () => {
		const result = compare([
			issueOf(22, 'M1 — Stage 1: one', 'QQ-1, QQ-2, ZQ-1'),
			issueOf(23, 'M2 — Stage 2: two', 'QQ-3, ZQ-2'),
		]);
		expect(
			result.unclaimed.map((item) => `${item.id}@${String(item.stage)}`),
		).toEqual(['ZQ-1@2']);
		expect(result.unheld).toEqual([]);
	});

	it('reports a claim that the stage of its milestone does not hold', () => {
		const result = compare([issueOf(24, 'M2 — Stage 2: two', 'QQ-1')]);
		expect(result.unheld).toEqual([
			{
				id: 'QQ-1',
				stage: 2,
				named: true,
				stages: [1],
				claimed: [2],
				issues: [24],
			},
		]);
	});

	it('names every issue that makes one claim that no stage holds', () => {
		const result = compare([
			issueOf(25, 'M2 — Stage 2: two', 'QQ-1'),
			issueOf(26, 'M2 — Stage 2: two', 'QQ-1'),
		]);
		expect(result.unheld.map((item) => item.issues)).toEqual([[25, 26]]);
	});

	// A stage that names an ID asks for that ID. A stage that names a suite
	// asks for the suite, and an earlier stage can have delivered a member of
	// that suite already. The report separates the two.
	it('says whether the stage named the ID or a suite tag gave it', () => {
		const result = compare([]);
		const named = result.unclaimed.find((item) => item.id === 'ZQ-1');
		const spread = result.unclaimed.find((item) => item.id === 'QQ-1');
		expect(named?.named).toBe(true);
		expect(spread?.named).toBe(false);
	});

	it('names the stages whose milestones claim the ID', () => {
		const result = compare([issueOf(27, 'M1 — Stage 1: one', 'ZQ-1')]);
		expect(
			result.unclaimed.find((item) => item.id === 'ZQ-1')?.claimed,
		).toEqual([1]);
	});

	it('names the test IDs that no issue claims for any stage', () => {
		const result = compare([issueOf(28, 'M1 — Stage 1: one', 'QQ-1')]);
		expect(result.neverClaimed).toEqual(['QQ-2', 'QQ-3', 'ZQ-1', 'ZQ-2']);
	});

	it('holds back a disagreement that a person adjudicated', () => {
		const entry: Adjudicated = {
			id: 'ZQ-1',
			stage: 2,
			reason: 'Stage 1 delivers the item, and stage 2 states the gate.',
		};
		const result = compare(
			[issueOf(29, 'M1 — Stage 1: one', 'ZQ-1')],
			[entry],
		);
		expect(result.applied).toEqual([entry]);
		expect(result.stale).toEqual([]);
		expect(result.unclaimed.map((item) => item.id)).not.toContain('ZQ-1');
	});

	// An adjudicated mention that meets no disagreement is out of date. The
	// check names it, so that nobody keeps a ruling about a thing that moved.
	it('names an adjudicated mention that meets no disagreement', () => {
		const entry: Adjudicated = {
			id: 'ZQ-2',
			stage: 2,
			reason: 'A reason that no longer applies.',
		};
		const result = compare(
			[issueOf(30, 'M2 — Stage 2: two', 'ZQ-2')],
			[entry],
		);
		expect(result.applied).toEqual([]);
		expect(result.stale).toEqual([entry]);
	});

	// The three mentions below are the ones that a person adjudicated. Each
	// one must still meet a disagreement of the real tree, or the entry is out
	// of date.
	it('states one reason for each adjudicated mention', () => {
		expect(ADJUDICATED).toHaveLength(3);
		for (const entry of ADJUDICATED) {
			expect(PLAN.suiteIds).toContain(entry.id);
			expect(stagesOf(STAGES, entry.id)).toContain(entry.stage);
			expect(entry.reason.length).toBeGreaterThan(20);
		}
	});
});

describe('what the check prints', () => {
	const scan = readClaims(
		[issueOf(31, 'M1 — Stage 1: the first stage', 'QQ-1, QQ-2')],
		SMALL,
	);
	const result = reconcile(SMALL, SMALL_STAGES, scan, []);

	it('states the counts of the stage lists', () => {
		const lines = stageLines(SMALL, SMALL_STAGES).join('\n');
		expect(lines).toContain(
			'the plan declares 2 stages. The stages hold 5 of the 5 test IDs of the plan.',
		);
		expect(lines).toContain(
			'the count of test IDs that more than one stage holds is 1',
		);
	});

	it('states that the sweeps and the appendix items stand outside', () => {
		expect(stageLines(SMALL, SMALL_STAGES).join('\n')).toContain(
			'the check passes over those IDs',
		);
	});

	it('names each suite tag that it passed over, and the entry that holds it', () => {
		const corpus = readStages(
			[
				'## Part 8 — Ordering',
				'- **Stage 1 (one):** QQ complete, and the group of ZQ (the ZQ-1 table).',
			].join('\n'),
			SMALL,
		);
		const lines = passedLines(corpus).join('\n');
		expect(lines).toContain('stage 1 names the suite ZQ inside an entry');
		expect(lines).toContain('entry: and the group of ZQ (the ZQ-1 table)');
	});

	it('says nothing about a plan whose entries name no loose suite tag', () => {
		expect(passedLines(SMALL_STAGES)).toEqual([]);
	});

	it('states where the issues came from', () => {
		expect(sourceLines(undefined).join('\n')).toContain(
			'through the GitHub command line tool',
		);
		expect(sourceLines('answer.json').join('\n')).toContain(
			'from the file answer.json',
		);
	});

	it('states the counts of the claims and names the milestone of each stage', () => {
		const lines = claimLines(scan);
		expect(lines.join('\n')).toContain(
			'the check read a claim line in 1 issue',
		);
		expect(lines.join('\n')).toContain('2 claims of a test ID');
		expect(lines).toContain('  stage 1: M1 — Stage 1: the first stage');
	});

	it('names each ID that a stage names and its milestone does not claim', () => {
		const lines = disagreementLines(result).join('\n');
		expect(lines).toContain(
			'stage 1 names ZQ-1, and no issue of the milestone of stage 1 claims ZQ-1',
		);
		expect(lines).toContain('no issue claims ZQ-1 for any stage');
	});

	it('groups the IDs that a suite name gave to a stage', () => {
		const lines = disagreementLines(result).join('\n');
		expect(lines).toContain(
			'the count of test IDs that a suite name gave to a stage, and that no issue of the milestone of that stage claims, is 2',
		);
		expect(lines).toContain('stage 2: ZQ-1 ZQ-2');
	});

	it('names each claim that the stage of its milestone does not hold', () => {
		const other = readClaims(
			[issueOf(32, 'M2 — Stage 2: the second stage', 'QQ-1')],
			SMALL,
		);
		const lines = disagreementLines(
			reconcile(SMALL, SMALL_STAGES, other, []),
		).join('\n');
		expect(lines).toContain(
			'issue #32 claims QQ-1 for stage 2, and stage 2 does not hold QQ-1',
		);
		expect(lines).toContain('the stages that hold QQ-1: stage 1');
	});

	// The report must not read as a build to fix. Staging moves as the work
	// proceeds, and the check says so every time it reports a disagreement.
	it('states that a disagreement fails nothing', () => {
		expect(disagreementLines(result).join('\n')).toContain(
			'a disagreement here fails nothing',
		);
	});

	it('states the state in which the two sets agree', () => {
		const full = readClaims(
			[
				issueOf(33, 'M1 — Stage 1: one', 'QQ-1, QQ-2, ZQ-1'),
				issueOf(34, 'M2 — Stage 2: two', 'QQ-3, ZQ-1, ZQ-2'),
			],
			SMALL,
		);
		const agreed = reconcile(SMALL, SMALL_STAGES, full, []);
		expect(disagreementLines(agreed).join('\n')).toContain(
			'every stage that holds a test ID has an issue of its milestone that claims that ID',
		);
	});

	it('names each adjudicated mention and its reason', () => {
		const entry: Adjudicated = {
			id: 'ZQ-1',
			stage: 2,
			reason: 'Stage 1 delivers the item, and stage 2 states the gate.',
		};
		const held = reconcile(SMALL, SMALL_STAGES, scan, [entry]);
		const lines = adjudicatedLines(held).join('\n');
		expect(lines).toContain('the check met 1 adjudicated mention');
		expect(lines).toContain('ZQ-1 at stage 2: Stage 1 delivers the item');
	});

	it('asks for the removal of an adjudicated mention that is out of date', () => {
		const entry: Adjudicated = {
			id: 'QQ-2',
			stage: 1,
			reason: 'A reason that no longer applies.',
		};
		const lines = adjudicatedLines(
			reconcile(SMALL, SMALL_STAGES, scan, [entry]),
		).join('\n');
		expect(lines).toContain('meets no disagreement in this run');
		expect(lines).toContain('scripts/stage-claims-core.ts');
	});

	it('names the file, the ID and the remedy of each failure', () => {
		const text = [
			'### 5.1 First suite [QQ] — §1',
			'- **QQ-1 [D]** One.',
			'- **QQ-2 [D]** Two.',
			'## Part 8 — Ordering',
			'- **Stage 1 (one):** QQ-1.',
		].join('\n');
		const plan = readPlan(text);
		const failed = reconcile(
			plan,
			readStages(text, plan),
			readClaims([issueOf(35, 'M1 — Stage 1: one', 'QQ-9')], plan),
		);
		const lines = failureLines(failed).join('\n');
		expect(lines).toContain(
			'the count of test IDs that no stage holds is 1',
		);
		expect(lines).toContain('QQ-2');
		expect(lines).toContain(
			'issue #35 claims QQ-9, and no stage holds QQ-9',
		);
		expect(lines).toContain(
			'the count of claims of an ID that no stage holds is 1',
		);
	});

	it('says nothing when the two sets hold every ID', () => {
		expect(failureLines(result)).toEqual([]);
	});

	it('states plainly that it did not read the issues', () => {
		const lines = offlineLines('the tool is not on this machine').join(
			'\n',
		);
		expect(lines).toContain('the check cannot read the issues');
		expect(lines).toContain('the tool is not on this machine');
		expect(lines).toContain('it compared nothing against the issues');
	});
});

describe('the issues that the command gives', () => {
	/** A host that gives one answer to every run. */
	function host(result: CommandResult, platform = 'linux'): IssueHost {
		return { platform, run: () => result };
	}

	it('asks for every issue, with the fields that the check reads', () => {
		expect(commandArgs(50)).toEqual([
			'issue',
			'list',
			'--state',
			'all',
			'--limit',
			'50',
			'--json',
			'number,title,body,milestone',
		]);
	});

	it('gives one status as an answer', () => {
		expect(ANSWERS).toEqual([0]);
	});

	it('reads the issues of an answer', () => {
		const answer = JSON.stringify([
			{
				number: 1,
				title: 'feat: one',
				body: '- Test plan: QQ-1',
				milestone: { title: 'M1 — Stage 1: one' },
			},
		]);
		expect(
			getIssues(host({ status: 0, stdout: answer, stderr: '' }), 10),
		).toEqual([
			{
				number: 1,
				title: 'feat: one',
				body: '- Test plan: QQ-1',
				milestone: 'M1 — Stage 1: one',
			},
		]);
	});

	it('reads an issue that carries no milestone', () => {
		const answer = JSON.stringify([
			{ number: 2, title: 'feat: two', body: '', milestone: null },
		]);
		expect(readAnswer(answer)[0]?.milestone).toBeUndefined();
	});

	// An empty output is an answer only with the status 0. A tool that the
	// host could not start also leaves an empty output, and a repository with
	// no issue is not the same event.
	it.each([
		['a status that the tool gives to a refusal', 1],
		['the status of a tool that could not authenticate', 4],
		['a status that no command of the tool gives', 127],
	])('throws on %s', (_what, status) => {
		expect(() =>
			getIssues(host({ status, stdout: '', stderr: 'the reason' })),
		).toThrow(`exited with ${String(status)}`);
	});

	it('names the answer status and the reason in the error', () => {
		expect(() =>
			getIssues(host({ status: 4, stdout: '', stderr: 'no token' })),
		).toThrow(/gives 0 as an answer[\s\S]*stderr: no token/);
	});

	// A host that could not start the tool gives no status. The message names
	// that event, and it names the two ways past it.
	it('says so when the host gave no status', () => {
		expect(() =>
			getIssues(host({ status: null, stdout: '', stderr: '' })),
		).toThrow(/gave no exit status[\s\S]*--issues=<file>/);
	});

	it('names the abort of a Windows host', () => {
		expect(() =>
			getIssues(
				host(
					{ status: WINDOWS_ABORT_STATUS, stdout: '', stderr: '' },
					'win32',
				),
			),
		).toThrow('Windows abort');
	});

	it('reads that status as an ordinary refusal on another host', () => {
		expect(() =>
			getIssues(
				host({ status: WINDOWS_ABORT_STATUS, stdout: '', stderr: '' }),
			),
		).toThrow('is not an answer to this command');
	});

	// The command takes a limit, and a repository with more issues than the
	// limit gives a part of the set. A part of the set makes the comparison
	// wrong.
	it('throws when the answer holds as many issues as the limit', () => {
		const rows = [1, 2].map((number) => ({
			number,
			title: 'feat: the work',
			body: '',
			milestone: null,
		}));
		expect(() =>
			getIssues(
				host({ status: 0, stdout: JSON.stringify(rows), stderr: '' }),
				2,
			),
		).toThrow('the limit of the command is 2');
	});

	it.each([
		['an answer that is not JSON', 'not json at all'],
		['an answer that is not a list', '{"number":1}'],
		['a row that is not an object', '[3]'],
		['a row with no number', '[{"title":"feat: one"}]'],
	])('throws on %s', (_what, answer) => {
		expect(() => readAnswer(answer)).toThrow();
	});

	it('reads a row whose body is absent as an empty body', () => {
		expect(readAnswer('[{"number":4,"title":"feat: four"}]')[0]?.body).toBe(
			'',
		);
	});
});

describe('the check as a process', () => {
	const scratch = mkdtempSync(join(tmpdir(), 'davenport-stage-claims-'));

	afterAll(() => {
		rmSync(scratch, { recursive: true, force: true });
	});

	function check(argv: readonly string[]): {
		status: number | null;
		out: string;
		err: string;
	} {
		const result = runNode([SCRIPT, ...argv]);
		return {
			status: result.status,
			out: result.stdout,
			err: result.stderr,
		};
	}

	/** A file in the scratch directory, and the path to it. */
	function file(name: string, text: string): string {
		const path = join(scratch, name);
		writeFileSync(path, text, 'utf8');
		return path;
	}

	/** A file of issues, in the shape of the answer of the command. */
	function answers(
		name: string,
		rows: readonly {
			number: number;
			milestone: string | null;
			claim: string;
		}[],
	): string {
		return file(
			name,
			JSON.stringify(
				rows.map((row) => ({
					number: row.number,
					title: `feat: the work of ${String(row.number)}`,
					body: `- Test plan: ${row.claim}`,
					milestone:
						row.milestone === null
							? null
							: { title: row.milestone },
				})),
			),
		);
	}

	const SMALL_PLAN = file('plan.md', SMALL_TEXT);
	const AGREED = answers('agreed.json', [
		{
			number: 1,
			milestone: 'M1 — Stage 1: one',
			claim: 'QQ-1, QQ-2, ZQ-1',
		},
		{
			number: 2,
			milestone: 'M2 — Stage 2: two',
			claim: 'QQ-3, ZQ-1, ZQ-2',
		},
	]);

	it('passes over a plan and a set of issues that agree', () => {
		const result = check([`--issues=${AGREED}`, SMALL_PLAN]);
		expect(result.err).toBe('');
		expect(result.status).toBe(0);
		expect(result.out).toContain(
			'every stage that holds a test ID has an issue of its milestone that claims that ID',
		);
	});

	// The plan of this repository is a file of the tree. Its stage lists must
	// hold every test ID, whatever the issues say.
	it('passes over the plan of this repository, with no issue of the tree', () => {
		const empty = answers('one-claim.json', [
			{ number: 1, milestone: 'M1 — Stage 1: one', claim: 'FM-1' },
		]);
		const result = check([`--issues=${empty}`]);
		expect(result.err).toBe('');
		expect(result.status).toBe(0);
		expect(result.out).toContain('the plan declares 7 stages');
		expect(result.out).toContain('The stages hold 227 of the 227 test IDs');
	});

	it('says which file it read the issues from', () => {
		const result = check([`--issues=${AGREED}`, SMALL_PLAN]);
		expect(result.out).toContain(
			`the check read the issues from the file ${AGREED}`,
		);
	});

	it('fails on a test ID that no stage holds', () => {
		const plan = file(
			'unstaged.md',
			[
				'### 5.1 First suite [QQ] — §1',
				'- **QQ-1 [D]** One.',
				'- **QQ-2 [D]** Two.',
				'## Part 8 — Ordering',
				'- **Stage 1 (one):** QQ-1.',
			].join('\n'),
		);
		const issues = answers('one.json', [
			{ number: 1, milestone: 'M1 — Stage 1: one', claim: 'QQ-1' },
		]);
		const result = check([`--issues=${issues}`, plan]);
		expect(result.status).toBe(1);
		expect(result.err).toContain(
			'the count of test IDs that no stage holds is 1',
		);
		expect(result.err).toContain('QQ-2');
	});

	it('fails on an issue that claims an ID that no stage holds', () => {
		const issues = answers('invented.json', [
			{ number: 1, milestone: 'M1 — Stage 1: one', claim: 'QQ-1, QQ-9' },
			{ number: 2, milestone: 'M2 — Stage 2: two', claim: 'ZQ-2' },
		]);
		const result = check([`--issues=${issues}`, SMALL_PLAN]);
		expect(result.status).toBe(1);
		expect(result.err).toContain(
			'issue #1 claims QQ-9, and no stage holds QQ-9',
		);
	});

	// Staging moves as the work proceeds. A disagreement is a thing to read,
	// and the run must still pass.
	it('reports a disagreement and gives the status of a run that passed', () => {
		const issues = answers('drifted.json', [
			{ number: 1, milestone: 'M1 — Stage 1: one', claim: 'QQ-1, QQ-2' },
			{ number: 2, milestone: 'M2 — Stage 2: two', claim: 'QQ-1, ZQ-2' },
		]);
		const result = check([`--issues=${issues}`, SMALL_PLAN]);
		expect(result.err).toBe('');
		expect(result.status).toBe(0);
		expect(result.out).toContain(
			'issue #2 claims QQ-1 for stage 2, and stage 2 does not hold QQ-1',
		);
		expect(result.out).toContain('a disagreement here fails nothing');
	});

	it('fails on a plan that holds no part of ordering', () => {
		const plan = file(
			'no-part.md',
			['### 5.1 First suite [QQ] — §1', '- **QQ-1 [D]** One.'].join('\n'),
		);
		const result = check([`--issues=${AGREED}`, plan]);
		expect(result.status).toBe(1);
		expect(result.err).toContain('the plan holds no part of ordering');
	});

	it('fails on a stage that holds no test ID', () => {
		const plan = file(
			'empty-stage.md',
			[
				'### 5.1 First suite [QQ] — §1',
				'- **QQ-1 [D]** One.',
				'## Part 8 — Ordering',
				'- **Stage 1 (one):** QQ complete.',
				'- **Stage 2 (two):** the rest lands here.',
			].join('\n'),
		);
		const result = check([`--issues=${AGREED}`, plan]);
		expect(result.status).toBe(1);
		expect(result.err).toContain(
			'the plan declares stage 2 and gives that stage no test ID',
		);
	});

	it('fails on a plan that gives it no vocabulary of IDs', () => {
		const result = check([`--issues=${AGREED}`, file('empty.md', '')]);
		expect(result.status).toBe(1);
		expect(result.err).toContain('the plan gives the check no vocabulary');
		expect(result.err).toContain('node scripts/plan-ids.mjs');
	});

	it('says one line when it cannot read the plan', () => {
		const result = check([
			`--issues=${AGREED}`,
			join(scratch, 'no-such-plan.md'),
		]);
		expect(result.status).toBe(1);
		expect(result.err.trimEnd().split('\n')).toHaveLength(1);
		expect(result.err).toContain('cannot read the plan file at');
	});

	it('fails on a set of issues that holds no issue', () => {
		const result = check([
			`--issues=${file('none.json', '[]')}`,
			SMALL_PLAN,
		]);
		expect(result.status).toBe(1);
		expect(result.err).toContain('the repository gave no issue');
	});

	// A set of issues whose bodies lost the claim line makes every comparison
	// empty, and an empty comparison passes.
	it('fails on a set of issues in which no body carries a claim line', () => {
		const path = file(
			'no-claim.json',
			JSON.stringify([
				{
					number: 1,
					title: 'feat: the work',
					body: 'The body names QQ-1 and states no claim.',
					milestone: { title: 'M1 — Stage 1: one' },
				},
			]),
		);
		const result = check([`--issues=${path}`, SMALL_PLAN]);
		expect(result.status).toBe(1);
		expect(result.err).toContain('no issue carries a claim line');
	});

	// The check reads the plan from a file and the issues from GitHub. A
	// machine that cannot reach GitHub runs the first half, and the check says
	// which half it ran.
	it('runs the stage half alone when it cannot read the issues', () => {
		const result = check([
			`--issues=${join(scratch, 'no-such-answer.json')}`,
			SMALL_PLAN,
		]);
		expect(result.err).toBe('');
		expect(result.status).toBe(0);
		expect(result.out).toContain('the check cannot read the issues');
		expect(result.out).toContain('it compared nothing against the issues');
	});

	it('still fails on an unstaged test ID when it cannot read the issues', () => {
		const plan = file(
			'unstaged-offline.md',
			[
				'### 5.1 First suite [QQ] — §1',
				'- **QQ-1 [D]** One.',
				'- **QQ-2 [D]** Two.',
				'## Part 8 — Ordering',
				'- **Stage 1 (one):** QQ-1.',
			].join('\n'),
		);
		const result = check([
			`--issues=${join(scratch, 'no-such-answer.json')}`,
			plan,
		]);
		expect(result.status).toBe(1);
		expect(result.err).toContain(
			'the count of test IDs that no stage holds is 1',
		);
	});

	// The workflow runs the check with this option. A run of the workflow that
	// cannot read the issues did not do its work, and it must turn red.
	it('fails with --require-issues when it cannot read the issues', () => {
		const result = check([
			'--require-issues',
			`--issues=${join(scratch, 'no-such-answer.json')}`,
			SMALL_PLAN,
		]);
		expect(result.status).toBe(1);
		expect(result.err).toContain('the check ran with --require-issues');
	});

	it('passes with --require-issues when it can read the issues', () => {
		const result = check([
			'--require-issues',
			`--issues=${AGREED}`,
			SMALL_PLAN,
		]);
		expect(result.err).toBe('');
		expect(result.status).toBe(0);
	});
});
