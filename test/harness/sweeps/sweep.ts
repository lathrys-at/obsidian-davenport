/**
 * What a standing assertion is: a named predicate over one run's evidence
 * that returns every violation it finds. An empty result is the assertion
 * holding.
 *
 * A sweep reports rather than throws, so one run names every sweep that
 * failed and every position each one objected to, instead of stopping at
 * the first.
 */

import type { RunEvidence } from './evidence';

export interface SweepViolation {
	/** Where in the evidence the violation sits. */
	readonly where: string;
	/** What is wrong there, in one line. */
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
 * The failure a run raises when a sweep does not hold. The message names
 * the run, every sweep that failed, and every violating position, so the
 * test that produced the evidence reads its own failure without a debugger.
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
	const header = `run ${JSON.stringify(run)} failed ${plural(reports.length, 'sweep')}`;
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
