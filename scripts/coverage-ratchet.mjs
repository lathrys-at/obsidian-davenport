/**
 * Coverage was report-only, and nothing stopped a slow fall. This check is
 * the ratchet. The check reads the coverage summary of a run, and it
 * compares that run against `coverage-baseline.json`. Three things fail the
 * check:
 *
 * - one metric of one file falls more than a small grace below the floor
 *   that the baseline holds for that metric;
 * - the baseline holds a file, and the run does not report that file. Such
 *   a file keeps no floor, and the numbers of the run give no other sign
 *   of the loss;
 * - the run reports a file, and the baseline holds no floor for that file.
 *   Such a file has no floor, so no rule measures it.
 *
 * The baseline holds a floor for each file, and not one floor for the whole
 * repository. One number for the whole repository hides a file with no
 * tests behind a file with many tests.
 *
 * The ratchet is not a target. A run that covers more than the baseline is
 * a report, and never a failure. The baseline moves only when a person
 * writes the new numbers into it, in the pull request that causes the
 * change.
 *
 * The coverage run writes the summary that this check reads. Run
 * `npm run coverage` first. The check fails when the summary is absent. The
 * check also fails when the baseline is absent, and it never writes a
 * baseline by itself.
 *
 *     node scripts/coverage-ratchet.mjs
 *     node scripts/coverage-ratchet.mjs <summary> <baseline>
 *     node scripts/coverage-ratchet.mjs --write-baseline
 *
 * This file finds the files, reads them, prints the report, and sets the
 * exit status. `coverage-ratchet-core.ts` holds the decisions behind the
 * numbers. `coverage-ratchet-text.ts` holds the wording that the check
 * prints.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	compare,
	readBaseline,
	readSummary,
	recordOf,
} from './coverage-ratchet-core.ts';
import { failureLines, reportLines, say } from './coverage-ratchet-text.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SUMMARY = join('coverage', 'coverage-summary.json');
const BASELINE = 'coverage-baseline.json';

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
const summaryPath = given[0] ?? join(ROOT, SUMMARY);
const baselinePath = given[1] ?? join(ROOT, BASELINE);

// The summary names each file by an absolute path. The coverage run writes
// the summary into a directory at the top of the repository. Therefore the
// directory above the summary is the root, and the baseline names each
// file relative to that root.
const root = resolve(dirname(summaryPath), '..');

const report = taken(
	readSummary(
		text(
			summaryPath,
			'coverage summary',
			'the coverage run writes the summary. Run `npm run coverage`.',
		),
		root,
	),
);

if (write) {
	const record = recordOf(report);
	writeFileSync(baselinePath, `${JSON.stringify(record, undefined, '\t')}\n`);
	console.log(say(`the check wrote the baseline at ${baselinePath}`));
	console.log(
		say(
			'read the difference before you commit the file. The baseline is the floor that each file of this repository holds.',
		),
	);
	process.exit(0);
}

const baseline = taken(
	readBaseline(
		text(
			baselinePath,
			'coverage baseline',
			'the baseline is a committed file, and this check never writes it by itself. The command `node scripts/coverage-ratchet.mjs --write-baseline` writes it.',
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
