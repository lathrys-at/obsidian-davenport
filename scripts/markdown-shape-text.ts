/**
 * The wording of everything that the markdown shape check prints. The check
 * prints two kinds of line. The report says how much the check read. The
 * failure names each place that holds a defect, and it says what to do
 * about that place.
 *
 * Each line that states a fact carries the name of the check, so that the
 * line stays legible in a log that holds the output of many steps. A line
 * that continues a statement carries no name, and it stands indented under
 * the line that it continues.
 */

import type { Defect, Site, Survey } from './markdown-shape-core.ts';

/** The lines of the report. The report says how much the check read. */
export function reportLines(result: Survey): readonly string[] {
	return [
		say(
			`the check read ${count(result.documents, 'document')} and ${count(result.lines, 'line')}`,
		),
		say(
			'the check looks for two defects. The first is a line that ends with white space. The second is a line that an edit left short in the middle of a paragraph.',
		),
	];
}

/** The lines of the failure. The check fails after it says these lines. */
export function failureLines(result: Survey): readonly string[] {
	if (result.documents === 0) {
		return [
			say('the check found no document, and it therefore proves nothing'),
			say(
				'point the check at a directory that holds markdown files, or repair the walk that finds them',
			),
		];
	}
	if (result.sites.length === 0) {
		return [];
	}
	const lines: string[] = [];
	for (const site of result.sites) {
		lines.push(...siteLines(site));
	}
	lines.push(
		say(
			`the check found ${count(result.sites.length, 'place')}. Repair each place: change the white space only, and keep every word.`,
		),
	);
	return lines;
}

/** The lines that describe one place that holds a defect. */
function siteLines(site: Site): readonly string[] {
	const where = `${site.path}:${String(site.defect.line)}`;
	return [say(`${where}: ${reason(site.defect)}`), `  ${site.defect.text}`];
}

/** What is wrong at one place, and what to do about it. */
function reason(defect: Defect): string {
	if (defect.kind === 'trailing space') {
		return 'the line ends with white space. Remove the white space at the end of the line.';
	}
	return (
		`the line holds ${count(defect.text.length, 'character')}, and the line stands in the middle of a paragraph. ` +
		`The longest line of that paragraph holds ${count(defect.width, 'character')}. ` +
		`The next line starts with "${defect.unit}", and that part fits at the end of this line. ` +
		'An edit left this line short. Join this line with the line after it. Then break the lines of the paragraph again, and keep every word.'
	);
}

/** The name that the check prints in front of each line that it says. */
export function say(text: string): string {
	return `markdown shape: ${text}`;
}

/** A count and the thing that it counts, with the plural of that thing. */
function count(value: number, thing: string): string {
	return `${String(value)} ${thing}${value === 1 ? '' : 's'}`;
}
