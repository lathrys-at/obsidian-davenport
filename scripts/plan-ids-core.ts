/**
 * The decisions behind the plan-ID traceability check:
 *
 * - which IDs the test plan contains;
 * - whether the plan can support the check at all;
 * - which words in a title cite an ID, and which words only look like one;
 * - what the comparison of the two sets says.
 *
 * No function here reads a file. The caller reads the plan and the suite
 * files, and the caller gives the text to these functions. Therefore a test
 * can exercise every decision directly. `plan-ids.mjs` finds the files, reads
 * them, prints the report, and sets the exit status. `plan-ids-titles.ts`
 * reads the titles out of one file of source. `plan-ids-text.ts` holds the
 * wording that the check prints around all of this.
 *
 * The plan states its own vocabulary, and this module reads that vocabulary
 * out of the plan. The suite tags in the headings give the prefixes of the
 * test IDs. The items give the IDs themselves. Therefore a new suite or a new
 * item needs no change here. A word that looks like an ID and uses a prefix
 * that the plan never defines is not an ID, and the check passes over it.
 *
 * A plan that gives no vocabulary is a fault, and the check fails on it. A
 * change to the format of the plan therefore turns the check red. Such a
 * change never leaves a check that reads nothing and reports success.
 */

import type { UnreadableSite } from './plan-ids-titles.ts';
import { readTitles } from './plan-ids-titles.ts';

/**
 * The shape of an ID: one to three uppercase letters, a hyphen, and a number.
 * A word character and a hyphen on either side refuse the match, and so does
 * a decimal point with a digit after it. Therefore a technical word of the
 * same shape is not an ID, and a decimal number is not an ID.
 */
const SHAPE = String.raw`[A-Z]{1,3}-\d+(?![\w-])(?!\.\d)`;

/**
 * An item of the plan defines an ID. The item starts a line with a list
 * marker, or the item follows the end of a sentence. The ID then stands in
 * bold at the front of the item. A bold word anywhere else is not a
 * definition, and it cannot add a prefix to the vocabulary.
 */
const DEFINITION = new RegExp(
	String.raw`(?:^[ \t]*[-*][ \t]+|(?<=[.:] ))\*\*(${SHAPE})`,
	'gm',
);

/** The suite tag that a heading of the suites part carries. */
const SUITE_HEADING = /^### 5\.\d+ .*?\[([A-Z]+)\]/gm;

/** The IDs that the plan contains, and the prefixes that they use. */
export interface PlanCorpus {
	/** The suite tags that the suite headings declare. */
	readonly suitePrefixes: readonly string[];
	/** Every prefix that the definitions use, longest first. */
	readonly prefixes: readonly string[];
	/** Every ID that the plan defines, in the order of the plan. */
	readonly ids: readonly string[];
	/** The IDs that belong to a suite. These are the test IDs. */
	readonly suiteIds: readonly string[];
	/** The IDs of the sweeps and of the verification protocol. */
	readonly otherIds: readonly string[];
	/** The suite tags for which the plan defines no ID. */
	readonly emptySuites: readonly string[];
}

/** The IDs that the plan contains. */
export function readPlan(text: string): PlanCorpus {
	const suitePrefixes = unique(
		[...text.matchAll(SUITE_HEADING)].map((match) => must(match[1])),
	);
	const ids = unique(
		[...text.matchAll(DEFINITION)].map((match) => must(match[1])),
	);
	// The order of the vocabulary decides nothing. The hyphen and the boundary
	// on the left already stop a short prefix from taking the match of a long
	// one. The sort exists so that the vocabulary reads the same on every run.
	const prefixes = unique(ids.map(prefixOf)).sort(
		(left, right) => right.length - left.length || order(left, right),
	);
	const suites = new Set(suitePrefixes);
	const suiteIds = ids.filter((id) => suites.has(prefixOf(id)));
	const used = new Set(suiteIds.map(prefixOf));
	return {
		suitePrefixes,
		prefixes,
		ids,
		suiteIds,
		otherIds: ids.filter((id) => !suites.has(prefixOf(id))),
		emptySuites: suitePrefixes.filter((tag) => !used.has(tag)),
	};
}

/** Something that the check needs from the plan and did not find. */
export type PlanFault =
	| { readonly kind: 'no-suite' }
	| { readonly kind: 'no-id' }
	| { readonly kind: 'empty-suite'; readonly tag: string };

/**
 * What the plan does not give the check. The check fails on each of these
 * faults. A plan that defines nothing makes every comparison empty, and an
 * empty comparison passes. Therefore the check tests the plan first.
 */
