/**
 * The wording of everything that the plan-ID traceability check prints. The
 * check prints three kinds of line. The fault names what the check needs from
 * the plan and did not find. The report says what the check found. The
 * failure names each title that cites an ID that the plan does not contain.
 *
 * Each line that states a fact carries the name of the check, so that the
 * line stays legible in a log that holds the output of many steps. A line
 * that continues a statement carries no name, and it stands indented under
 * the line that it continues.
 */

import type {
	PlanCorpus,
	PlanFault,
	Reconciliation,
	SuiteScan,
} from './plan-ids-core.ts';
import { prefixOf } from './plan-ids-core.ts';

/**
 * The plan gives some IDs to more than one stage. Therefore a title that
 * cites an ID covers the stage that the title implements, and it leaves the
 * other stages open. The check says this whenever it reports a citation, and
 * the full-coverage report says it too.
 */
const STAGES = [
	'the plan gives some IDs to more than one stage.',
	'A title for one stage does not cover the other stages.',
	'This check does not compare the stages.',
].join(' ');

/** The lines of the fault. The check fails after it says these lines. */
export function faultLines(faults: readonly PlanFault[]): readonly string[] {
	if (faults.length === 0) {
		return [];
	}
	const lines = faults.map((fault) => say(faultText(fault)));
	lines.push(
		say(
			'the check cannot compare the titles against a plan that it cannot read',
		),
	);
	return lines;
}

function faultText(fault: PlanFault): string {
	switch (fault.kind) {
		case 'no-suite':
			return 'the plan declares no suite. The check expects a heading of the suites part to carry a tag in brackets.';
		case 'no-id':
			return 'the plan defines no ID. The check expects each item of the plan to start with a bold ID.';
		case 'empty-suite':
			return `the plan declares the suite ${fault.tag} and defines no ID for that suite.`;
	}
}

/** The lines of the report. The report says what the check found. */
export function reportLines(
	corpus: PlanCorpus,
	scan: SuiteScan,
	result: Reconciliation,
): readonly string[] {
	const lines = [
		say(
			`the plan contains ${count(corpus.ids, 'ID')}. The plan gives ${String(corpus.suiteIds.length)} of these IDs to the suites, and ${String(corpus.otherIds.length)} to the sweeps and the verification protocol.`,
		),
		say(
			`the count of titles in the suite files is ${String(scan.titleCount)}`,
		),
	];
	lines.push(...unreadableLines(scan));
	lines.push(...citedLines(result));
	lines.push(...uncitedLines(result));
	return lines;
}

/** The lines that name the titles that the check cannot read. */
function unreadableLines(scan: SuiteScan): readonly string[] {
	if (scan.unreadable.length === 0) {
		return [];
	}
	const lines = [
		say(
			`the count of titles that the check cannot read is ${String(scan.unreadable.length)}. A title that is not a plain string cites no ID.`,
		),
	];
	for (const site of scan.unreadable) {
		lines.push(`  ${site.path}:${String(site.line)}  ${site.text}`);
	}
	return lines;
}

/** The lines that name the IDs that the titles cite. */
function citedLines(result: Reconciliation): readonly string[] {
	if (result.cited.length === 0) {
		return [say('the titles cite no ID of the plan')];
	}
	const others = result.cited.length - result.citedTests.length;
	const lines = [
		say(
			`the titles cite ${count(result.cited, 'ID')} of the plan. The count of test IDs among them is ${String(result.citedTests.length)}, and the count of sweeps and protocol items among them is ${String(others)}.`,
		),
	];
	for (const row of group(result.cited)) {
		lines.push(`  ${row}`);
	}
	lines.push(say(STAGES));
	return lines;
}

/** The lines that name the test IDs that no title cites. */
function uncitedLines(result: Reconciliation): readonly string[] {
	if (result.uncited.length === 0) {
		return [say('every test ID has at least one title that cites it')];
	}
	const lines = [
		say(
			`the count of test IDs that no title cites is ${String(result.uncited.length)}`,
		),
	];
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
			`the count of citations of IDs that the plan does not contain is ${String(result.unknown.length)}. Correct each title, or add the ID to the plan.`,
		),
	);
	return lines;
}

/** The name that the check prints in front of each line that it says. */
export function say(text: string): string {
	return `plan-id check: ${text}`;
}

/** A count and the thing that it counts, with the plural of that thing. */
function count(items: readonly unknown[], thing: string): string {
	return `${String(items.length)} ${thing}${items.length === 1 ? '' : 's'}`;
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
