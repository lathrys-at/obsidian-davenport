/**
 * The wording of everything that the fuzzing lane prints.
 *
 * The lane prints two kinds of line. The report says how much the run
 * examined and what it met. The failure names each new finding and says
 * what to do about it.
 *
 * Every line that states a fact carries the name of the lane, so that the
 * line stays legible in a log that holds the output of many steps. The
 * report states the count of the inputs that the run examined, and it
 * states that count on a run that failed as well. A run that examined
 * nothing proves nothing, and the reader must see which of the two
 * happened.
 */

import type { RunFinding, RunReport } from './fuzz-ics-campaign.ts';

/** The name that the lane prints in front of each line that it says. */
export function say(text: string): string {
	return `ics fuzz: ${text}`;
}

/** The lines of the report. */
export function reportLines(report: RunReport): readonly string[] {
	const lines = [
		say(
			`the run examined ${count(report.examined, 'input')} in ${seconds(report.elapsedMs)}, under the seed ${String(report.seed)}`,
		),
		say(
			`the run made ${count(report.passes, 'pass', 'passes')}, and it made ${count(report.shrinks, 'smaller input')} while it made a finding small`,
		),
	];
	const known = report.known.reduce((total, entry) => total + entry.count, 0);
	lines.push(
		say(
			report.known.length === 0
				? 'the ledger of the filed defects met nothing'
				: `the ledger of the filed defects set ${count(known, 'finding')} aside`,
		),
	);
	for (const entry of report.known) {
		lines.push(
			`  issue ${String(entry.issue)}, ${entry.name}: ${String(entry.count)}`,
		);
	}
	lines.push(
		say(`the run found ${count(report.findings.length, 'new finding')}`),
	);
	return lines;
}

/** The lines of the failure. The lane fails after it says these lines. */
export function failureLines(report: RunReport): readonly string[] {
	if (report.examined === 0) {
		return [
			say('the run examined no input, so this run shows nothing'),
			say(
				'give the run a budget that is longer than nothing, or repair the code that draws the inputs',
			),
		];
	}
	if (report.findings.length === 0) {
		return [];
	}
	const lines: string[] = [];
	for (const [at, finding] of report.findings.entries()) {
		lines.push(...findingLines(at + 1, finding));
	}
	if (report.capped) {
		lines.push(
			say(
				`the run stopped at its limit of ${count(report.findings.length, 'new finding')}. Two of these findings can have one root.`,
			),
		);
	}
	lines.push(
		say(
			`the run examined ${count(report.examined, 'input')} and found ${count(report.findings.length, 'new finding')}`,
		),
		say(
			'read the report and the seed files of this run. A finding that is worth keeping becomes a fixture of the crash corpus, and test/README.md states that procedure.',
		),
	);
	return lines;
}

/** The lines that describe one new finding. */
function findingLines(number: number, finding: RunFinding): readonly string[] {
	return [
		say(
			`finding ${String(number)}: ${finding.kind} at the ${finding.stage}${
				finding.repeats === 0
					? ''
					: `, and the run met it ${count(finding.repeats, 'time')} again`
			}`,
		),
		`  ${finding.detail}`,
		`  the input came from ${finding.recipe}`,
		`  the smallest input: ${JSON.stringify(finding.minimized)}`,
		`  repeat the draw with: npm run fuzz -- --seed=${String(finding.seed)}${
			finding.path === null ? '' : ` (path ${finding.path})`
		}`,
	];
}

/** The name of the file that holds the input of one finding. */
export function seedFileName(number: number, finding: RunFinding): string {
	return `finding-${String(number).padStart(2, '0')}-${finding.kind}.ics`;
}

/** The lines that the graduation of one finding prints. */
export function graduationLines(
	name: string,
	path: string,
	kind: string | null,
): readonly string[] {
	return [
		say(`the file ${path} now holds the input`),
		say(
			kind === null
				? 'the input gives no finding today. Add the fixture with the state "held", and add a case that states the rule that the engine now keeps.'
				: `the input gives the finding ${kind}. Add the fixture with the state "open" and the number of the issue that holds the defect.`,
		),
		say(
			`add the entry to the index in test/harness/fixtures/ics-crash-corpus.ts, with the id ${JSON.stringify(name)} and one sentence that says what the input holds`,
		),
		say(
			'add the case that states the rule to test/properties/ics/known-defects.test.ts, and skip that case while the defect waits for a decision',
		),
	];
}

/**
 * A count and the thing that it counts. The plural takes an `s` unless the
 * caller states another plural.
 */
function count(value: number, thing: string, plural = `${thing}s`): string {
	return `${String(value)} ${value === 1 ? thing : plural}`;
}

/** A length of time, in seconds. */
function seconds(value: number): string {
	return `${(value / 1000).toFixed(1)} seconds`;
}
