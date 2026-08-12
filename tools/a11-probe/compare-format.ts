/**
 * The report as text.
 *
 * Plain ASCII and fixed columns, because this output is read on a terminal
 * and transcribed into the verification record by hand.
 */

import type { ComparisonReport, FixtureComparison } from './compare-core';

const SHORT_HASH = 8;
const MIN_COLUMN = 18;

/** The whole comparison, ready to print. */
export function formatReport(report: ComparisonReport): string {
	const lines: string[] = ['frontmatter emission comparison', ''];
	lines.push(...environments(report), '');
	lines.push(...fixtures(report), '');

	const divergences = divergenceDetail(report);
	if (divergences.length > 0) {
		lines.push(...divergences, '');
	}
	const notes = warnings(report);
	if (notes.length > 0) {
		lines.push(...notes, '');
	}
	lines.push(verdict(report));
	return lines.join('\n');
}

function environments(report: ComparisonReport): string[] {
	const lines = ['environments'];
	for (const environment of report.environments) {
		lines.push(`  ${environment.label}  ${environment.source}`);
		lines.push(
			`      ${environment.description}, ${String(environment.fixtures)} fixtures, ${environment.timestamp}`,
		);
	}
	if (report.environments.length < 2) {
		lines.push('  one environment only, so there is nothing to compare');
	}
	return lines;
}

function fixtures(report: ComparisonReport): string[] {
	const width = Math.max(
		MIN_COLUMN,
		...report.fixtures.map((fixture) => fixture.id.length),
	);
	const lines = ['fixtures'];
	for (const fixture of report.fixtures) {
		lines.push(
			`  ${fixture.id.padEnd(width)}  ${fixture.outcome.padEnd(10)}  ${summary(fixture, report.environments.length)}`,
		);
	}
	return lines;
}

function summary(fixture: FixtureComparison, environments: number): string {
	const parts: string[] = [];
	if (fixture.groups.length === 1) {
		const [only] = fixture.groups;
		if (only !== undefined) {
			const scope =
				only.labels.length === environments
					? `all ${String(environments)}`
					: only.labels.join(',');
			parts.push(
				`${scope} emitted ${String(only.byteLength)} bytes, ${short(only.hash)}`,
			);
		}
	} else if (fixture.groups.length > 1) {
		parts.push(
			fixture.groups
				.map(
					(group) =>
						`${group.labels.join(',')} ${short(group.hash)} (${String(group.byteLength)} bytes)`,
				)
				.join(' | '),
		);
	}
	if (fixture.errors.length > 0) {
		const refused = fixture.errors.map((error) => error.label).join(',');
		parts.push(
			fixture.errors.length === environments
				? 'refused by every environment'
				: `refused by ${refused}`,
		);
	}
	if (fixture.missing.length > 0) {
		parts.push(`no record from ${fixture.missing.join(',')}`);
	}
	return parts.join('; ');
}

function divergenceDetail(report: ComparisonReport): string[] {
	const diverging = report.fixtures.filter(
		(fixture) => fixture.divergences.length > 0,
	);
	if (diverging.length === 0) {
		return [];
	}
	const lines = ['divergences'];
	for (const fixture of diverging) {
		lines.push(`  ${fixture.id}`);
		for (const divergence of fixture.divergences) {
			const what =
				divergence.kind === 'byte'
					? `first differing byte at offset ${String(divergence.offset)}`
					: `identical up to offset ${String(divergence.offset)}, where one output ends`;
			lines.push(
				`    ${divergence.reference} against ${divergence.other}: ${what}`,
			);
			lines.push(`      ${divergence.reference}`);
			lines.push(
				...divergence.referenceDump.map((row) => `      ${row}`),
			);
			lines.push(`      ${divergence.other}`);
			lines.push(...divergence.otherDump.map((row) => `      ${row}`));
		}
	}
	return lines;
}

function warnings(report: ComparisonReport): string[] {
	const lines: string[] = [];
	for (const id of report.corpusMismatches) {
		lines.push(
			`  ${id}: the runs did not start from the same fixture text, so their outputs prove nothing`,
		);
	}
	for (const failure of report.integrityFailures) {
		lines.push(`  ${failure.label} ${failure.id}: ${failure.note}`);
	}
	for (const fixture of report.fixtures) {
		for (const error of fixture.errors) {
			lines.push(`  ${error.label} ${fixture.id}: ${error.message}`);
		}
	}
	return lines.length === 0 ? [] : ['notes', ...lines];
}

function verdict(report: ComparisonReport): string {
	const across = `across ${String(report.environments.length)} environments`;
	if (report.verdict === 'incomparable') {
		return 'verdict: these runs cannot be compared as they stand; the notes above say why';
	}
	if (report.verdict === 'diverge') {
		const diverged = report.compared - report.agreed;
		return `verdict: ${String(diverged)} of ${String(report.compared)} fixtures diverge ${across}; frontmatter emission is not byte-identical here`;
	}
	if (report.environments.length < 2) {
		return `verdict: ${String(report.compared)} fixtures recorded from one environment; a comparison needs a second`;
	}
	const refused = report.fixtures.filter(
		(fixture) => fixture.outcome === 'error',
	).length;
	const aside =
		refused === 0
			? ''
			: ` (${String(refused)} refused by every environment)`;
	return `verdict: all ${String(report.compared)} fixtures agree ${across}${aside}; frontmatter emission was byte-identical here`;
}

function short(hash: string): string {
	return hash.slice(0, SHORT_HASH);
}
