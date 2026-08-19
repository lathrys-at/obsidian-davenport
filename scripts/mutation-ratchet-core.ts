/**
 * The decisions behind the mutation ratchet:
 *
 * - what the JSON report of a mutation run says about each file;
 * - which mutants the score counts, and which mutants the score passes over;
 * - whether the number in a baseline is a score at all;
 * - how the score of a run stands against the floor.
 *
 * No function here reads a file. The caller reads the report, reads the
 * baseline, prints the report, and sets the exit status. Therefore a test can
 * exercise every decision directly. `mutation-ratchet.mjs` finds the files
 * and runs the check. `mutation-ratchet-text.ts` holds the wording that the
 * check prints.
 *
 * A mutation run makes a small change to the source, and it then runs the
 * tests. A mutant is one such change. The run gives each mutant a status. A
 * test that fails kills the mutant. A mutant survives when every test passes.
 *
 * The baseline holds one number: the score of the whole run. It holds no
 * number for each file. A file with ten mutants moves the score of that file
 * in steps of ten points, and the lane runs on a schedule. A floor for each
 * file would therefore go stale between two runs of the lane, and the run
 * would fail on the record and not on the tests. The score of the whole tree
 * moves in small steps. The report still states the numbers of each file.
 *
 * The check gives no grace. The score of a run must stand at the floor or
 * above the floor. A score below the floor fails the check.
 *
 * A report that is absent is a fault. A baseline that is absent is a fault. A
 * report that holds a status this module does not know is a fault, because a
 * new status can change the score. The check fails on each of these faults,
 * and it never writes a baseline by itself.
 */

/**
 * The files that the lane mutates. `stryker.config.mjs` reads this list, and
 * a test compares the list against the files that the coverage instrument
 * reads. The two selections must name the same files. A file that the tests
 * never run holds mutants that no test can kill, and the score of the lane
 * then falls for a file that the coverage floor does not hold.
 */
export const MUTATED = ['src/**/*.ts', '!src/**/*.test.ts'] as const;

/** A value that the text gave, or the reason that the text cannot give it. */
export type Reading<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly reason: string };

/**
 * The statuses that a mutation report gives a mutant.
 *
 * - `Killed`: a test failed, and the tests therefore detect the change.
 * - `Timeout`: the tests did not end, and the run stopped them. The change
 *   made a loop that does not end, and the tests therefore detect the change.
 * - `Survived`: a test ran the mutant, and every test passed.
 * - `NoCoverage`: no test ran the mutant.
 * - `CompileError`: the change did not compile.
 * - `RuntimeError`: the run of the tests broke for a reason that is not a
 *   failure of a test.
 * - `Ignored`: a rule of the configuration took the mutant out of the run.
 * - `Pending`: the run did not reach the mutant.
 */
export const STATUSES = [
	'Killed',
	'Timeout',
	'Survived',
	'NoCoverage',
	'CompileError',
	'RuntimeError',
	'Ignored',
	'Pending',
] as const;

/** One status of one mutant. */
export type Status = (typeof STATUSES)[number];

/**
 * The statuses that say that the tests detect the change. A test failed, or
 * the tests did not end.
 */
const DETECTED: readonly Status[] = ['Killed', 'Timeout'];

/**
 * The statuses that say that the tests do not detect the change. A test ran
 * the mutant and passed, or no test ran the mutant.
 */
const UNDETECTED: readonly Status[] = ['Survived', 'NoCoverage'];

/**
 * A mutant that the run could not test. The score passes over such a mutant,
 * because the mutant says nothing about the tests.
 */
const UNCOUNTED: readonly Status[] = [
	'CompileError',
	'RuntimeError',
	'Ignored',
];

/**
 * A status that the run did not reach. A report of a run that ended holds no
 * such mutant, and this module refuses a report that holds one.
 */
const UNFINISHED: Status = 'Pending';

/** How many mutants of each status one file holds, or the whole run holds. */
export type Tally = Readonly<Record<Status, number>>;

/** One mutant that the tests do not detect. */
export interface Survivor {
	/** The name of the rule that made the change, for example `EqualityOperator`. */
	readonly mutator: string;
	/** The line of the source where the change starts. */
	readonly line: number;
	/** `Survived` or `NoCoverage`. */
	readonly status: Status;
}

/** One file, the mutants of that file, and the mutants that survive. */
export interface FileMutants {
	readonly path: string;
	readonly tally: Tally;
	/** Every mutant that the tests do not detect, in the order of the lines. */
	readonly survivors: readonly Survivor[];
}

/** What one mutation run says. */
export interface Report {
	readonly total: Tally;
	/** Every file that the run mutated, in the order of the paths. */
	readonly files: readonly FileMutants[];
}

/** The committed record. The record holds the floor and nothing else. */
export interface Baseline {
	/** The score that the run must hold, as a percentage. */
	readonly score: number;
}

/** The name of the one number that the baseline file holds. */
const SCORE_KEY = 'score';

/** The largest score. A run that kills every counted mutant gets this score. */
const FULL = 100;

