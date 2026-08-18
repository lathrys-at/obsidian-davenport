/**
 * The wording of everything that the bundle-size check prints. The check
 * prints two kinds of line. The report says what the build weighs, where the
 * weight comes from, and what moved against the baseline. The failure says
 * which size went past the step, and it names the modules that grew.
 *
 * Each line that states a fact carries the name of the check, so that the
 * line stays legible in a log that holds the output of many steps. A line
 * that continues a statement carries no name, and it stands indented under
 * the line that it continues.
 */

import type {
	Change,
	Comparison,
	Move,
	OutputMove,
	Report,
} from './bundle-size-core.ts';
import { OVERHEAD } from './bundle-size-core.ts';

/** The count of modules that the table of contributors shows. */
const TABLE_ROWS = 15;

/** The lines of the report. The report says what the build weighs. */
export function reportLines(
	report: Report,
	comparison: Comparison,
): readonly string[] {
	return [
		say(
			`the build weighs ${bytes(report.raw)} raw and ${bytes(report.compressed)} compressed`,
		),
		say(
			`the baseline holds ${bytes(comparison.raw.baseline)} raw and ${bytes(comparison.compressed.baseline)} compressed. The raw size is ${moved(comparison.raw.change)}, and the compressed size is ${moved(comparison.compressed.change)}.`,
		),
		say(
			`the step is ${bytes(comparison.raw.step)} raw and ${bytes(comparison.compressed.step)} compressed. The check fails on growth past the step, and it fails on nothing else.`,
		),
		...outputLines(comparison),
		...moduleLines(report, comparison),
	];
}

/** The lines that name each output file that the build makes. */
function outputLines(comparison: Comparison): readonly string[] {
	const lines = [
		say(
			`the build makes ${count(comparison.outputs.length, 'output file')}. An entry file loads with the plugin, and a chunk loads when the code asks for it.`,
		),
	];
	for (const output of comparison.outputs) {
		lines.push(`  ${outputRow(output)}`);
	}
	for (const path of comparison.gone) {
		lines.push(
			`  ${path}  the baseline holds this file, and the build does not make it`,
		);
	}
	return lines;
}

function outputRow(output: OutputMove): string {
	const sizes = `${output.kind}  ${bytes(output.raw)} raw  ${bytes(output.compressed)} compressed`;
	if (output.was === undefined) {
		return `${output.path}  ${sizes}  the baseline does not hold this file`;
	}
	return `${output.path}  ${sizes}  raw ${moved(output.raw - output.was.raw)}, compressed ${moved(output.compressed - output.was.compressed)}`;
}

/** The lines that name the modules with the most bytes in the build. */
function moduleLines(
	report: Report,
	comparison: Comparison,
): readonly string[] {
	const changed = new Map(
		[...comparison.grew, ...comparison.shrank].map((move) => [
			move.name,
			move.change,
		]),
	);
	const rest = report.modules.slice(TABLE_ROWS);
	const lines = [
		say(
			'the modules that hold the most bytes. The overhead is what the bundler puts around them.',
		),
	];
	const row = (name: string, size: number): string => {
		const change = changed.get(name);
		return `  ${name}  ${bytes(size)}  ${change === undefined ? 'no change' : moved(change)}`;
	};
	for (const module of report.modules.slice(0, TABLE_ROWS)) {
		lines.push(row(module.name, module.bytes));
	}
	if (rest.length > 0) {
		const total = rest.reduce((sum, module) => sum + module.bytes, 0);
		lines.push(
			`  the other ${count(rest.length, 'module')} hold ${bytes(total)} together`,
		);
	}
	lines.push(row(OVERHEAD, report.overhead));
	return lines;
}

/** The lines of the failure. The check fails after it says these lines. */
export function failureLines(comparison: Comparison): readonly string[] {
	if (!comparison.fails) {
		return [];
	}
	const lines: string[] = [];
	if (comparison.raw.past) {
		lines.push(say(pastStep('raw', comparison.raw)));
	}
	if (comparison.compressed.past) {
		lines.push(say(pastStep('compressed', comparison.compressed)));
	}
	lines.push(...grewLines(comparison.grew));
	lines.push(
		say(
			'accept this growth in the pull request that causes it, and write the new numbers into the baseline in the same change. The command `node scripts/bundle-size.mjs --write-baseline` writes the file.',
		),
	);
	return lines;
}

function pastStep(name: string, change: Change): string {
	return `the ${name} size grew from ${bytes(change.baseline)} to ${bytes(change.now)}. The growth of ${bytes(change.change)} goes past the step of ${bytes(change.step)}.`;
}

/** The lines that name the modules that grew. */
function grewLines(grew: readonly Move[]): readonly string[] {
	if (grew.length === 0) {
		return [
			say(
				'no module grew. The bundler added the bytes around the modules.',
			),
		];
	}
	const lines = [say(`the ${count(grew.length, 'module')} that grew`)];
	for (const move of grew) {
		lines.push(
			`  ${move.name}  from ${bytes(move.baseline)} to ${bytes(move.now)}  ${moved(move.change)}`,
		);
	}
	return lines;
}

/** The name that the check prints in front of each line that it says. */
export function say(text: string): string {
	return `bundle size: ${text}`;
}

/** A count of bytes, as the report says it. */
function bytes(value: number): string {
	const size = Math.abs(value);
	const large = size >= 1000 ? ` (${(size / 1000).toFixed(1)} kB)` : '';
	return `${String(size)} bytes${large}`;
}

/** What one number did against the baseline. */
function moved(change: number): string {
	if (change === 0) {
		return 'the same';
	}
	return change > 0 ? `${bytes(change)} more` : `${bytes(change)} less`;
}

/** A count and the thing that it counts, with the plural of that thing. */
function count(value: number, thing: string): string {
	return `${String(value)} ${thing}${value === 1 ? '' : 's'}`;
}
