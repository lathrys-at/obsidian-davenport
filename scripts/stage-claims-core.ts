/**
 * The decisions behind the stage-and-claim traceability check:
 *
 * - which test IDs each stage of the test plan holds;
 * - whether the plan can support the check at all;
 * - which test IDs an issue body claims, and for which stage;
 * - what the comparison of the two sets says.
 *
 * No function here reads a file, and no function here starts a process. The
 * caller reads the plan and gets the issues. The caller then gives the text to
 * these functions. Therefore a test can exercise every decision directly.
 * `stage-claims.mjs` finds the plan, gets the issues, prints the report, and
 * sets the exit status. `stage-claims-issues.ts` gets the issues from GitHub.
 * `stage-claims-text.ts` holds the wording that the check prints.
 *
 * The plan states its own vocabulary of IDs, and `plan-ids-core.ts` reads that
 * vocabulary. This module uses the same vocabulary for the stage lists and for
 * the issue bodies. Therefore both halves of the traceability check read an ID
 * by one rule, and a new suite or a new item needs no change here.
 *
 * A stage list and an issue body write a set of IDs in the same four forms:
 *
 * - one ID, for example `DL-3`;
 * - a range of IDs, for example `ID-1..ID-6` or `FM-1..4`;
 * - a group of IDs behind one prefix, for example `UI-1/2/8` or `TS-6/TS-7`;
 * - a suite tag that stands for every ID of that suite, for example `LG` or
 *   `CD complete`. The word `except` then takes IDs back out of the suite.
 *
 * A comma and a semicolon each end an entry of a list, and one function reads
 * an entry. A stage list and a claim line go through that one function.
 * Therefore the two sides read the four forms by one rule.
 *
 * A suite tag counts only where the tag opens an entry of the list. A tag
 * inside a phrase names a thing and not a list of IDs. The entry
 * `the conflict UI (the UI-11 table)` therefore gives the stage UI-11 alone.
 * The check reports each tag that it passed over in this way, and it reports
 * the IDs that the other reading would add, so that a reader can see the
 * choice that the check made and the cost of that choice.
 *
 * A fenced block of a Markdown text holds an example, and an example states
 * nothing about this repository. The check reads no stage list and no claim
 * line inside a fence.
 *
 * The comparison keeps every ID of each set, and not the counts alone. The
 * plan gives some IDs to more than one stage, and each of those stages needs
 * its own claim. Therefore the comparison asks its question one time for each
 * pair of an ID and a stage.
 */

import type { PlanCorpus } from './plan-ids-core.ts';
import { citedIds, prefixOf } from './plan-ids-core.ts';

/** The heading of the part of the plan that carries the stage lists. */
const PART = /^## Part 8 .*$/m;

/** The line of one stage: the number, the name, and the list. */
const STAGE = /^[ \t]*[-*][ \t]+\*\*Stage (\d+) \(([^)]*)\):\*\*(.*)$/gm;

/** The words that separate what a stage delivers from what a stage consumes. */
const CONSUMES = /\bConsumes:/;

/** The word that takes IDs back out of a suite. */
const EXCEPT = /\bexcept\b/;

/** The line of an issue body that states the claim of that issue. */
const TRAILER = /^[ \t]*[-*][ \t]+(?:\*\*)?Test plan(?:\*\*)?[ \t]*:(.*)$/gm;