/** How many mutants of a tally the tests detect. */
export function detectedOf(tally: Tally): number {
	return sum(tally, DETECTED);
}

/** How many mutants of a tally the tests do not detect. */
export function undetectedOf(tally: Tally): number {
	return sum(tally, UNDETECTED);
}

/**
 * How many mutants of a tally the score counts. The count holds the mutants
 * that the tests detect and the mutants that the tests do not detect. The
 * count holds no mutant that the run could not test.
 */
export function countedOf(tally: Tally): number {
	return detectedOf(tally) + undetectedOf(tally);
}

/**
 * How many mutants of a tally the score passes over. The run could not test
 * these mutants, and they therefore say nothing about the tests.
 */
export function uncountedOf(tally: Tally): number {
	return sum(tally, UNCOUNTED);
}

/** How many mutants of a tally the run holds, under every status. */
export function mutantsOf(tally: Tally): number {
	return sum(tally, STATUSES);
}

function sum(tally: Tally, statuses: readonly Status[]): number {
	let count = 0;
	for (const status of statuses) {
		count += tally[status];
	}
	return count;
}

/**
 * The part of the counted mutants that the tests detect, as a percentage. The
 * number keeps two decimal places, and the places after them go away. A tally
 * that counts no mutant gets 100.
 */
export function scoreOf(tally: Tally): number {
	const counted = countedOf(tally);
	if (counted === 0) {
		return FULL;
	}
	// The multiplication comes before the division. The other order makes a
	// fraction that binary arithmetic cannot hold. The floor of that fraction
	// is then one hundredth too small, and 57 of 100 gives 56.99.
	return Math.floor((detectedOf(tally) * 10_000) / counted) / 100;
}

/**
 * One score, in hundredths of a point. The check compares two whole numbers
 * of hundredths. Therefore a score that stands at the floor never falls below
 * the floor on the small error that binary arithmetic adds to a decimal
 * fraction.
 */
function hundredths(score: number): number {
	return Math.round(score * 100);
}

/**
 * What one mutation run says, as the JSON report of StrykerJS states it. The
 * report names each file relative to the root of the repository, and this
 * module keeps those names.
 */
export function readReport(text: string): Reading<Report> {
	const parsed = objectOf(text, 'the mutation report');
	if (!parsed.ok) {
		return parsed;
	}
	const listed = parsed.value.files;
	if (!isRecord(listed)) {
		return {
			ok: false,
			reason: 'the mutation report gives no files. Run `npm run mutation`.',
		};
	}
	const files: FileMutants[] = [];
	for (const [path, value] of Object.entries(listed)) {
		const file = readFile(path, value);
		if (!file.ok) {
			return file;
		}
		files.push(file.value);
	}
	if (files.length === 0) {
		return {
			ok: false,
			reason: 'the mutation report holds no file. Run `npm run mutation`.',
		};
	}
	const report = {
		total: totalOf(files),
		files: files.sort((left, right) => order(left.path, right.path)),
	};
	if (mutantsOf(report.total) === 0) {
		return {
			ok: false,
			reason: 'the mutation report holds no mutant. Run `npm run mutation`.',
		};
	}
	return { ok: true, value: report };
}

/** The mutants of one file of the report. */
function readFile(path: string, value: unknown): Reading<FileMutants> {
	const entry = isRecord(value) ? value : undefined;
	if (entry === undefined) {
		return {
			ok: false,
			reason: `the file ${path} of the mutation report is not an object`,
		};
	}
	const listed = entry.mutants;
	if (!Array.isArray(listed)) {
		return {
			ok: false,
			reason: `the file ${path} of the mutation report gives no mutants`,
		};
	}
	const tally = emptyTally();
	const survivors: Survivor[] = [];
	for (const held of listed as readonly unknown[]) {
		const mutant = isRecord(held) ? held : undefined;
		if (mutant === undefined) {
			return {
				ok: false,
				reason: `the file ${path} of the mutation report holds a mutant that is not an object`,
			};
		}
		const status = statusOf(mutant.status);
		if (status === undefined) {
			return {
				ok: false,
				reason: `the file ${path} of the mutation report gives a mutant the status ${String(mutant.status)}, and this check knows no such status`,
			};
		}
		if (status === UNFINISHED) {
			return {
				ok: false,
				reason: `the file ${path} of the mutation report holds a mutant that the run did not reach. The run did not end.`,
			};
		}
		tally[status] += 1;
		if (UNDETECTED.includes(status)) {
			survivors.push({
				mutator: nameOf(mutant.mutatorName),
				line: lineOf(mutant.location),
				status,
			});
		}
	}
	return {
		ok: true,
		value: { path, tally, survivors: survivors.sort(byLine) },
	};
}

/** The status that a value names, or nothing when the value names none. */
function statusOf(value: unknown): Status | undefined {
	return STATUSES.find((status) => status === value);
}

/** The name of the rule that made a change. An absent name gives a mark. */
function nameOf(value: unknown): string {
	return typeof value === 'string' && value !== '' ? value : '?';
}

