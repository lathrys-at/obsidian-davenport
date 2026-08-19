/**
 * The wording of everything that the coverage ratchet prints. The check
 * prints two kinds of line. The report says what the tests cover, and what
 * each file does against its floor. The failure names each metric that fell
 * past the grace. The failure also names each file that the run and the
 * baseline do not agree about.
 *
 * Each line that states a fact carries the name of the check. A log holds
 * the output of many steps, and the name keeps the line legible there. A
 * line that continues a statement carries no name. Such a line stands
 * indented under the line that it continues.
 *
 * Every percentage stands beside the two counts that give it. The check
 * computes each percentage from those counts. Two different pairs of counts
 * can give one percentage. Therefore a percentage alone hides an edit of
 * the baseline that moves counts from one file to another.
 *
 * The row of a file states the counts of the run. A second line under that
 * row states the counts of the floor for each metric whose counts differ. A
 * row with no second line therefore has a floor that holds the counts of
 * the run.
 */

import type {
	Comparison,
	Count,
	Counts,
	FileMove,
	FileMoves,
	Metric,
	Move,
	Report,
} from './coverage-ratchet-core.ts';
import { GRACE, METRICS, percentOf } from './coverage-ratchet-core.ts';

/** The lines of the report. The report says what the tests cover. */
export function reportLines(
	report: Report,
	comparison: Comparison,
): readonly string[] {
	return [
		say(`the tests run ${countsText(report.total)}`),
		say(
			`the whole run against the baseline: ${movesText(comparison.total)}. The check reports the whole run, and it never fails on the whole run.`,
		),
		say(
			`the grace is ${points(GRACE)}. The check fails when one metric of one file falls more than the grace below the floor of that file.`,
		),
		say(
			'the check also fails when the baseline holds a file that the run does not report. The check also fails when the run reports a file that the baseline does not hold.',
		),
		say(
			'a row states the counts of the run. A second line under a row states the counts of the floor for each metric whose counts differ. Two different pairs of counts can give one percentage.',
		),
		...fileLines(report, comparison),
		...changeLines(comparison),
	];
}

/** The counts of a whole run, with the percentage of each count. */
function countsText(counts: Counts): string {
	return list(METRICS.map((metric) => countText(counts[metric], metric)));
}

/**
 * The two counts of one metric, with the percentage that they give. The
 * name of the metric stands between the counts and the percentage. A caller
 * that names the metric on the line gives no metric to this function.
 */
function countText(count: Count, metric?: Metric): string {
	const name = metric === undefined ? '' : ` ${metric}`;
	return `${String(count.covered)} of ${String(count.total)}${name} (${percent(percentOf(count))})`;
}

/** What four metrics did, in one phrase. */
function movesText(moves: readonly Move[]): string {
	return list(moves.map((move) => `${move.metric} ${moved(move.change)}`));
}

/**
 * The lines that name each file of the run. A file that holds no statement
 * gets no row of its own. Every floor of such a file is 100 percent, and
 * the row says nothing. A file whose floor holds other counts gets a row,
 * because those counts are what the reader must see.
 */
function fileLines(report: Report, comparison: Comparison): readonly string[] {
	const changed = new Map(
		comparison.changed.map((file) => [file.path, file]),
	);
	const mismatched = new Map(
		comparison.mismatched.map((file) => [file.path, file]),
	);
	const fresh = new Set(comparison.fresh);
	const withCode = report.files.filter(
		(file) => file.counts.statements.total > 0,
	);
	const rows = report.files.filter(
		(file) => file.counts.statements.total > 0 || mismatched.has(file.path),
	);
	const lines = [
		say(
			`the run reports ${count(report.files.length, 'file')}, and ${String(withCode.length)} of them ${holds(withCode.length)} a statement`,
		),
	];
	for (const file of rows) {
		const numbers = METRICS.map(
			(metric) => `${metric} ${countText(file.counts[metric])}`,
		).join('  ');
		const floors = mismatched.get(file.path);
		lines.push(
			`  ${file.path}  ${numbers}  ${note(file.path, changed, fresh, floors !== undefined)}`,
		);
		if (floors !== undefined) {
			lines.push(`    the floor holds ${floorText(floors)}`);
		}
	}
	const rest = report.files.length - rows.length;
	if (rest === 1) {
		lines.push('  the other file holds no statement');
	} else if (rest > 1) {
		lines.push(`  the other ${count(rest, 'file')} hold no statement`);
	}
	return lines;
}

/** The counts of a floor, for each metric that differs from the run. */
function floorText(file: FileMoves): string {
	return list(file.moves.map((move) => countText(move.floor, move.metric)));
}

