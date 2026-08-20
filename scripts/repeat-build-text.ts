/**
 * The wording of everything that the repeat-build check prints. The check
 * prints two kinds of line. The report says what the two runs of the build
 * wrote, and it gives the digest of each file that the two runs wrote in the
 * same way. The failure names each file that the two runs did not write in
 * the same way, and it shows the octets around the first difference.
 *
 * Each line that states a fact carries the name of the check, so that the
 * line stays legible in a log that holds the output of many steps. A line
 * that continues a statement carries no name, and it stands indented under
 * the line that it continues.
 */

import type { Comparison, Difference, Window } from './repeat-build-core.ts';
import { LINE } from './repeat-build-core.ts';

/** The lines of the report. The report says what the two runs wrote. */
export function reportLines(comparison: Comparison): readonly string[] {
	const lines = [
		say(
			'the check ran the build two times. Each run started with the output files of the build absent.',
		),
	];
	if (comparison.matches.length > 0) {
		lines.push(
			say(
				`the two runs wrote ${count(comparison.matches.length, 'file')} with the same octets`,
			),
		);
		for (const match of comparison.matches) {
			lines.push(
				`  ${match.path}  ${octets(match.octets)}  sha256 ${match.digest}`,
			);
		}
	}
	return lines;
}

/** The lines of the failure. The check fails after it says these lines. */
export function failureLines(comparison: Comparison): readonly string[] {
	if (!comparison.fails) {
		return [];
	}
	if (nothing(comparison)) {
		return [
			say(
				'the two runs wrote no file. The check compared no octet, and it therefore proves nothing.',
			),
			say(
				'the build must write a metafile, and that metafile must name at least one output file.',
			),
		];
	}
	const lines: string[] = [];
	for (const path of comparison.onlyFirst) {
		lines.push(
			say(`the first run wrote ${path}, and the second run did not`),
		);
	}
	for (const path of comparison.onlySecond) {
		lines.push(
			say(`the second run wrote ${path}, and the first run did not`),
		);
	}
	for (const difference of comparison.differences) {
		lines.push(...differenceLines(difference));
	}
	lines.push(
		say(
			'the build is not a function of the source alone. Find the input that changed between the two runs. A time stamp, an absolute path, and an order that a set or a map gives are the usual causes.',
		),
	);
	return lines;
}

/** True when the two runs wrote no file at all. */
function nothing(comparison: Comparison): boolean {
	return (
		comparison.matches.length === 0 &&
		comparison.differences.length === 0 &&
		comparison.onlyFirst.length === 0 &&
		comparison.onlySecond.length === 0
	);
}

/**
 * The lines that describe one file that the two runs wrote in different ways.
 * The first line names the file, the place of the first difference, and the
 * count of octets of each of the two files. The lines after it show the
 * octets of each run around that place.
 */
function differenceLines(difference: Difference): readonly string[] {
	return [
		say(
			`${difference.path} is not the same in the two runs. The first octet that differs is at ${String(difference.offset)}. The first run wrote ${octets(difference.firstOctets)}, and the second run wrote ${octets(difference.secondOctets)}.`,
		),
		'  the first run',
		...dumpLines(difference.firstWindow),
		'  the second run',
		...dumpLines(difference.secondWindow),
	];
}

/**
 * The lines that show a part of a file. Each line gives the place of its
 * first octet, then the octets as hexadecimal, then the same octets as text.
 * A character that a terminal cannot show stands as a full stop.
 */
function dumpLines(window: Window): readonly string[] {
	if (window.bytes.length === 0) {
		return ['    the file ends before that place'];
	}
	const lines: string[] = [];
	for (let at = 0; at < window.bytes.length; at += LINE) {
		const row = window.bytes.slice(at, at + LINE);
		lines.push(
			`    ${place(window.start + at)}  ${hex(row)}  |${legible(row)}|`,
		);
	}
	return lines;
}

/** The place of an octet in a file, as eight hexadecimal digits. */
function place(value: number): string {
	return value.toString(16).padStart(8, '0');
}

/** One line of octets, as hexadecimal. A short line keeps the columns. */
function hex(row: Uint8Array): string {
	const pairs = [...row].map((value) => value.toString(16).padStart(2, '0'));
	while (pairs.length < LINE) {
		pairs.push('  ');
	}
	return pairs.join(' ');
}

/** One line of octets, as text. Each other octet stands as a full stop. */
function legible(row: Uint8Array): string {
	return [...row]
		.map((value) =>
			value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '.',
		)
		.join('');
}

/** The name that the check prints in front of each line that it says. */
export function say(text: string): string {
	return `repeat build: ${text}`;
}

/** A count of octets, as the report says it. */
function octets(value: number): string {
	const large = value >= 1000 ? ` (${(value / 1000).toFixed(1)} kB)` : '';
	return `${String(value)} octets${large}`;
}

/** A count and the thing that it counts, with the plural of that thing. */
function count(value: number, thing: string): string {
	return `${String(value)} ${thing}${value === 1 ? '' : 's'}`;
}
