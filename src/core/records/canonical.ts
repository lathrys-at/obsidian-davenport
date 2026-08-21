/**
 * The canonical bytes of one record file.
 *
 * A record file has two parts. The first part is the frontmatter, which
 * the owned emitter writes from the closed schema. The second part is the
 * base snapshot, which stands in a fenced block after the frontmatter.
 *
 * The bytes follow from the content of the record alone. The functions
 * here read no clock, they hold no state, and they ask the platform
 * nothing. Two devices that hold one content therefore write one file.
 *
 * Three rules fix the second part.
 *
 * - The file uses one line ending, and that ending is the line feed. The
 *   format of the base snapshot ends every line with a carriage return
 *   and a line feed. A file that held both endings would be a file that a
 *   tool can change without a person: a checkout, a sync tool, or an
 *   editor writes one ending over the other, and the checksum of the
 *   record then fails on a device that changed nothing. The block
 *   therefore holds the snapshot with line feeds, and the reader puts the
 *   pairs back. The change is reversible, because the canonical snapshot
 *   writes a carriage return in one place only, which is the end of a
 *   line. A line break inside a value stands as the two characters `\n`
 *   in that text.
 * - The fence holds at least three back quotes. Where a line of the
 *   snapshot starts with a run of back quotes, the fence holds one more
 *   back quote than the longest such run. The block then holds every
 *   snapshot, and no line of a snapshot can end the block early.
 * - The block carries the word `ics`, so a reader of the vault knows what
 *   the block holds.
 */

import type { RecordData } from '../model/record';
import { emitFrontmatter } from './emitter';
import { CHECKSUM_KEY, recordEntries } from './schema';

/** The line that opens and closes the frontmatter. */
const FRONTMATTER_MARK = '---';

/** The word that stands after the opening fence. */
const BODY_LANGUAGE = 'ics';

const SMALLEST_FENCE = 3;

/**
 * The canonical text of one record, with the checksum that the data
 * holds.
 *
 * The function refuses a record whose base snapshot holds no line. Such a
 * record renders as an empty fenced block, and the reader refuses that
 * block, so the file would quarantine on the next read of any device. The
 * builder of a record always serializes a calendar that the parse
 * boundary read, so no state of the plugin reaches this refusal. A caller
 * that builds the content by hand does.
 */
export function renderRecord(data: RecordData): string {
	const frontmatter = emitFrontmatter(recordEntries(data));
	return (
		`${FRONTMATTER_MARK}\n${frontmatter}${FRONTMATTER_MARK}\n\n` +
		fencedBody(data.baseIcs)
	);
}

/** The fenced block that holds the base snapshot. */
function fencedBody(ics: string): string {
	const body = withLineFeeds(ics).replace(/\n+$/, '');
	if (body.length === 0) {
		throw new Error('the record states no base snapshot');
	}
	const fence = '`'.repeat(fenceLength(body));
	return `${fence}${BODY_LANGUAGE}\n${body}\n${fence}\n`;
}

/** The text with one line feed in the place of every line ending. */
export function withLineFeeds(text: string): string {
	return text.replace(/\r\n|\r/g, '\n');
}

/** The text with a carriage return and a line feed at the end of every line. */
export function withLinePairs(text: string): string {
	return withLineFeeds(text).replace(/\n/g, '\r\n');
}

/**
 * The number of back quotes that the fence holds. The count answers the
 * longest run of back quotes that starts a line of the body. A reader of
 * markdown allows three spaces in front of such a run, so the count reads
 * over them.
 */