/** The line that opens a fenced block, and the line that closes one. */
const FENCE = /^[ \t]*(`{3,}|~{3,})(.*)$/;

/** The stage number that a milestone name states. */
const MILESTONE_STAGE = /\bStage (\d+)\b/;

/** One mention that a person adjudicated, and that the check must not raise. */
export interface Adjudicated {
	/** The ID that the mention names. */
	readonly id: string;
	/** The stage that holds the ID. */
	readonly stage: number;
	/** The sentence that states why the disagreement is not a fault. */
	readonly reason: string;
}

/**
 * The mentions that a person adjudicated. Each one is a stage that holds an ID
 * and a milestone that does not claim that ID. Each one is correct as it
 * stands. The check subtracts these from the disagreements, and the check
 * names them in the report. Therefore nobody finds them a second time, and
 * nobody loses them either.
 *
 * The check reports an entry here that matches no disagreement. Such an entry
 * is out of date, and a person removes it.
 */
export const ADJUDICATED: readonly Adjudicated[] = [
	{
		id: 'CF-3',
		stage: 1,
		reason: 'Stage 1 delivers the check of the settings. A later stage delivers the procedure of that check for each tool.',
	},
	{
		id: 'IN-13',
		stage: 1,
		reason: 'Stage 1 writes the content hash at creation. A later stage delivers the code that reads that hash.',
	},
	{
		id: 'SI-1',
		stage: 4,
		reason: 'Stage 4 retires the test. The entry is an obligation to audit, and it is not a delivery.',
	},
];

/** The IDs that one entry of a list names, and how the entry names them. */
export interface Entry {
	/** The text of the entry, without the space at each end. */
	readonly text: string;
	/** The IDs that the entry names directly. */
	readonly named: readonly string[];
	/** The IDs that a suite tag at the front of the entry gives. */
	readonly expanded: readonly string[];
	/** The IDs that the word `except` takes back out. */
	readonly removed: readonly string[];
	/** The suite tags that stand inside the entry and do not open it. */
	readonly passed: readonly string[];
}

/** One stage of the plan, and the entries of the list of that stage. */
export interface Stage {
	readonly number: number;
	/** The name that the plan gives the stage, in the brackets of the line. */
	readonly label: string;
	/** The entries of what the stage delivers. */
	readonly entries: readonly Entry[];
	/** The IDs of the items that the stage consumes. */
	readonly consumes: readonly string[];
}

/** One test ID that one stage holds. */
export interface Hold {
	readonly id: string;
	readonly stage: number;
	/**
	 * True when an entry of the stage names the ID. False when a suite tag
	 * gave the ID to the stage. A stage that names an ID asks for that ID. A
	 * stage that names a suite asks for the suite, and an earlier stage can
	 * have delivered a member of that suite already.
	 */
	readonly named: boolean;
}

/** What the stage lists of the plan hold. */
export interface StageCorpus {
	readonly stages: readonly Stage[];
	/** One entry for each pair of a test ID and a stage that holds it. */
	readonly holds: readonly Hold[];
	/** The test IDs that more than one stage holds. */
	readonly splitHalves: readonly string[];
}

/**
 * Expands a range of IDs. The range counts up from the first number to the
 * second number. A range whose two ends carry different prefixes is not a
 * range, and a range that does not count up is not a range. This function
 * gives back nothing for both of those, and the two ends then read as two
 * plain IDs.
 */
function rangeOf(
	prefix: string,
	from: string,
	other: string | undefined,
	to: string,
): readonly string[] {
	if (other !== undefined && other !== prefix) {
		return [];
	}
	const first = Number(from);
	const last = Number(to);
	if (last < first) {
		return [];
	}
	const found: string[] = [];
	for (let number = first; number <= last; number++) {
		found.push(`${prefix}-${String(number)}`);
	}
	return found;
}

/** The IDs that the text names directly, in the order of the text. */
function namedIds(text: string, corpus: PlanCorpus): readonly string[] {
	const tag = corpus.prefixes.join('|');
	if (corpus.prefixes.length === 0) {
		return [];
	}
	const found: string[] = [];
	const range = new RegExp(
		String.raw`(?<![\w-])(${tag})-(\d+)\.\.(?:(${tag})-)?(\d+)(?![\w-])`,
		'g',
	);
	let rest = text.replace(range, (whole, prefix, from, other, to) => {
		const ids = rangeOf(
			String(prefix),
			String(from),
			other === undefined ? undefined : String(other),
			String(to),
		);
		found.push(...ids);
		return ids.length === 0 ? whole : ' ';
	});
	const group = new RegExp(
		String.raw`(?<![\w-])(${tag})-(\d+)((?:/(?:(?:${tag})-)?\d+)+)(?![\w-])`,
		'g',
	);
	rest = rest.replace(group, (_whole, prefix, first, members) => {
		found.push(`${String(prefix)}-${String(first)}`);
		for (const member of String(members).split('/')) {
			if (member === '') {
				continue;
			}
			const parts = /^(?:([A-Z]{1,3})-)?(\d+)$/.exec(member);
			if (parts === null) {
				continue;
			}
			found.push(`${parts[1] ?? String(prefix)}-${must(parts[2])}`);
		}
		return ' ';
	});
	found.push(...citedIds(rest, corpus.prefixes));
	return unique(found);
}

/** The suite tags that stand in the text as a word of their own. */
function tagsIn(text: string, corpus: PlanCorpus): readonly string[] {
	if (corpus.suitePrefixes.length === 0) {
		return [];
	}
	const pattern = new RegExp(
		String.raw`(?<![\w-])(?:${corpus.suitePrefixes.join('|')})(?![\w-])`,
		'g',
	);
	return unique([...text.matchAll(pattern)].map((match) => match[0]));
}

/** The suite tag that opens the entry, if the entry opens with one. */
function openingTag(text: string, corpus: PlanCorpus): string | undefined {
	if (corpus.suitePrefixes.length === 0) {
		return undefined;
	}
	const pattern = new RegExp(
		String.raw`^[ \t]*(?:and[ \t]+)?(${corpus.suitePrefixes.join('|')})(?![\w-])`,
	);
	return pattern.exec(text)?.[1];
}

/** The test IDs of one suite, in the order of the plan. */
function suiteOf(tag: string, corpus: PlanCorpus): readonly string[] {
	return corpus.suiteIds.filter((id) => prefixOf(id) === tag);
}

/**
 * What one entry of a list gives.
 *
 * An entry that opens with a suite tag gives the stage that whole suite. An ID
 * of that same suite inside the entry then qualifies the entry, and it names
 * no delivery of its own. The entry `RC complete (the RC-1 display is already
 * live from stage 1)` therefore names nothing: the suite tag gives the stage
 * every RC item, and the words in the brackets say where one of them started.
 * An ID of another suite inside the entry is a name, because no tag of the
 * entry covers it.
 */
export function readEntry(text: string, corpus: PlanCorpus): Entry {
	const cut = EXCEPT.exec(text);
	const head = cut === null ? text : text.slice(0, cut.index);
	const tail = cut === null ? '' : text.slice(cut.index + cut[0].length);
	const tag = openingTag(head, corpus);
	const removed = namedIds(tail, corpus);
	const gone = new Set(removed);
	const named = namedIds(head, corpus).filter(
		(id) => !gone.has(id) && prefixOf(id) !== tag,
	);
	const expanded =
		tag === undefined
			? []
			: suiteOf(tag, corpus).filter((id) => !gone.has(id));
	return {
		text: text.trim(),
		named,
		expanded,
		removed,
		passed: tagsIn(head, corpus).filter((found) => found !== tag),
	};
}

/**
 * The text without its fenced blocks. A fenced block holds an example, and an
 * example states nothing about this repository. A fence opens on a line of
 * three or more backticks, or of three or more tildes. The block closes on a
 * line that holds as many of the same character and no other word. A block
 * that no line closes runs to the end of the text.
 *
 * Each line of a block becomes an empty line. Therefore the text keeps its
 * count of lines, and a line that stands after a block still reads the same.
 */
export function withoutFences(text: string): string {
	let open: string | undefined;
	return text
		.split('\n')
		.map((line) => {
			const fence = FENCE.exec(line);
			if (open === undefined) {
				if (fence === null) {
					return line;
				}
				open = must(fence[1]);
				return '';
			}
			const marks = fence === null ? '' : must(fence[1]);
			if (
				fence !== null &&
				marks.startsWith(open) &&
				must(fence[2]).trim() === ''
			) {
				open = undefined;
			}
			return '';
		})
		.join('\n');
}

/**
 * Splits the list of a stage into its entries. A comma and a semicolon each
 * end an entry. A comma inside brackets ends nothing, because the text inside
 * the brackets qualifies the entry that carries it.
 */
function entriesOf(text: string): readonly string[] {
	const found: string[] = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < text.length; index++) {
		const letter = text[index];
		if (letter === '(') {
			depth++;
		} else if (letter === ')') {
			depth--;
		} else if ((letter === ',' || letter === ';') && depth === 0) {
			found.push(text.slice(start, index));
			start = index + 1;
		}
	}
	found.push(text.slice(start));
	return found.filter((entry) => entry.trim() !== '');
}

/** The stage lists of the plan, and the test IDs that each stage holds. */
export function readStages(text: string, corpus: PlanCorpus): StageCorpus {
	const source = withoutFences(text);
	const part = PART.exec(source);
	const body = part === null ? '' : source.slice(part.index);
	const stages: Stage[] = [];
	const holds: Hold[] = [];
	// The holds of one stage read in the order of the plan, and not in the
	// order of the entries. An entry that names an ID stands before an entry
	// that names the suite of that ID, so that a name wins over a suite.
	const order = new Map(corpus.suiteIds.map((id, index) => [id, index]));
	for (const line of body.matchAll(STAGE)) {
		const number = Number(must(line[1]));
		const whole = must(line[3]);
		const split = CONSUMES.exec(whole);
		const delivers = split === null ? whole : whole.slice(0, split.index);
		const consumed =
			split === null
				? ''
				: whole.slice(split.index + must(split[0]).length);
		const entries = entriesOf(delivers).map((entry) =>
			readEntry(entry, corpus),
		);
		stages.push({
			number,
			label: must(line[2]),
			entries,
			consumes: namedIds(consumed, corpus),
		});
		const suites = new Set(corpus.suiteIds);
		const seen = new Set<string>();
		const held: Hold[] = [];
		for (const entry of entries) {
			for (const id of entry.named) {
				if (suites.has(id) && !seen.has(id)) {
					seen.add(id);
					held.push({ id, stage: number, named: true });
				}
			}
		}
		for (const entry of entries) {
			for (const id of entry.expanded) {
				if (suites.has(id) && !seen.has(id)) {
					seen.add(id);
					held.push({ id, stage: number, named: false });
				}
			}
		}
		held.sort(
			(left, right) =>
				(order.get(left.id) ?? 0) - (order.get(right.id) ?? 0),
		);
		holds.push(...held);
	}
	const spread = new Map<string, number>();
	for (const hold of holds) {
		spread.set(hold.id, (spread.get(hold.id) ?? 0) + 1);
	}
	return {
		stages,
		holds,
		splitHalves: corpus.suiteIds.filter((id) => (spread.get(id) ?? 0) > 1),
	};
}

/** One suite tag that stands inside an entry and does not open that entry. */
export interface Passed {
	readonly stage: number;
	/** The text of the entry that holds the tag. */
	readonly entry: string;
	readonly tag: string;
	/**
	 * The test IDs that this stage takes under the other reading, and that
	 * this stage does not hold under the rule of the check. A reading that
	 * took a suite tag anywhere in an entry would add each of these.
	 */
	readonly extra: readonly string[];
}

/** What the other reading of the suite tags gives, against this reading. */
export interface Wider {
	/** One row for each suite tag that the check passed over. */
	readonly rows: readonly Passed[];
	/** The pairs of a test ID and a stage that the other reading adds. */
	readonly pairs: number;
	/** The count of test IDs that more than one stage holds under it. */
	readonly splitHalves: number;
}

/**
 * Each suite tag that the check passed over, with the IDs that the other
 * reading would add. The check reads a suite tag as a whole suite only where
 * the tag opens an entry. The other reading takes the tag anywhere in the
 * entry. These rows and these counts state the difference between the two
 * readings, so that the output of one run is enough to audit the rule.
 */
export function passedTags(plan: PlanCorpus, corpus: StageCorpus): Wider {
	const rows: Passed[] = [];
	const spread = new Map<string, Set<number>>();
	const hold = (id: string, stage: number): void => {
		const stages = spread.get(id) ?? new Set<number>();
		stages.add(stage);
		spread.set(id, stages);
	};
	for (const item of corpus.holds) {
		hold(item.id, item.stage);
	}
	const added = new Set<string>();
	for (const stage of corpus.stages) {
		const held = new Set(
			corpus.holds
				.filter((item) => item.stage === stage.number)
				.map((item) => item.id),
		);
		for (const entry of stage.entries) {
			for (const tag of entry.passed) {
				const extra = suiteOf(tag, plan).filter((id) => !held.has(id));
				rows.push({
					stage: stage.number,
					entry: entry.text,
					tag,
					extra,
				});
				for (const id of extra) {
					added.add(`${id}@${String(stage.number)}`);
					hold(id, stage.number);
				}
			}
		}
	}
	return {
		rows,
		pairs: added.size,
		splitHalves: [...spread.values()].filter((stages) => stages.size > 1)
			.length,
	};
}

/** Something that the check needs from the stage lists and did not find. */
export type StageFault =
	| { readonly kind: 'no-part' }
	| { readonly kind: 'no-stage' }
	| { readonly kind: 'empty-stage'; readonly stage: number }
	| { readonly kind: 'repeat-stage'; readonly stage: number };

/**
 * What the stage lists do not give the check. The check fails on each of these
 * faults. A part that declares nothing makes every comparison empty, and an
 * empty comparison passes. Therefore the check tests the plan first.
 *
 * A stage number that stands two times is also a fault. The holds of the two
 * lines become one set, and the report then names one stage for two lists.
 */
export function stageFaults(corpus: StageCorpus): readonly StageFault[] {
	const faults: StageFault[] = [];
	if (corpus.stages.length === 0) {
		faults.push({ kind: 'no-part' }, { kind: 'no-stage' });
		return faults;
	}
	const held = new Set(corpus.holds.map((hold) => hold.stage));
	const seen = new Set<number>();
	for (const stage of corpus.stages) {
		if (seen.has(stage.number)) {
			faults.push({ kind: 'repeat-stage', stage: stage.number });
		}
		seen.add(stage.number);
		if (!held.has(stage.number)) {
			faults.push({ kind: 'empty-stage', stage: stage.number });
		}
	}
	return faults;
}

/** One issue of the repository, as the check reads it. */
export interface Issue {
	readonly number: number;
	readonly title: string;
	readonly body: string;
	/** The name of the milestone of the issue, or nothing. */
	readonly milestone: string | undefined;
}

/** One test ID that one issue claims for one stage. */
export interface Claim {
	readonly issue: number;
	readonly milestone: string;
	readonly stage: number;
	readonly id: string;
}

/** One issue that claims an ID and states no stage for the claim. */
export interface Loose {
	readonly issue: number;
	/** The name of the milestone, or nothing when the issue has none. */
	readonly milestone: string | undefined;
	readonly ids: readonly string[];
}

/** One issue whose body carries more than one claim line. */
export interface Repeated {
	readonly issue: number;
	/** The count of claim lines that the body carries. */
	readonly lines: number;
}

/** What the issue bodies claim. */
export interface ClaimScan {
	readonly claims: readonly Claim[];
	/** The count of issues that carry a claim line. */
	readonly trailers: number;
	/** The claims that state no stage. */
	readonly loose: readonly Loose[];
	/** The issues whose bodies carry more than one claim line. */
	readonly repeated: readonly Repeated[];
	/** The name of the milestone of each stage. */
	readonly milestones: ReadonlyMap<number, readonly string[]>;
}

/**
 * The IDs that one claim line names. The line writes a list of IDs in the same
 * forms that an entry of a stage list uses, and one line can hold more than
 * one entry. Therefore the line goes through the entry reader, and a claim
 * line and a stage list read the four forms by one rule.
 */
function claimedIds(text: string, corpus: PlanCorpus): readonly string[] {
	const found: string[] = [];
	for (const entry of entriesOf(text)) {
		const read = readEntry(entry, corpus);
		found.push(...read.named, ...read.expanded);
	}
	return unique(found);
}

/**
 * The claims that the issue bodies carry. One line of the body states the
 * claim of the issue, and the check reads that line alone. The rest of the
 * body can name an ID for many reasons: to give the reason for the work, to
 * point at a neighbour, or to say which milestone delivers another half. A
 * check that read every mention as a claim would report a disagreement for
 * each of those.
 *
 * A body that carries more than one claim line gives the check the first line,
 * and the check names that issue in the report. Therefore an author sees that
 * the check read one line and passed over the others.
 *
 * The milestone of the issue states the stage of the claim. A milestone that
 * names no stage gives the check nothing to compare, and the check reports
 * each issue of such a milestone that claims a test ID.
 */
export function readClaims(
	issues: readonly Issue[],
	corpus: PlanCorpus,
): ClaimScan {
	const suites = new Set(corpus.suiteIds);
	const prefixes = new Set(corpus.suitePrefixes);
	const claims: Claim[] = [];
	const loose: Loose[] = [];
	const repeated: Repeated[] = [];
	const milestones = new Map<number, string[]>();
	let trailers = 0;
	for (const issue of issues) {
		const found = [...withoutFences(issue.body).matchAll(TRAILER)];
		const line = found[0];
		if (line === undefined) {
			continue;
		}
		trailers++;
		if (found.length > 1) {
			repeated.push({ issue: issue.number, lines: found.length });
		}
		// An ID of a suite that the plan does not contain is still a claim of
		// a test. The comparison then reports that no stage holds it.
		const ids = claimedIds(must(line[1]), corpus).filter(
			(id) => suites.has(id) || prefixes.has(prefixOf(id)),
		);
		if (ids.length === 0) {
			continue;
		}
		const stage =
			issue.milestone === undefined
				? undefined
				: MILESTONE_STAGE.exec(issue.milestone)?.[1];
		if (stage === undefined) {
			loose.push({
				issue: issue.number,
				milestone: issue.milestone,
				ids,
			});
			continue;
		}
		const number = Number(stage);
		const names = milestones.get(number) ?? [];
		const milestone = issue.milestone ?? '';
		if (!names.includes(milestone)) {
			names.push(milestone);
		}
		milestones.set(number, names);
		for (const id of ids) {
			claims.push({
				issue: issue.number,
				milestone,
				stage: number,
				id,
			});
		}
	}
	return { claims, trailers, loose, repeated, milestones };
}

/** Something that the check needs from the issues and did not find. */
export type ClaimFault =
	{ readonly kind: 'no-issue' } | { readonly kind: 'no-trailer' };

/**
 * What the issues do not give the check. A set of issues that carries no claim
 * makes every comparison empty, and an empty comparison passes. Therefore the
 * check tests the issues before it compares them.
 */
export function claimFaults(
	issues: readonly Issue[],
	scan: ClaimScan,
): readonly ClaimFault[] {
	const faults: ClaimFault[] = [];
	if (issues.length === 0) {
		faults.push({ kind: 'no-issue' });
	}
	if (scan.trailers === 0) {
		faults.push({ kind: 'no-trailer' });
	}
	return faults;
}

/** One pair of an ID and a stage on which the two sets do not agree. */
export interface Disagreement {
	readonly id: string;
	readonly stage: number;
	/** True when an entry of the stage names the ID. */
	readonly named: boolean;
	/** The other stages that hold the ID. */
	readonly stages: readonly number[];
	/** The stages whose milestones claim the ID. */
	readonly claimed: readonly number[];
	/** The issues that make the claim, for a claim that no stage holds. */
	readonly issues: readonly number[];
}

/** What the stage lists and the issue bodies say about each other. */
export interface Reconciliation {
	/** The test IDs that no stage holds. The check fails on each of these. */
	readonly unstaged: readonly string[];
	/** The claims of an ID that no stage holds. The check fails on these. */
	readonly unstagedClaims: readonly Claim[];
	/** A stage holds the ID, and no issue of its milestone claims the ID. */
	readonly unclaimed: readonly Disagreement[];
	/** An issue claims the ID, and the stage of its milestone does not hold it. */
	readonly unheld: readonly Disagreement[];
	/** The test IDs that no issue claims for any stage. */
	readonly neverClaimed: readonly string[];
	/** The adjudicated mentions that this run met. */
	readonly applied: readonly Adjudicated[];
	/** The adjudicated mentions that this run did not meet. */
	readonly stale: readonly Adjudicated[];
}

/**
 * The comparison of the stage lists against the claims of the issues. The
 * comparison asks its question one time for each pair of an ID and a stage.
 * The plan gives some IDs to more than one stage, and each of those stages
 * needs a claim of its own. A comparison of the two totals, or of the two sets
 * of IDs, would let a claim for one stage stand for a claim for another.
 */
export function reconcile(
	plan: PlanCorpus,
	stages: StageCorpus,
	scan: ClaimScan,
	adjudicated: readonly Adjudicated[] = ADJUDICATED,
): Reconciliation {
	const holds = new Map<string, Hold[]>();
	for (const hold of stages.holds) {
		holds.set(hold.id, [...(holds.get(hold.id) ?? []), hold]);
	}
	const claims = new Map<string, Claim[]>();
	for (const claim of scan.claims) {
		claims.set(claim.id, [...(claims.get(claim.id) ?? []), claim]);
	}
	const staged = (id: string): readonly number[] =>
		(holds.get(id) ?? []).map((hold) => hold.stage);
	const asked = (id: string): readonly number[] =>
		unique((claims.get(id) ?? []).map((claim) => String(claim.stage))).map(
			Number,
		);

	const met = new Set<string>();
	const unclaimed: Disagreement[] = [];
	for (const hold of stages.holds) {
		if (asked(hold.id).includes(hold.stage)) {
			continue;
		}
		if (
			adjudicated.some(
				(entry) => entry.id === hold.id && entry.stage === hold.stage,
			)
		) {
			met.add(`${hold.id}@${String(hold.stage)}`);
			continue;
		}
		unclaimed.push({
			id: hold.id,
			stage: hold.stage,
			named: hold.named,
			stages: staged(hold.id).filter((stage) => stage !== hold.stage),
			claimed: asked(hold.id),
			issues: [],
		});
	}

	const unheld: Disagreement[] = [];
	const unstagedClaims: Claim[] = [];
	const seen = new Set<string>();
	for (const claim of scan.claims) {
		const stagesOf = staged(claim.id);
		if (stagesOf.length === 0) {
			unstagedClaims.push(claim);
			continue;
		}
		if (stagesOf.includes(claim.stage)) {
			continue;
		}
		const key = `${claim.id}@${String(claim.stage)}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unheld.push({
			id: claim.id,
			stage: claim.stage,
			named: true,
			stages: stagesOf,
			claimed: asked(claim.id),
			issues: (claims.get(claim.id) ?? [])
				.filter((other) => other.stage === claim.stage)
				.map((other) => other.issue),
		});
	}

	return {
		unstaged: plan.suiteIds.filter((id) => !holds.has(id)),
		unstagedClaims,
		unclaimed,
		unheld,
		neverClaimed: plan.suiteIds.filter((id) => !claims.has(id)),
		applied: adjudicated.filter((entry) =>
			met.has(`${entry.id}@${String(entry.stage)}`),
		),
		stale: adjudicated.filter(
			(entry) => !met.has(`${entry.id}@${String(entry.stage)}`),
		),
	};
}

function unique(items: readonly string[]): string[] {
	return [...new Set(items)];
}

/** A value that the pattern beside it always produces. */
function must(value: string | undefined): string {
	if (value === undefined) {
		throw new Error('the pattern matched and gave no group');
	}
	return value;
}
