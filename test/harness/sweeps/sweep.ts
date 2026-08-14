/**
 * A sweep is a standing assertion about one run. A sweep has a name and a
 * check function. The check function reads the evidence of the run and
 * returns every violation that it finds. An empty result means that the
 * run satisfies the assertion.
 *
 * A check function returns its violations and does not throw. Thus one run
 * can name every sweep that failed, and every position that each failed
 * sweep objected to. The run does not stop at the first failure.
 */

import type { RunEvidence } from './evidence';

export interface SweepViolation {
	/**
	 * Where the violation is. The value is a path in the evidence, or a
	 * phrase that names the position when no path fits.
	 */
	readonly where: string;
	/** What is wrong at that position, in one line. */
	readonly detail: string;
}

export interface Sweep {
	readonly name: string;
	check(evidence: RunEvidence): readonly SweepViolation[];
}

export interface SweepReport {
	readonly sweep: string;
	readonly violations: readonly SweepViolation[];
}

/**
 * The error that a run throws when a sweep finds a violation. The message
 * names the run. For each sweep that failed, the message also names the
 * sweep and every position that the sweep objected to. Thus the test that
 * produced the evidence shows the cause in its own failure message, and
 * the reader needs no debugger.
 */
export class SweepFailure extends Error {
	readonly run: string;
	readonly reports: readonly SweepReport[];

	constructor(run: string, reports: readonly SweepReport[]) {
		super(describeReports(run, reports));
		this.name = 'SweepFailure';
		this.run = run;
		this.reports = reports;
	}
}

export function describeReports(
	run: string,
	reports: readonly SweepReport[],
): string {
	const header = `the run ${JSON.stringify(run)} failed ${plural(reports.length, 'sweep')}`;
	const blocks = reports.map((report) =>
		[
			`  ${report.sweep} — ${plural(report.violations.length, 'violation')}`,
			...report.violations.map(
				(violation) => `    ${violation.where}: ${violation.detail}`,
			),
		].join('\n'),
	);
	return [header, ...blocks].join('\n');
}

function plural(count: number, noun: string): string {
	return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}