function fenceLength(body: string): number {
	let longest = 0;
	for (const line of body.split('\n')) {
		const run = /^ {0,3}(`+)/.exec(line)?.[1];
		if (run !== undefined) {
			longest = Math.max(longest, run.length);
		}
	}
	return Math.max(SMALLEST_FENCE, longest + 1);
}

/**
 * The line of the frontmatter that carries the checksum, in the form that
 * the emitter writes. The form is frozen: the key stands bare at the left
 * margin, and the value stands in quotation marks on the same line. A
 * device of any version finds this line, and it needs no reader of the
 * whole schema to do it.
 */
const CHECKSUM_LINE = new RegExp(`^${CHECKSUM_KEY}: "[0-9a-f]*"$`);

/** The characters that stand before the value on that line. */
const CHECKSUM_PREFIX = `${CHECKSUM_KEY}: "`;

/** The lines of the frontmatter that carry the checksum, by their place. */
function checksumLines(lines: readonly string[], end: number): number[] {
	const places: number[] = [];
	for (const [offset, line] of lines.slice(1, end).entries()) {
		if (CHECKSUM_LINE.test(line)) {
			places.push(offset + 1);
		}
	}
	return places;
}

/** Where the checksum stands in one record text. */
export interface ChecksumSite {
	/** The value that the line carries. */
	readonly value: string;
	/** The text with an empty value in the place of that value. */
	readonly blanked: string;
}

/** Why a text carries no checksum that the plugin can read. */
export type ChecksumSiteProblem =
	/** The text does not start with a frontmatter block. */
	| 'no-frontmatter'
	/**
	 * The first line of the text ends with a carriage return. A record
	 * uses the line feed alone, so a tool converted the line endings of
	 * the whole file. A checkout of a vault under git does this where the
	 * vault states no rule for a markdown file.
	 */
	| 'line-endings'
	/** The frontmatter holds no line that carries the checksum. */
	| 'no-checksum'
	/** The frontmatter holds more than one such line. */
	| 'many-checksums';

/** What a search for the checksum line gives back. */
export type ChecksumSiteResult =
	| { readonly ok: true; readonly site: ChecksumSite }
	| { readonly ok: false; readonly problem: ChecksumSiteProblem };

/**
 * The checksum line of one record text, and the same text with that value
 * blanked.
 *
 * The search reads the lines between the opening mark and the first mark
 * that follows it. In a well-formed record those lines are the
 * frontmatter, so a line of the body that looks like the checksum line
 * changes nothing. In a file whose frontmatter block does not close, the
 * first mark that follows stands in the body, and the search then reads
 * body lines. Such a file is damage that the reader refuses, and the
 * checksum is one of three checks that a quarantine makes.
 */
export function checksumSite(text: string): ChecksumSiteResult {
	const lines = text.split('\n');
	if (lines[0] !== FRONTMATTER_MARK) {
		return {
			ok: false,
			problem:
				lines[0] === `${FRONTMATTER_MARK}\r`
					? 'line-endings'
					: 'no-frontmatter',
		};
	}
	const end = lines.indexOf(FRONTMATTER_MARK, 1);
	if (end === -1) {
		return { ok: false, problem: 'no-frontmatter' };
	}
	const [at, ...others] = checksumLines(lines, end);
	if (at === undefined) {
		return { ok: false, problem: 'no-checksum' };
	}
	if (others.length > 0) {
		return { ok: false, problem: 'many-checksums' };
	}
	const line = lines[at] ?? '';
	const blanked = [...lines];
	blanked[at] = `${CHECKSUM_PREFIX}"`;
	return {
		ok: true,
		site: {
			value: line.slice(CHECKSUM_PREFIX.length, -1),
			blanked: blanked.join('\n'),
		},
	};
}

/**
 * The text with the given checksum in the place of the value that the
 * checksum line carries.
 */
export function withChecksum(text: string, checksum: string): string {
	const lines = text.split('\n');
	const [at] = checksumLines(lines, lines.indexOf(FRONTMATTER_MARK, 1));
	if (at !== undefined) {
		lines[at] = `${CHECKSUM_PREFIX}${checksum}"`;
		return lines.join('\n');
	}
	throw new Error('the record text holds no checksum line');
}
