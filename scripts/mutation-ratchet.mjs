/**
 * Coverage counts the lines that a test runs. Coverage does not count the
 * lines that a test checks. A mutation run answers the second question. The
 * run makes a small change to the source, and it then runs the tests. A test
 * that fails kills that change. A change that survives every test marks a
 * line that the tests run and do not check.
 *
 * This check is the ratchet of the score. The check reads the JSON report of
 * a mutation run, and it compares the score of that run against the floor in
 * `mutation-baseline.json`. One thing fails the check: a score that stands
 * below the floor. The check gives no grace.
 *
 * The baseline holds one number, and that number is the score of the whole
 * run. The report states the numbers of each file, and the check fails on no
 * number of one file.
 *
 * The ratchet is not a target. A run that scores above the floor is a report,
 * and never a failure. The floor moves only when a person writes the new
 * number into the file, in the change that earns the new floor.
 *
 * The mutation run writes the report that this check reads. Run
 * `npm run mutation` first. The check fails when the report is absent. The
 * check also fails when the baseline is absent, and it never writes a
 * baseline by itself.
 *
 *     node scripts/mutation-ratchet.mjs
 *     node scripts/mutation-ratchet.mjs <report> <baseline>
 *     node scripts/mutation-ratchet.mjs --write-baseline
 *
 * This file finds the files, reads them, prints the report, and sets the exit
 * status. `mutation-ratchet-core.ts` holds the decisions behind the numbers.
 * `mutation-ratchet-text.ts` holds the wording that the check prints.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	compare,
	readBaseline,
	readReport,
	recordOf,
} from './mutation-ratchet-core.ts';
import { failureLines, reportLines, say } from './mutation-ratchet-text.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORT = join('reports', 'mutation', 'mutation.json');
const BASELINE = 'mutation-baseline.json';

/** The reason that an error carries. */
function said(error) {
	return error instanceof Error ? error.message : String(error);
}

/** The text of a file, or the end of the run. */
function text(path, what, hint) {
	try {
		return readFileSync(path, 'utf8');
	} catch (error) {
		stop([
			say(`the check cannot read the ${what} at ${path}: ${said(error)}`),
			say(hint),
		]);
	}
}

/** Says these lines and ends the run with a failure. */
function stop(lines) {
	for (const line of lines) {
		console.error(line);
	}
	process.exit(1);
}

/** The value of a reading, or the end of the run. */
function taken(reading) {
	if (!reading.ok) {
		stop([say(reading.reason)]);
	}
	return reading.value;
}

const argv = process.argv.slice(2);
const write = argv.includes('--write-baseline');
const given = argv.filter((argument) => argument !== '--write-baseline');
const reportPath = given[0] ?? join(ROOT, REPORT);
const baselinePath = given[1] ?? join(ROOT, BASELINE);

const report = taken(
	readReport(
		text(
			reportPath,
			'mutation report',
			'the mutation run writes the report. Run `npm run mutation`.',
		),
	),
);

if (write) {
	const record = recordOf(report);
	writeFileSync(baselinePath, `${JSON.stringify(record, undefined, '\t')}\n`);
	console.log(say(`the check wrote the baseline at ${baselinePath}`));
	console.log(
		say(
			'read the number before you commit the file. The baseline is the floor that the whole repository holds.',
		),
	);
	process.exit(0);
}

const baseline = taken(
	readBaseline(
		text(
			baselinePath,
			'mutation baseline',
			'the baseline is a committed file, and this check never writes it by itself. The command `node scripts/mutation-ratchet.mjs --write-baseline` writes it.',
		),
	),
);

const comparison = compare(report, baseline);
for (const line of reportLines(report, comparison)) {
	console.log(line);
}
const failures = failureLines(comparison);
if (failures.length > 0) {
	stop(failures);
}
