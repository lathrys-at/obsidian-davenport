/**
 * This script compares the results files that the probe wrote. Each
 * environment gives one results file.
 *
 *     node tools/a11-probe/compare.mjs <results.json> [<results.json> ...]
 *
 * The script prints one row for each fixture. Then the script prints the
 * detail of each fixture that diverged. The last line is the verdict.
 *
 * The exit status is 0 when every fixture agreed. The exit status is 1
 * when any fixture diverged. The exit status is 2 when the script cannot
 * compare the files at all. The script cannot compare files that it
 * cannot read, files that are not results files, and files that came
 * from different corpora.
 *
 * This file reads the files and prints the report. The comparison itself
 * is in `compare-core.ts`. The tests for the comparison point at that
 * module.
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

/**
 * The results file at this path, read and parsed. When the file is
 * unusable, the function prints what is wrong with the file and stops the
 * script.
 */
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
