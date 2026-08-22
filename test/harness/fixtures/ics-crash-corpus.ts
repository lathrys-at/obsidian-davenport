/**
 * The crash corpus. Each file here is an input that the fuzzing lane found
 * and that a person kept.
 *
 * The adversarial corpus beside this one holds legal iCalendar that a
 * person wrote. This corpus holds what a machine made: text that a chain of
 * changes damaged, and text that carries a shape which the parse boundary
 * reads wrongly. A file here is the smallest input that the lane found for
 * its finding, or the neighbour of such an input that a person wrote while
 * they read that finding. A file stays here after a change repairs the defect.
 * The lane therefore never loses a finding, and the required check drives
 * every one of them on every commit.
 *
 * Each entry states one of two states.
 *
 * - `held`: the engine keeps the rule today. The test drives the file and
 *   asks for no finding.
 * - `open`: the defect waits for a decision. The entry names the kind of
 *   finding that the file still gives, and the test asks for that kind. A
 *   file that stops giving it is a file that no longer reproduces its
 *   defect, and the test then fails: either the engine changed and the
 *   entry moves to `held`, or the file lost the shape that made it useful.
 *
 * An entry names the issue that holds its defect. An entry with no issue is
 * a finding of this lane that nobody filed. When somebody files the issue,
 * put the number here, and add an entry to the ledger of
 * `scripts/fuzz-ics-ledger.ts` so that the lane stops reporting the finding
 * as new.
 *
 * `scripts/fuzz-ics.mjs --graduate` writes a file into this folder.
 * `test/README.md` states the whole procedure.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FindingKind } from '../../../scripts/fuzz-ics-core';

/** Whether the engine holds the rule that the input tests. */
export type CrashState = 'held' | 'open';

/** One file of the crash corpus. */
export interface IcsCrashFixture {
	/** The file name without its extension. No two fixtures share an id. */
	readonly id: string;
	/** The absolute path of the file. */
	readonly path: string;
	/** What the input holds, and what the engine does with it. */
	readonly summary: string;
	readonly state: CrashState;
	/**
	 * The kind of finding that the input gives while the defect stands. A
	 * fixture in the state `held` states nothing here.
	 */
	readonly finding: FindingKind | null;
	/** The issue that holds the defect, where somebody filed one. */
	readonly issue: number | null;
	/** The text of the file, decoded from UTF-8. */
	readonly content: string;
}

type IcsCrashEntry = Omit<IcsCrashFixture, 'path' | 'content'>;

const INDEX: readonly IcsCrashEntry[] = [
	{
		id: 'carriage-return-in-a-value',
		summary:
			'A carriage return stands at the end of a physical line, and a fold continues that line. The reader of the boundary ends a line at a carriage return, and the library keeps that carriage return inside the value. The check for a control character therefore never reads it. The boundary accepts the text, and the canonical text of it breaks the property across two lines. The boundary then refuses that canonical text.',
		state: 'open',
		finding: 'refused-own-text',
		issue: 234,
	},
	{
		id: 'value-type-carries-an-escape',
		summary:
			'The VALUE parameter holds three carets. The parse turns that parameter into the name of the value type, and it reads two of the carets as the escape of one caret. The serializer writes the name of the type back with no escape, so each trip loses one caret and the canonical text is no fixed point.',
		state: 'open',
		finding: 'not-a-fixed-point',
		issue: 235,
	},
	{
		id: 'value-type-carries-a-line-break',
		summary:
			'The VALUE parameter holds a backslash and the letter n. The parse turns that parameter into the name of the value type, and it reads those two characters as a line break. The serializer writes that line break into the parameter with no escape, and the library cannot read the text that comes out.',
		state: 'open',
		finding: 'refused-own-text',
		issue: 235,
	},
];

const FIXTURE_EXTENSION = '.ics';
const FIXTURE_DIR = join(import.meta.dirname, 'ics-crash');
const utf8 = new TextDecoder('utf-8', { fatal: true });

let corpus: readonly IcsCrashFixture[] | undefined;

/**
 * The whole crash corpus, in index order. The function reads each file one
 * time and then holds the text.
 */
export function icsCrashCorpus(): readonly IcsCrashFixture[] {
	corpus ??= INDEX.map(readFixture);
	return corpus;
}

/**
 * The fixture names on disk. The function reads the directory, and it
 * ignores the index.
 */
export function icsCrashNamesOnDisk(): readonly string[] {
	return readdirSync(FIXTURE_DIR)
		.filter((file) => file.endsWith(FIXTURE_EXTENSION))
		.map((file) => file.slice(0, -FIXTURE_EXTENSION.length))
		.sort();
}

function readFixture(entry: IcsCrashEntry): IcsCrashFixture {
	const path = join(FIXTURE_DIR, `${entry.id}${FIXTURE_EXTENSION}`);
	let content: string;
	try {
		content = utf8.decode(readFileSync(path));
	} catch (error) {
		throw new Error(
			`ics crash corpus: cannot read ${path}: ${
				error instanceof Error ? error.message : String(error)
			}; add the file, or remove its entry from the index`,
		);
	}
	return { ...entry, path, content };
}