/** The line where a change starts. A location that holds no line gives 0. */
function lineOf(value: unknown): number {
	const location = isRecord(value) ? value : undefined;
	const start = isRecord(location?.start) ? location.start : undefined;
	const line = start?.line;
	return typeof line === 'number' && Number.isInteger(line) && line > 0
		? line
		: 0;
}

function byLine(left: Survivor, right: Survivor): number {
	return left.line - right.line || order(left.mutator, right.mutator);
}

/** A tally that counts nothing. */
function emptyTally(): Record<Status, number> {
	const tally: Partial<Record<Status, number>> = {};
	for (const status of STATUSES) {
		tally[status] = 0;
	}
	return tally as Record<Status, number>;
}

/** The tally of the whole run, as the sum of the tallies of the files. */
function totalOf(files: readonly FileMutants[]): Tally {
	const total = emptyTally();
	for (const file of files) {
		for (const status of STATUSES) {
			total[status] += file.tally[status];
		}
	}
	return total;
}

/**
 * The floor that the committed file holds.
 *
 * A person writes this file, and this file is the ratchet. The file holds one
 * number, so no other number in the file can disagree with it. The reader
 * therefore refuses a file that is not a score at all: a file that is not an
 * object, a file that gives no score, a file whose score is not a number
 * between 0 and 100, and a file that holds a key beside the score.
 *
 * The last rule catches an edit that adds a key. A key that this check does
 * not read would otherwise sit in the file and do nothing, and a reader of
 * the file would think that the key holds.
 *
 * A person can still write a lower number into the file. No rule inside one
 * number can catch that edit. The diff of the file shows it, and a person who
 * reviews the change reads that diff.
 */
export function readBaseline(text: string): Reading<Baseline> {
	const parsed = objectOf(text, 'the mutation baseline');
	if (!parsed.ok) {
		return parsed;
	}
	const other = Object.keys(parsed.value).filter((key) => key !== SCORE_KEY);
	if (other.length > 0) {
		return {
			ok: false,
			reason: `the mutation baseline holds the key ${other.join(', ')}, and this check reads the key ${SCORE_KEY} alone`,
		};
	}
	const score = parsed.value[SCORE_KEY];
	if (typeof score !== 'number' || !Number.isFinite(score)) {
		return {
			ok: false,
			reason: 'the mutation baseline gives no score. The file holds one number, and that number is the floor.',
		};
	}
	if (score < 0 || score > FULL) {
		return {
			ok: false,
			reason: `the mutation baseline gives the score ${String(score)}, and a score stands between 0 and ${String(FULL)}`,
		};
	}
	return { ok: true, value: { score } };
}

/** The record of a run, in the shape that the committed file holds. */
export function recordOf(report: Report): Baseline {
	return { score: scoreOf(report.total) };
}

/** What one run says against the floor. */
export interface Comparison {
	/** The score of the run. */
	readonly score: number;
	/** The score that the baseline holds. */
	readonly floor: number;
	/** The points that the score gains. A fall is negative. */
	readonly change: number;
	/** Every file that holds a mutant that the tests do not detect. */
	readonly weak: readonly FileMutants[];
	/** Whether the check fails. */
	readonly fails: boolean;
}

/**
 * The comparison of a run against the baseline. One thing fails the check: a
 * score that stands below the floor. The check gives no grace. A score that
 * stands at the floor passes, and a score above the floor passes.
 *
 * A file that the run no longer mutates fails no rule here. The floor covers
 * the whole tree, and the score of the whole tree carries that loss. A file
 * that leaves the tree takes its mutants out of the count, and the score of
 * the rest of the tree must still hold the floor.
 *
 * The comparison also collects each file that holds a mutant that the tests
 * do not detect. No rule uses that list. The list is the work that a person
 * does after a run: each mutant in it is a test that nobody wrote, or a
 * change that no test can detect.
 */
export function compare(report: Report, baseline: Baseline): Comparison {
	const score = scoreOf(report.total);
	const weak = report.files
		.filter((file) => undetectedOf(file.tally) > 0)
		.sort(byWeakest);
	return {
		score,
		floor: baseline.score,
		change: (hundredths(score) - hundredths(baseline.score)) / 100,
		weak,
		fails: hundredths(score) < hundredths(baseline.score),
	};
}

/** The file with the lowest score stands first. */
function byWeakest(left: FileMutants, right: FileMutants): number {
	return (
		scoreOf(left.tally) - scoreOf(right.tally) ||
		order(left.path, right.path)
	);
}

/** The alphabetical order of two names. */
function order(left: string, right: string): number {
	if (left === right) {
		return 0;
	}
	return left < right ? -1 : 1;
}

/** The JSON object that the text holds, or the reason that it holds none. */
function objectOf(
	text: string,
	what: string,
): Reading<Record<string, unknown>> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch (error) {
		return {
			ok: false,
			reason: `${what} is not JSON: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	if (!isRecord(parsed)) {
		return { ok: false, reason: `${what} is not a JSON object` };
	}
	return { ok: true, value: parsed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
