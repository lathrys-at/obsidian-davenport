/**
 * Compares results files the probe wrote, one per environment.
 *
 *     node tools/a11-probe/compare.mjs <results.json> [<results.json> ...]
 *
 * Prints the per-fixture matrix, the detail of anything that diverged, and
 * a verdict line. The exit status is 0 when every fixture agreed, 1 when
 * any of them diverged, and 2 when the files cannot be compared at all —
 * unreadable, not results files, or written from different corpora.
 *
 * Reading and printing live here; the comparison itself is in
 * `compare-core.ts`, which is where its tests point.
 */

import { readFileSync } from 'node:fs';
import { compareRuns, parseResults } from './compare-core.ts';
import { formatReport } from './compare-format.ts';

const EXIT_DIVERGED = 1;
const EXIT_UNUSABLE = 2;
const USAGE =
	'usage: node tools/a11-probe/compare.mjs <results.json> [<results.json> ...]';

const paths = process.argv.slice(2);

if (paths.includes('--help') || paths.includes('-h')) {
	console.log(USAGE);
	process.exit(0);
}

if (paths.length === 0) {
	console.error(USAGE);
	process.exit(EXIT_UNUSABLE);
}

const runs = [];
for (const [index, path] of paths.entries()) {
	runs.push({
		label: `#${index + 1}`,
		source: path,
		results: read(path),
	});
}

const report = compareRuns(runs);
console.log(formatReport(report));

if (report.verdict === 'diverge') {
	process.exit(EXIT_DIVERGED);
}
if (report.verdict === 'incomparable') {
	process.exit(EXIT_UNUSABLE);
}

/** The results file at this path, or an exit saying what is wrong with it. */
function read(path) {
	let text;
	try {
		text = readFileSync(path, 'utf8');
	} catch (error) {
		return fail(`cannot read ${path}: ${said(error)}`);
	}
	try {
		return parseResults(text, path);
	} catch (error) {
		return fail(said(error));
	}
}

function fail(message) {
	console.error(`compare: ${message}`);
	process.exit(EXIT_UNUSABLE);
}

function said(error) {
	return error instanceof Error ? error.message : 'no reason given';
}