export function planFaults(corpus: PlanCorpus): readonly PlanFault[] {
	const faults: PlanFault[] = [];
	if (corpus.suitePrefixes.length === 0) {
		faults.push({ kind: 'no-suite' });
	}
	if (corpus.ids.length === 0) {
		faults.push({ kind: 'no-id' });
	}
	for (const tag of corpus.emptySuites) {
		faults.push({ kind: 'empty-suite', tag });
	}
	return faults;
}

/** The IDs that one title cites, in the order of the title. */
export function citedIds(
	title: string,
	prefixes: readonly string[],
): readonly string[] {
	if (prefixes.length === 0) {
		return [];
	}
	const pattern = new RegExp(
		String.raw`(?<![\w-])(?:${prefixes.join('|')})-\d+(?![\w-])(?!\.\d)`,
		'g',
	);
	return [...title.matchAll(pattern)].map((match) => match[0]);
}

/** A file that the check reads, and the text that the file holds. */
export interface SuiteFile {
	readonly path: string;
	readonly text: string;
}

/** One citation of one ID, and the place that carries the citation. */
export interface Citation {
	readonly path: string;
	readonly line: number;
	readonly title: string;
	readonly id: string;
}

/**
 * One title that the check cannot read, and the place that carries it. The
 * text is what stands where the title was expected. A call that gives no
 * argument at all has no such text, and the text is then undefined.
 */
export interface Unreadable {
	readonly path: string;
	readonly line: number;
	readonly text: string | undefined;
}

/** What the titles of the suite files cite. */
export interface SuiteScan {
	readonly citations: readonly Citation[];
	readonly titleCount: number;
	readonly unreadable: readonly Unreadable[];
}

/** The citations that the titles of the suite files carry. */
export function readSuites(
	files: readonly SuiteFile[],
	corpus: PlanCorpus,
): SuiteScan {
	const citations: Citation[] = [];
	const unreadable: Unreadable[] = [];
	let titleCount = 0;
	for (const file of files) {
		const scan = readTitles(file.text, file.path);
		titleCount += scan.titles.length;
		unreadable.push(...scan.unreadable.map((site) => named(file, site)));
		for (const site of scan.titles) {
			for (const id of citedIds(site.title, corpus.prefixes)) {
				citations.push({
					path: file.path,
					line: site.line,
					title: site.title,
					id,
				});
			}
		}
	}
	return { citations, titleCount, unreadable };
}

/** An unreadable title, with the file that carries it. */
function named(file: SuiteFile, site: UnreadableSite): Unreadable {
	return { path: file.path, line: site.line, text: site.text };
}

/** What the citations and the plan say about each other. */
export interface Reconciliation {
	/** The citations of IDs that the plan does not contain. */
	readonly unknown: readonly Citation[];
	/** The plan IDs that at least one title cites. */
	readonly cited: readonly string[];
	/** The test IDs that at least one title cites. */
	readonly citedTests: readonly string[];
	/** The test IDs that no title cites. */
	readonly uncited: readonly string[];
}

/**
 * The comparison of the citations against the plan. The comparison keeps
 * every ID of each set, and not the counts alone. One ID can carry more than
 * one title, because the plan gives some IDs to more than one stage.
 * Therefore a title for one stage leaves the other stages open, and this
 * comparison does not compare the stages.
 */
export function reconcile(corpus: PlanCorpus, scan: SuiteScan): Reconciliation {
	const known = new Set(corpus.ids);
	const seen = new Set(scan.citations.map((citation) => citation.id));
	return {
		unknown: scan.citations.filter((citation) => !known.has(citation.id)),
		cited: corpus.ids.filter((id) => seen.has(id)),
		citedTests: corpus.suiteIds.filter((id) => seen.has(id)),
		uncited: corpus.suiteIds.filter((id) => !seen.has(id)),
	};
}

/** The letters in front of the hyphen of an ID. */
export function prefixOf(id: string): string {
	return must(/^[A-Z]+/.exec(id)?.[0]);
}

function unique(items: readonly string[]): string[] {
	return [...new Set(items)];
}

/** The alphabetical order of two prefixes. */
function order(left: string, right: string): number {
	if (left === right) {
		return 0;
	}
	return left < right ? -1 : 1;
}

/** A value that the pattern beside it always produces. */
function must(value: string | undefined): string {
	if (value === undefined) {
		throw new Error('the pattern matched and gave no group');
	}
	return value;
}
