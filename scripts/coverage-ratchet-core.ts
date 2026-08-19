/**
 * The decisions behind the coverage ratchet:
 *
 * - what the coverage summary of a run says about each file;
 * - whether the numbers of a baseline agree with each other;
 * - how far below the floor of a file the check accepts a fall;
 * - which file fell, which file improved, and which file the run lost.
 *
 * No function here reads a file. The caller reads the summary, reads the
 * baseline, prints the report, and sets the exit status. Therefore a test
 * can exercise every decision directly. `coverage-ratchet.mjs` finds the
 * files and runs the check. `coverage-ratchet-text.ts` holds the wording
 * that the check prints.
 *
 * The baseline holds a floor for each file, and not one floor for the whole
 * repository. One number for the whole repository hides a file with no
 * tests behind a file with many tests. The report states the numbers of the
 * whole run, and the check never fails on those numbers.
 *
 * This module reads the counts of the summary, and it computes each
 * percentage itself. The summary states a percentage of its own, and this
 * module passes over that percentage. Therefore the rounding rule of the
 * report tool cannot move a floor.
 *
 * Three things fail the comparison. The first is a fall past the grace,
 * and `GRACE` states that grace in percentage points. The second is a file
 * that the baseline holds and the run no longer reports. The third is a
 * file that the run reports and the baseline does not hold. `compare`
 * states what each rule is for.
 *
 * A summary that is absent is a fault. A baseline that is absent is a
 * fault. A baseline whose own numbers disagree with each other is a fault.
 * The check fails on each of these faults, and it never writes a baseline
 * by itself.
 */

/** A value that the text gave, or the reason that the text cannot give it. */
export type Reading<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly reason: string };

/** The four things that a coverage report counts. */
export const METRICS = [
	'statements',
	'branches',
	'functions',
	'lines',
] as const;

/** One of the four things that a coverage report counts. */
export type Metric = (typeof METRICS)[number];

/** The key that the summary gives to the numbers of the whole run. */
export const TOTAL = 'total';

/** How many of one thing a file holds, and how many of them the tests run. */
export interface Count {
	readonly total: number;
	readonly covered: number;
}

/** The four counts of one file, or the four counts of a whole run. */
export type Counts = Readonly<Record<Metric, Count>>;

/** One file, and the counts of that file. */
export interface FileCoverage {
	readonly path: string;
	readonly counts: Counts;
}

/** What one run of the tests covered. */
export interface Report {
	readonly total: Counts;
	/** Every file of the run, in the order of the paths. */
	readonly files: readonly FileCoverage[];
}

/** The committed record of a run. The record holds the same numbers. */
export type Baseline = Report;

/**
 * The fall below a floor that the check accepts, in percentage points.
 *
 * Two points is less than the fall that three untested lines make in each
 * file that this repository holds today.
 *
 * A move of covered code out of a file also lowers the percentage of that
 * file. The grace accepts a small move. A large move goes past the grace,
 * and then the baseline moves in that same change.
 *
 * The baseline never moves by itself. Therefore this grace is a band around
 * a fixed floor, and it is not an allowance for each pull request. A run
 * that stands more than two points below the recorded floor fails. The
 * count of steps that took it there does not change that result.
 */
export const GRACE = 2;

/** The grace, in hundredths of a percentage point. */
const GRACE_HUNDREDTHS = GRACE * 100;

/**
 * The part of one count that the tests run, as a percentage. The number
 * keeps two decimal places, and the places after them go away. A file that
 * holds nothing to count gets 100.
 */
export function percentOf(count: Count): number {
	if (count.total === 0) {
		return 100;
	}
	// The multiplication comes before the division. The other order makes a
	// fraction that binary arithmetic cannot hold. The floor of that
	// fraction is then one hundredth too small, and 57 of 100 gives 56.99.
	return Math.floor((count.covered * 10_000) / count.total) / 100;
}

/**
 * One percentage, in hundredths of a point. The check compares two whole
 * numbers of hundredths. Therefore a fall of exactly the grace never fails
 * on the small error that binary arithmetic adds to a decimal fraction.
 */
function hundredths(percent: number): number {
	return Math.round(percent * 100);
}

/**
 * What one run covered, as the coverage summary states it. The summary
 * names each file by an absolute path, and a committed baseline cannot hold
 * such a path. The paths of the report are therefore relative to `root`,
 * and a file outside `root` is a fault.
 */
