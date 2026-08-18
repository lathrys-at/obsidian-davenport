/**
 * The decisions behind the plan-ID traceability check:
 *
 * - which IDs the test plan contains;
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
 * test IDs. The bold spans give the IDs themselves. Therefore a new suite or
 * a new item needs no change here. A word that looks like an ID and uses a
 * prefix that the plan never defines is not an ID, and the check passes over
 * it.
 */

import type { TitleSite } from './plan-ids-titles.ts';
import { readTitles } from './plan-ids-titles.ts';

/**
 * The shape of an ID before the plan states its own prefixes. An ID has one
 * to three uppercase letters, a hyphen, and one to three digits. The check
 * reads the plan with this shape one time. The prefixes that the plan defines
 * then become the vocabulary for everything after that.
 */
const DEFINITION = /\*\*([A-Z]{1,3}-\d{1,3})(?![\w-])/g;

/** The suite tag that a heading of the suites part carries. */
const SUITE_HEADING = /^### 5\.\d+ .*\[([A-Z]+)\]/gm;

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
	/** The suite tags for which the plan defines no ID. */
	readonly emptySuites: readonly string[];
}

/** The IDs that the plan contains. */
export function readPlan(text: string): PlanCorpus {
	const suitePrefixes = [...text.matchAll(SUITE_HEADING)].map((match) =>
		must(match[1]),
	);
	const ids = unique(
		[...text.matchAll(DEFINITION)].map((match) => must(match[1])),
	);
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
		emptySuites: suitePrefixes.filter((tag) => !used.has(tag)),
	};
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
		`(?<![\\w-])(?:${prefixes.join('|')})-\\d{1,3}(?![\\w-])`,
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

/** What the titles of the suite files cite. */
export interface SuiteScan {
	readonly citations: readonly Citation[];
	readonly titles: number;
	readonly unreadable: number;
}

/** The citations that the titles of the suite files carry. */
export function readSuites(
	files: readonly SuiteFile[],
	corpus: PlanCorpus,
): SuiteScan {
	const citations: Citation[] = [];
	let titles = 0;
	let unreadable = 0;
	for (const file of files) {
		const scan = readTitles(file.text);
		titles += scan.titles.length;
		unreadable += scan.unreadable;
		for (const site of scan.titles) {
			citations.push(...citationsOf(file, site, corpus));
		}
	}
	return { citations, titles, unreadable };
}

/** The citations that one title carries. */
function citationsOf(
	file: SuiteFile,
	site: TitleSite,
	corpus: PlanCorpus,
): readonly Citation[] {
	return citedIds(site.title, corpus.prefixes).map((id) => ({
		path: file.path,
		line: site.line,
		title: site.title,
		id,
	}));
}

/** What the citations and the plan say about each other. */
export interface Reconciliation {
	/** The citations of IDs that the plan does not contain. */
	readonly unknown: readonly Citation[];
	/** The plan IDs that at least one title cites. */
	readonly cited: readonly string[];
	/** The test IDs that no title cites. */
	readonly uncited: readonly string[];
}

/**
 * The comparison of the citations against the plan. The comparison keeps
 * every ID of each set, and not the counts alone. One ID can carry more than
 * one title, because the plan gives some IDs to more than one stage.
 * Therefore a cited ID can still be incomplete, and this comparison does not
 * measure the parts.
 */
export function reconcile(corpus: PlanCorpus, scan: SuiteScan): Reconciliation {
	const known = new Set(corpus.ids);
	const seen = new Set(scan.citations.map((citation) => citation.id));
	return {
		unknown: scan.citations.filter((citation) => !known.has(citation.id)),
		cited: corpus.ids.filter((id) => seen.has(id)),
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
