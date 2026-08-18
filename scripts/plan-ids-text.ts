/**
 * The wording of everything that the plan-ID traceability check prints. The
 * check prints two kinds of line. The report says what the check found, and
 * the check does not fail on it. The failure names each title that cites an
 * ID that the plan does not contain.
 *
 * Every line carries the name of the check, so that a line stays legible in a
 * log that holds the output of many steps.
 */

import type { PlanCorpus, Reconciliation, SuiteScan } from './plan-ids-core.ts';
import { prefixOf } from './plan-ids-core.ts';

/** The lines of the report. The report says what the check found. */
export function reportLines(
	corpus: PlanCorpus,
	scan: SuiteScan,
	result: Reconciliation,
): readonly string[] {
	const lines = [
		say(
			`the plan contains ${count(corpus.ids)} IDs, and ${count(corpus.suiteIds)} of them are test IDs`,
		),
		say(
			`the suite titles cite ${count(result.cited)} of these IDs, from ${String(scan.titles)} titles`,
		),
	];
	if (scan.unreadable > 0) {
		lines.push(
			say(
				`the count of titles that are not text is ${String(scan.unreadable)}. The check reads no ID from these titles.`,
			),
		);
	}
	for (const tag of corpus.emptySuites) {
		lines.push(
			say(
				`the plan declares the suite ${tag} and defines no ID for it. Check the format of the plan.`,
			),
		);
	}
	if (result.uncited.length === 0) {
		lines.push(say('every test ID has a title'));
		return lines;
	}
	lines.push(
		say(
			`the count of test IDs that no title cites is ${count(result.uncited)}`,
		),
		say(
			'a cited ID can still be incomplete. The plan gives some IDs to more than one stage, and this check does not measure the parts.',
		),
	);
	for (const row of group(result.uncited)) {
		lines.push(`  ${row}`);
	}
	return lines;
}

/** The lines of the failure. The failure names each citation that fails. */
export function failureLines(result: Reconciliation): readonly string[] {
	if (result.unknown.length === 0) {
		return [];
	}
	const lines: string[] = [];
	for (const citation of result.unknown) {
		lines.push(
			say(
				`${citation.path}:${String(citation.line)} cites ${citation.id}, and the plan does not contain that ID`,
			),
			`  title: ${citation.title}`,
		);
	}
	lines.push(
		say(
			`the count of citations that the plan does not contain is ${count(result.unknown)}. Correct each title, or add the ID to the plan.`,
		),
	);
	return lines;
}

/** The name that the check prints in front of each line that it says. */
export function say(text: string): string {
	return `plan-id check: ${text}`;
}

function count(items: readonly unknown[]): string {
	return String(items.length);
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