export function readSummary(text: string, root: string): Reading<Report> {
	const parsed = objectOf(text, 'the coverage summary');
	if (!parsed.ok) {
		return parsed;
	}
	const total = readCounts(
		parsed.value[TOTAL],
		'the whole run of the coverage summary',
	);
	if (!total.ok) {
		return total;
	}
	const files: FileCoverage[] = [];
	for (const [key, value] of Object.entries(parsed.value)) {
		if (key === TOTAL) {
			continue;
		}
		const path = under(root, key);
		if (path === undefined) {
			return {
				ok: false,
				reason: `the coverage summary holds the file ${key}, and that file is not under ${root}`,
			};
		}
		const counts = readCounts(
			value,
			`the file ${path} of the coverage summary`,
		);
		if (!counts.ok) {
			return counts;
		}
		files.push({ path, counts: counts.value });
	}
	if (files.length === 0) {
		return {
			ok: false,
			reason: 'the coverage summary holds no file. Run `npm run coverage`.',
		};
	}
	const report = { total: total.value, files: files.sort(byPath) };
	const sums = checkSums(report, 'the coverage summary');
	return sums.ok ? { ok: true, value: report } : sums;
}

/**
 * The path of a file below a directory, with one separator. The function
 * gives nothing back when the file is not below the directory.
 */
function under(root: string, path: string): string | undefined {
	const file = slashed(path);
	const directory = `${slashed(root).replace(/\/+$/, '')}/`;
	return file.startsWith(directory)
		? file.slice(directory.length)
		: undefined;
}

function slashed(path: string): string {
	return path.split('\\').join('/');
}

/**
 * The record that `--write-baseline` writes for one count. The percentage
 * stands beside the two counts, so that a reader of the file and a reader
 * of its diff sees the floor itself.
 */
export interface RecordedCount {
	readonly total: number;
	readonly covered: number;
	readonly pct: number;
}

/** The four recorded counts of one file, or of a whole run. */
export type RecordedCounts = Readonly<Record<Metric, RecordedCount>>;

/** One file of the record, with the path of the file. */
export type RecordedFile = RecordedCounts & { readonly path: string };

/** The whole record that `--write-baseline` writes. */
export interface BaselineFile {
	readonly total: RecordedCounts;
	readonly files: readonly RecordedFile[];
}

/** The record of a run, in the shape that the committed file holds. */
export function recordOf(report: Report): BaselineFile {
	return {
		total: recordedCounts(report.total),
		files: [...report.files].sort(byPath).map((file) => ({
			path: file.path,
			...recordedCounts(file.counts),
		})),
	};
}

function recordedCounts(counts: Counts): RecordedCounts {
	const recorded: Record<Metric, RecordedCount> = {
		statements: recordedCount(counts.statements),
		branches: recordedCount(counts.branches),
		functions: recordedCount(counts.functions),
		lines: recordedCount(counts.lines),
	};
	return recorded;
}

function recordedCount(count: Count): RecordedCount {
	return {
		total: count.total,
		covered: count.covered,
		pct: percentOf(count),
	};
}

/**
 * The record that the committed file holds.
 *
 * A person writes this file, and this file is the ratchet. Therefore the
 * numbers in it must agree with each other. This function refuses a
 * baseline that breaks one of three rules, and it names the number that
 * disagrees.
 *
 * 1. The tests cannot run more of a thing than the file holds.
 * 2. The counts of the whole run are the sums of the counts of the files.
 *    A person who lowers one file to make room for a fall breaks these
 *    sums.
 * 3. The percentage of a count is the percentage that the two counts give.
 *    A person who lowers one floor breaks this rule.
 *
 * A person who edits one number by hand therefore cannot lower the ratchet
 * in silence.
 *
 * These three rules bound one number at a time. An edit that moves counts
 * from one file to another keeps all three rules true, and it lowers the
 * floor of the first file. These rules do not catch that edit.
 *
 * The report shows that edit. The comparison holds each metric whose counts
 * differ from the counts of its floor, and the report prints the counts of
 * that floor. Such an edit gives two files a floor with counts that the run
 * does not report.
 *
 * The report states the numbers. The report does not state a cause. A
 * person who reviews a change to this file therefore reads the diff.
 */
export function readBaseline(text: string): Reading<Baseline> {
	const parsed = objectOf(text, 'the coverage baseline');
	if (!parsed.ok) {
		return parsed;
	}
	const total = readRecordedCounts(
		parsed.value[TOTAL],
		'the whole run of the coverage baseline',
	);
	if (!total.ok) {
		return total;
	}
	const listed = parsed.value.files;
	if (!Array.isArray(listed) || listed.length === 0) {
		return { ok: false, reason: 'the coverage baseline holds no file' };
	}
	const files: FileCoverage[] = [];
	const seen = new Set<string>();
	for (const entry of listed as readonly unknown[]) {
		const path = isRecord(entry) ? entry.path : undefined;
		if (typeof path !== 'string' || path === '') {
			return {
				ok: false,
				reason: 'the coverage baseline holds a file with no path',
			};
		}
		if (seen.has(path)) {
			return {
				ok: false,
				reason: `the coverage baseline holds the file ${path} two times`,
			};
		}
		seen.add(path);
		const counts = readRecordedCounts(
			entry,
			`the file ${path} of the coverage baseline`,
		);
		if (!counts.ok) {
			return counts;
		}
		files.push({ path, counts: counts.value });
	}
	const baseline = { total: total.value, files: files.sort(byPath) };
	const sums = checkSums(baseline, 'the coverage baseline');
	return sums.ok ? { ok: true, value: baseline } : sums;
}

