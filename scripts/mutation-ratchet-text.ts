/**
 * The wording of everything that the mutation ratchet prints. The check
 * prints two kinds of line. The report says what the run did, and how the
 * score of the run stands against the floor. The failure names the score, the
 * floor, the fall, and each file that holds a mutant that the tests do not
 * detect.
 *
 * Each line that states a fact carries the name of the check. A log holds the
 * output of many steps, and the name keeps the line legible there. A line
 * that continues a statement carries no name. Such a line stands indented
 * under the line that it continues.
 *
 * Every score stands beside the two counts that give it. The check computes
 * each score from those counts. The counts are the mutants that the tests
 * detect, and the mutants that the score counts.
 *
 * The report names each file that holds a mutant that the tests do not
 * detect, and the file with the lowest score stands first. Under each file
 * stand the first mutants of that file, with the line and the rule that made
 * the change. The HTML report holds every mutant, and each line of the check
 * that names work points at that report.
 */

import type {
	Comparison,
	FileMutants,
	Report,
	Survivor,
	Tally,
} from './mutation-ratchet-core.ts';
import {
	countedOf,
	detectedOf,
	mutantsOf,
	scoreOf,
	uncountedOf,
	undetectedOf,
} from './mutation-ratchet-core.ts';

/** Where the run writes the report that a person reads. */
const HTML_REPORT = 'reports/mutation/mutation.html';

/**
 * How many mutants the check names under one file. The HTML report holds
 * every mutant. These lines are the start of the work, and a full list of a
 * weak file would push the other files out of the log.
 */
const NAMED = 5;

/** The lines of the report. The report says what the run did. */
export function reportLines(
	report: Report,
	comparison: Comparison,
): readonly string[] {
	return [
		say(`the run holds ${tallyText(report.total)}`),
		say(
			`the score is ${scoreText(report.total)}, and the floor is ${percent(comparison.floor)}. ${standing(comparison)}`,
		),
		say(
			'the check fails when the score stands below the floor. The check gives no grace.',
		),
		say(
			'the score counts the mutants that the tests detect and the mutants that the tests do not detect. The score passes over a mutant that the run could not test.',
		),
		...fileLines(report),
		...weakLines(comparison),
	];
}

/** How many mutants the run holds, under each status. */
function tallyText(tally: Tally): string {
	const parts = [
		`${String(tally.Killed)} that a test killed`,
		`${String(tally.Timeout)} that ran past the time limit`,
		`${String(tally.Survived)} that survived`,
		`${String(tally.NoCoverage)} that no test ran`,
	];
	const uncounted = uncountedOf(tally);
	if (uncounted > 0) {
		parts.push(`${String(uncounted)} that the run could not test`);
	}
	return `${count(mutantsOf(tally), 'mutant')}: ${list(parts)}`;
}

/** The score of a tally, with the two counts that give it. */
function scoreText(tally: Tally): string {
	return `${percent(scoreOf(tally))} (${String(detectedOf(tally))} of ${String(countedOf(tally))})`;
}

/** What the score of the run does against the floor. */
function standing(comparison: Comparison): string {
	if (comparison.change === 0) {
		return 'The score stands at the floor.';
	}
	return comparison.change > 0
		? `The score stands ${points(comparison.change)} above the floor.`
		: `The score stands ${points(-comparison.change)} below the floor.`;
}

/** The lines that name each file that the run mutated. */
function fileLines(report: Report): readonly string[] {
	const lines = [
		say(`the run mutated ${count(report.files.length, 'file')}`),
	];
	for (const file of report.files) {
		lines.push(`  ${file.path}  ${scoreText(file.tally)}`);
	}
	return lines;
}

/** The lines that name each file whose mutants the tests do not detect. */
function weakLines(comparison: Comparison): readonly string[] {
	if (comparison.weak.length === 0) {
		return [say('the tests detect every mutant that the score counts')];
	}
	const undetected = comparison.weak.reduce(
		(total, file) => total + undetectedOf(file.tally),
		0,
	);
	const lines = [
		say(
			`${count(undetected, 'mutant')} in ${count(comparison.weak.length, 'file')} stand against the tests. The file with the lowest score stands first.`,
		),
	];
	for (const file of comparison.weak) {
		lines.push(`  ${file.path}  ${weakText(file)}`);
		for (const survivor of file.survivors.slice(0, NAMED)) {
			lines.push(`    ${survivorText(survivor)}`);
		}
		const rest = file.survivors.length - NAMED;
		if (rest > 0) {
			lines.push(`    and ${count(rest, 'mutant')} more`);
		}
	}
	lines.push(say(`the HTML report at ${HTML_REPORT} holds every mutant`));
	return lines;
}

/** How many mutants of one file the tests do not detect. */
function weakText(file: FileMutants): string {
	const parts = [`${String(file.tally.Survived)} survived`];
	if (file.tally.NoCoverage > 0) {
		parts.push(`${String(file.tally.NoCoverage)} that no test ran`);
	}
	return `${scoreText(file.tally)}  ${list(parts)}`;
}

/** One mutant that the tests do not detect. */
function survivorText(survivor: Survivor): string {
	const what =
		survivor.status === 'NoCoverage' ? 'no test ran it' : 'it survived';
	return `line ${String(survivor.line)}  ${survivor.mutator}  ${what}`;
}

/** The lines of the failure. The check fails after it says these lines. */
export function failureLines(comparison: Comparison): readonly string[] {
	if (!comparison.fails) {
		return [];
	}
	return [
		say(
			`the score fell to ${percent(comparison.score)}, and the floor is ${percent(comparison.floor)}. The fall is ${points(-comparison.change)}.`,
		),
		say(
			`read the HTML report at ${HTML_REPORT}. The report names each mutant that the tests do not detect, and the line of the source that holds it.`,
		),
		say(
			'a mutant that survives and shows a gap in the tests becomes an issue. A mutant that no test can kill gets a Stryker disable comment at the line, with one sentence that states why.',
		),
		say(
			'the floor moves only by hand. The command `node scripts/mutation-ratchet.mjs --write-baseline` writes the file, and a person commits it in the change that earns the new floor.',
		),
	];
}

/** The name that the check prints in front of each line that it says. */
export function say(text: string): string {
	return `mutation ratchet: ${text}`;
}

/** A score, as the report says it. */
function percent(value: number): string {
	return `${String(Math.round(value * 100) / 100)}%`;
}

/** A count of percentage points, as the report says it. */
function points(value: number): string {
	const size = Math.abs(Math.round(value * 100) / 100);
	return `${String(size)} percentage ${size === 1 ? 'point' : 'points'}`;
}

/** A count and the thing that it counts, with the plural of that thing. */
function count(value: number, thing: string): string {
	return `${String(value)} ${thing}${value === 1 ? '' : 's'}`;
}

/** Several phrases, with a comma between them and "and" before the last. */
function list(parts: readonly string[]): string {
	const last = parts[parts.length - 1];
	if (parts.length < 2 || last === undefined) {
		return parts.join('');
	}
	return `${parts.slice(0, -1).join(', ')} and ${last}`;
}