/** What one row of the table says about the floor of that file. */
function note(
	path: string,
	changed: ReadonlyMap<string, FileMove>,
	fresh: ReadonlySet<string>,
	differs: boolean,
): string {
	if (fresh.has(path)) {
		return 'the baseline does not hold this file';
	}
	const move = changed.get(path);
	if (move !== undefined) {
		return movesText(move.moves);
	}
	return differs ? 'no percentage moved' : 'no change';
}

/** The lines that name each file whose coverage differs from its floor. */
function changeLines(comparison: Comparison): readonly string[] {
	if (comparison.changed.length === 0) {
		return [say('no file moved against its floor')];
	}
	const lines = [
		say(
			`${count(comparison.changed.length, 'file')} moved against a floor`,
		),
	];
	for (const file of comparison.changed) {
		for (const move of file.moves) {
			lines.push(`  ${file.path}  ${moveText(move)}`);
		}
	}
	return lines;
}

function moveText(move: Move): string {
	return `${move.metric}  from ${countText(move.floor)} to ${countText(move.now)}  ${moved(move.change)}`;
}

/**
 * The lines that name each file that the baseline does not hold. Such a
 * file has no floor, so no rule of this check measures it.
 */
function freshLines(comparison: Comparison): readonly string[] {
	if (comparison.fresh.length === 0) {
		return [];
	}
	const lines = comparison.fresh.map((path) =>
		say(
			`the run reports ${path}, and the baseline holds no floor for that file`,
		),
	);
	lines.push(
		say(
			'the ratchet holds a file only after the baseline records a floor for that file. A change that adds a file writes the baseline in that same change.',
		),
	);
	return lines;
}

/** The lines of the failure. The check fails after it says these lines. */
export function failureLines(comparison: Comparison): readonly string[] {
	if (!comparison.fails) {
		return [];
	}
	const lines = [
		...goneLines(comparison),
		...freshLines(comparison),
		...fellLines(comparison),
	];
	lines.push(
		say(
			'accept this change in the pull request that causes it. Write the new numbers into the baseline in that same pull request. The command `node scripts/coverage-ratchet.mjs --write-baseline` writes the file.',
		),
	);
	return lines;
}

/**
 * The lines that name each file that the run does not report. The last
 * line says what else this run did. A change that moves a file makes a
 * line here and a line for the new path. A change that deletes a file
 * makes a line here alone. Therefore these lines state what this run
 * reports, and they do not assume the cause.
 */
function goneLines(comparison: Comparison): readonly string[] {
	if (comparison.gone.length === 0) {
		return [];
	}
	const lines = comparison.gone.map((path) =>
		say(
			`the run does not report ${path}, and the baseline holds a floor for that file`,
		),
	);
	lines.push(
		say(
			comparison.fresh.length > 0
				? `the run also reports ${count(comparison.fresh.length, 'file')} that the baseline does not hold. A change that moves a file makes both of these lines.`
				: 'the run reports no file that the baseline does not hold. A file that leaves the coverage report keeps no floor, and the numbers of the run give no other sign of that loss.',
		),
	);
	lines.push(
		say(
			'a change that deletes a file or moves a file writes the baseline in that same change.',
		),
	);
	return lines;
}

/** The lines that name each metric that fell past the grace. */
function fellLines(comparison: Comparison): readonly string[] {
	const lines: string[] = [];
	for (const file of comparison.changed) {
		for (const move of file.moves) {
			if (move.past) {
				lines.push(
					say(
						`the ${move.metric} of ${file.path} fell from ${countText(move.floor)} to ${countText(move.now)}. The fall of ${points(-move.change)} goes past the grace of ${points(GRACE)}.`,
					),
				);
			}
		}
	}
	return lines;
}

/** The name that the check prints in front of each line that it says. */
export function say(text: string): string {
	return `coverage ratchet: ${text}`;
}

/** A percentage, as the report says it. */
function percent(value: number): string {
	return `${String(Math.round(value * 100) / 100)}%`;
}

/** A count of percentage points, as the report says it. */
function points(value: number): string {
	const size = Math.abs(Math.round(value * 100) / 100);
	return `${String(size)} percentage ${size === 1 ? 'point' : 'points'}`;
}

/** What one percentage did against its floor. */
function moved(change: number): string {
	if (change === 0) {
		return 'the same';
	}
	return change > 0 ? `${points(change)} more` : `${points(change)} less`;
}

/** A count and the thing that it counts, with the plural of that thing. */
function count(value: number, thing: string): string {
	return `${String(value)} ${thing}${value === 1 ? '' : 's'}`;
}

/** The verb "hold", in the form that agrees with a count. */
function holds(value: number): string {
	return value === 1 ? 'holds' : 'hold';
}

/** Several phrases, with a comma between them and "and" before the last. */
function list(parts: readonly string[]): string {
	const last = parts[parts.length - 1];
	if (parts.length < 2 || last === undefined) {
		return parts.join('');
	}
	return `${parts.slice(0, -1).join(', ')} and ${last}`;
}