/** The four counts of one entry of a summary. */
function readCounts(value: unknown, where: string): Reading<Counts> {
	const entry = isRecord(value) ? value : undefined;
	if (entry === undefined) {
		return { ok: false, reason: `${where} is not an object` };
	}
	const counts: Record<Metric, Count> = {
		statements: NOTHING,
		branches: NOTHING,
		functions: NOTHING,
		lines: NOTHING,
	};
	for (const metric of METRICS) {
		const count = readCount(entry[metric], where, metric);
		if (!count.ok) {
			return count;
		}
		counts[metric] = count.value;
	}
	return { ok: true, value: counts };
}

/** A count of nothing. The reader replaces each one of these. */
const NOTHING: Count = { total: 0, covered: 0 };

function readCount(
	value: unknown,
	where: string,
	metric: Metric,
): Reading<Count> {
	const entry = isRecord(value) ? value : undefined;
	if (entry === undefined) {
		return { ok: false, reason: `${where} gives no ${metric}` };
	}
	const total = countOf(entry.total);
	const covered = countOf(entry.covered);
	if (total === undefined || covered === undefined) {
		return {
			ok: false,
			reason: `${where} gives the ${metric} a count that is not a whole number`,
		};
	}
	if (covered > total) {
		return {
			ok: false,
			reason: `${where} holds ${String(total)} ${metric}, and it says that the tests run ${String(covered)} of them`,
		};
	}
	return { ok: true, value: { total, covered } };
}

/** The four counts of one entry of the baseline, with the percentages. */
function readRecordedCounts(value: unknown, where: string): Reading<Counts> {
	const counts = readCounts(value, where);
	if (!counts.ok) {
		return counts;
	}
	const entry = isRecord(value) ? value : {};
	for (const metric of METRICS) {
		const count = counts.value[metric];
		const inner = isRecord(entry[metric]) ? entry[metric] : {};
		const stated = inner.pct;
		const holds = percentOf(count);
		if (typeof stated !== 'number' || !Number.isFinite(stated)) {
			return {
				ok: false,
				reason: `${where} gives the ${metric} no percentage`,
			};
		}
		if (hundredths(stated) !== hundredths(holds)) {
			return {
				ok: false,
				reason: `${where} gives the ${metric} the percentage ${String(stated)}, and ${String(count.covered)} of ${String(count.total)} ${metric} is ${String(holds)} percent`,
			};
		}
	}
	return counts;
}

/** Whether the counts of the whole run are the sums of the files. */
function checkSums(report: Report, what: string): Reading<true> {
	for (const metric of METRICS) {
		const stated = report.total[metric];
		let total = 0;
		let covered = 0;
		for (const file of report.files) {
			total += file.counts[metric].total;
			covered += file.counts[metric].covered;
		}
		if (total !== stated.total) {
			return {
				ok: false,
				reason: `${what} gives the whole run ${String(stated.total)} ${metric}, and its files add up to ${String(total)} ${metric}`,
			};
		}
		if (covered !== stated.covered) {
			return {
				ok: false,
				reason: `${what} says that the tests run ${String(stated.covered)} ${metric} of the whole run, and its files add up to ${String(covered)} ${metric}`,
			};
		}
	}
	return { ok: true, value: true };
}

/**
 * One metric of one file, and what that metric does against its floor.
 *
 * A move carries the two counts of the floor and the two counts of the run.
 * The comparison takes the percentage of each pair, and it holds the change
 * between the two percentages. A reader of a move computes a percentage
 * again from the counts that the move carries.
 */
export interface Move {
	readonly metric: Metric;
	/** The counts that the baseline holds. */
	readonly floor: Count;
	/** The counts that the run reports. */
	readonly now: Count;
	/** The points that the percentage gains. A fall is negative. */
	readonly change: number;
	/** Whether the fall goes past the grace. */
	readonly past: boolean;
}

/** One file, and some metrics of that file. */
export interface FileMoves {
	readonly path: string;
	readonly moves: readonly Move[];
}

/** One file, and what the file does against the baseline. */
export interface FileMove extends FileMoves {
	/** Every metric whose percentage differs from its floor. */
	readonly moves: readonly Move[];
	/** Whether one metric of this file fell past the grace. */
	readonly past: boolean;
}

