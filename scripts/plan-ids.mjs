/**
 * Every test title in the suites carries the ID of the plan item that the
 * test implements. The coverage map of the plan points back at those IDs.
 * The titles are therefore the traceability surface. This check compares the
 * titles with the plan.
 *
 * The check fails when a title cites an ID that the plan does not contain. A
 * renamed plan item causes this failure. A mistyped title also causes this
 * failure. The check reports the test IDs that no title cites, and the check
 * does not fail on these IDs. The plan lands in stages by design.
 *
 * The check also fails when the plan gives it no vocabulary to work with. A
 * plan file that the check cannot read is one such fault. A plan that
 * declares a suite and defines no ID for that suite is another. Therefore a
 * change to the format of the plan turns this check red, and it never leaves
 * a check that reads nothing and reports success.
 *
 * The check reads the plan and the suite files. It reads no other file. The
 * unit tests beside the harness take their names from what they cover, and
 * not from a plan ID. Therefore the suite directory is the whole surface.
 *
 * The check also fails when it cannot read a title of a suite file. The check
 * reads a plain string, and the check reads no other shape of title. A title
 * that a program builds from parts is one example. A template with an
 * expression in it is another example. Such a title carries no ID that the
 * check can read, and the title loses its trace to the plan. The check names
 * the file, the line, and the text that stands in the title. A call of a
 * suite file that gives no title at all also fails the check. This rule holds
 * for the files that the check reads, and for no other file.
 *
 * The check reads the plan and the suite directory of this repository. If you
 * give a path as the first argument, the check reads that plan instead. If
 * you give a second path, the check reads the suite files under that
 * directory. Then the same rules can run over a tree in any location.
 *
 *     node scripts/plan-ids.mjs
 *     node scripts/plan-ids.mjs <plan-file> <suite-directory>
 *
 * This file finds the files, reads them, and sets the exit status.
 * `plan-ids-core.ts` holds the rules for an ID and the comparison.
 * `plan-ids-titles.ts` reads the titles out of one file of source.
 * `plan-ids-text.ts` holds the wording that the check prints.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	planFaults,
	readPlan,
	readSuites,
	reconcile,
} from './plan-ids-core.ts';
import { failureLines, faultLines, reportLines, say } from './plan-ids-text.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLAN = 'docs/davenport-test-plan.md';
const SUITES = 'test/suites';

/**
 * The files that the check reads for the citations. The set holds every file
 * under the suite root whose name ends in `.test.ts`, at any depth. The set
 * holds no other file. Therefore this function states where the rules of the
 * suites apply. Git carries no empty directory, so a root that does not exist
 * gives an empty set.
 */
function suiteFiles(root) {
	if (!existsSync(root)) {
		return [];
	}
	const found = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			found.push(...suiteFiles(path));
		} else if (entry.name.endsWith('.test.ts')) {
			found.push(path);
		}
	}
	return found.sort();
}

/**
 * The path as the report says it. A path inside the repository reads from the
 * top of the repository, with one separator on every platform. A path outside
 * the repository reads whole.
 */
function shown(path) {
	const inside = relative(ROOT, path);
	return inside.startsWith('..') ? path : inside.split(sep).join('/');
}

/** The reason that an error carries. */
function said(error) {
	return error instanceof Error ? error.message : String(error);
}

const planPath = process.argv[2] ?? join(ROOT, PLAN);
const suiteRoot = process.argv[3] ?? join(ROOT, SUITES);

let plan;
try {
	plan = readFileSync(planPath, 'utf8');
} catch (error) {
	console.error(
		say(
			`the check cannot read the plan file at ${planPath}: ${said(error)}`,
		),
	);
	process.exit(1);
}

const corpus = readPlan(plan);
const faults = faultLines(planFaults(corpus));
if (faults.length > 0) {
	for (const line of faults) {
		console.error(line);
	}
	process.exit(1);
}

const files = suiteFiles(suiteRoot).map((path) => ({
	path: shown(path),
	text: readFileSync(path, 'utf8'),
}));
const scan = readSuites(files, corpus);
const result = reconcile(corpus, scan);

if (files.length === 0) {
	console.log(
		say(`the directory ${shown(suiteRoot)} holds no suite file yet`),
	);
}
for (const line of reportLines(corpus, scan, result)) {
	console.log(line);
}
const failures = failureLines(scan, result);
if (failures.length > 0) {
	for (const line of failures) {
		console.error(line);
	}
	process.exit(1);
}