/** What the run and the baseline say about each other. */
export interface Comparison {
	/** The four metrics of the whole run. The check fails on none of them. */
	readonly total: readonly Move[];
	/** Every file that differs from its floor, with the worst fall first. */
	readonly changed: readonly FileMove[];
	/**
	 * Every file that holds a metric whose counts differ from the counts of
	 * its floor, with the metrics that differ. Two different pairs of counts
	 * can give one percentage, so a metric can stand here and move no
	 * percentage. An edit of the baseline that moves counts from one file to
	 * another puts a metric of each file here.
	 */
	readonly mismatched: readonly FileMoves[];
	/**
	 * The files that the baseline holds and the run does not report. Each
	 * one fails the check.
	 */
	readonly gone: readonly string[];
	/**
	 * The files that the run reports and the baseline does not hold. Each
	 * one fails the check.
	 */
	readonly fresh: readonly string[];
	/** Whether the check fails. */
	readonly fails: boolean;
}

/**
 * The comparison of a run against the baseline. Three things fail the
 * check.
 *
 * The first is a metric of a file that falls more than the grace below the
 * floor of that metric.
 *
 * The second is a file that the baseline holds and the run does not
 * report. A file that leaves the coverage report keeps no floor. The
 * numbers of the run give no other sign of that loss.
 *
 * The third is a file that the run reports and the baseline does not hold.
 * Such a file has no floor, so no rule measures it. A file that arrives
 * with no tests would otherwise pass, and coverage would then fall through
 * each new file.
 *
 * The second rule and the third rule also close one edit that the three
 * consistency rules of the baseline accept. A person can delete the entry
 * of a file and subtract the counts of that file from the whole run. The
 * sums still hold, and that file loses its floor. The third rule fails the
 * next run.
 *
 * A change that adds a file, moves a file, or deletes a file therefore
 * writes the baseline in that same change.
 *
 * Nothing else fails the check. The numbers of the whole run never fail
 * the check. Coverage that rises never fails the check.
 *
 * The comparison also collects each metric whose counts differ from the
 * counts of its floor. No rule uses that list. The list is what makes an
 * edit of the baseline that moves counts legible in the report.
 *
 * The comparison reports every move that it finds. The report is what makes
 * the numbers legible.
 */
export function compare(report: Report, baseline: Baseline): Comparison {
	const floors = new Map(
		baseline.files.map((file) => [file.path, file.counts]),
	);
	const changed: FileMove[] = [];
	const mismatched: FileMoves[] = [];
	const fresh: string[] = [];
	for (const file of report.files) {
		const was = floors.get(file.path);
		if (was === undefined) {
			fresh.push(file.path);
			continue;
		}
		floors.delete(file.path);
		const all = movesOf(was, file.counts);
		const moves = all.filter((move) => move.change !== 0);
		if (moves.length > 0) {
			changed.push({
				path: file.path,
				moves,
				past: moves.some((move) => move.past),
			});
		}
		const other = all.filter((move) => !alike(move.floor, move.now));
		if (other.length > 0) {
			mismatched.push({ path: file.path, moves: other });
		}
	}
	const gone = [...floors.keys()].sort(order);
	return {
		total: movesOf(baseline.total, report.total),
		changed: changed.sort(byWorstFall),
		mismatched,
		gone,
		fresh,
		fails:
			changed.some((file) => file.past) ||
			gone.length > 0 ||
			fresh.length > 0,
	};
}

/** Whether two counts hold the same two numbers. */
function alike(left: Count, right: Count): boolean {
	return left.total === right.total && left.covered === right.covered;
}

/** What the four metrics of one file do against four floors. */
function movesOf(floors: Counts, now: Counts): readonly Move[] {
	return METRICS.map((metric) => {
		const held = floors[metric];
		const ran = now[metric];
		const fall = hundredths(percentOf(held)) - hundredths(percentOf(ran));
		return {
			metric,
			floor: held,
			now: ran,
			change: -fall / 100,
			past: fall > GRACE_HUNDREDTHS,
		};
	});
}

/** The worst fall of a file. A file that only rose gets its smallest rise. */
function worstOf(file: FileMove): number {
	return Math.min(...file.moves.map((move) => move.change));
}

function byWorstFall(left: FileMove, right: FileMove): number {
	return worstOf(left) - worstOf(right) || order(left.path, right.path);
}

function byPath(left: FileCoverage, right: FileCoverage): number {
	return order(left.path, right.path);
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

/** A count, or nothing when the value is not a count. */
function countOf(value: unknown): number | undefined {
	return typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= 0 &&
		Number.isFinite(value)
		? value
		: undefined;
}
