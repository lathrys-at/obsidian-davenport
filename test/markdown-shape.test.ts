/**
 * The decisions behind the markdown shape check:
 *
 * - where each line ends, on a file that Linux wrote and on a file that
 *   Windows wrote;
 * - which lines hold prose that the check measures, and which lines hold
 *   something else;
 * - where one block of prose ends, and where the next block starts;
 * - which part of a line cannot break across a line end;
 * - which short line is a reflow orphan, and which short line is not;
 * - which line ends with white space;
 * - what the check says, and what the check does when it reads nothing.
 *
 * One case runs the check over the documents of this repository, and not
 * over a copy of them. That case is the gate itself. A copy would drift, and
 * then the case would prove the copy.
 *
 * The script itself only finds the files, reads them, and prints. A run can
 * end in two ways, and these cases exercise each way as a process. The
 * interface includes the exit status, and not only the words that the run
 * prints.
 */

import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Block, Defect } from '../scripts/markdown-shape-core';
import {
	blockDefects,
	defectsOf,
	firstUnit,
	linesOf,
	proseBlocks,
	short,
	survey,
	surveyFails,
} from '../scripts/markdown-shape-core';
import { failureLines, reportLines, say } from '../scripts/markdown-shape-text';
import { NOTE_FIXTURES } from './harness/fixtures/note-corpus';
import { runNode } from './harness/run-node';

const SCRIPT = fileURLToPath(
	new URL('../scripts/markdown-shape.mjs', import.meta.url),
);
const REPOSITORY = fileURLToPath(new URL('..', import.meta.url));

/** The text of a document, from the lines that a case gives. */
function document(...lines: readonly string[]): string {
	return `${lines.join('\n')}\n`;
}

/** The same document, as a host that ends each line with two octets wrote it. */
function windows(...lines: readonly string[]): string {
	return `${lines.join('\r\n')}\r\n`;
}

/** The lines of each block that this text holds. */
function blocksOf(text: string): readonly (readonly string[])[] {
	return proseBlocks(text).map((block) => block.lines);
}

/** A block that starts at the first line of a document. */
function block(...lines: readonly string[]): Block {
	return { start: 1, lines };
}

/** The kinds of the defects, in the order that the check reports them. */
function kindsOf(defects: readonly Defect[]): readonly string[] {
	return defects.map((defect) => defect.kind);
}

describe('the lines of a document', () => {
	it('takes the line feed at the end of the text as the end of a line', () => {
		expect(linesOf('one\ntwo\n')).toStrictEqual(['one', 'two']);
	});

	it('keeps the last line of a text that ends without a line feed', () => {
		expect(linesOf('one\ntwo')).toStrictEqual(['one', 'two']);
	});

	it('gives no line for a text that holds nothing', () => {
		expect(linesOf('')).toStrictEqual([]);
	});

	it('keeps a blank line that a second line feed makes', () => {
		expect(linesOf('one\n\n')).toStrictEqual(['one', '']);
	});

	it('takes the carriage return of a windows line off the line', () => {
		expect(linesOf(windows('one', 'two'))).toStrictEqual(['one', 'two']);
	});
});

describe('the blocks of prose', () => {
	it('takes the lines between two blank lines as one block', () => {
		expect(
			blocksOf(document('one two', 'three four', '', 'five six')),
		).toStrictEqual([['one two', 'three four'], ['five six']]);
	});

	it('passes over the frontmatter at the start of a document', () => {
		expect(
			blocksOf(document('---', 'title: a', 'tags: b', '---', 'text')),
		).toStrictEqual([['text']]);
	});

	it('takes three hyphens after prose as a break, and not as frontmatter', () => {
		expect(blocksOf(document('text', '---', 'more'))).toStrictEqual([
			['text'],
			['more'],
		]);
	});

	it('takes a break on the first line as a break, and keeps the prose after it', () => {
		expect(
			blocksOf(document('---', 'text', '', 'more', '---', 'last')),
		).toStrictEqual([['text'], ['more'], ['last']]);
	});

	it('passes over the frontmatter of a document that a windows host wrote', () => {
		expect(
			blocksOf(windows('---', 'title: a', '---', 'text')),
		).toStrictEqual([['text']]);
	});

	it('passes over the frontmatter of every note of the corpus', () => {
		const opens = NOTE_FIXTURES.filter((note) =>
			note.content.startsWith('---\n'),
		);
		expect(opens.length).toBe(NOTE_FIXTURES.length - 1);
		for (const note of opens) {
			const closes = linesOf(note.content).indexOf('---', 1) + 1;
			expect(closes).toBeGreaterThan(1);
			const starts = proseBlocks(note.content).map((each) => each.start);
			expect({
				id: note.id,
				before: starts.filter((at) => at <= closes),
			}).toStrictEqual({ id: note.id, before: [] });
		}
	});

	it('passes over a fenced block and the fences of it', () => {
		expect(
			blocksOf(document('text', '', '```js', 'const a = 1;', '```')),
		).toStrictEqual([['text']]);
	});

	it('passes over a fence that a tilde opens', () => {
		expect(
			blocksOf(document('~~~', 'raw line', '~~~', '', 'text')),
		).toStrictEqual([['text']]);
	});

	it('passes over a comment of HTML that runs over many lines', () => {
		expect(
			blocksOf(document('<!--', 'a note', '-->', 'text')),
		).toStrictEqual([['text']]);
	});

	it('passes over a heading, a table row, a quote, and a block of HTML', () => {
		expect(
			blocksOf(
				document('# Title', '| a | b |', '> quoted', '<div>', 'text'),
			),
		).toStrictEqual([['text']]);
	});

	it('starts a new block at each item of a list', () => {
		expect(
			blocksOf(
				document('- one item', '  and its rest', '- another item'),
			),
		).toStrictEqual([['- one item', '  and its rest'], ['- another item']]);
	});

	it('starts a new block at each item of a numbered list', () => {
		expect(
			blocksOf(document('1. one item', '2. another item')),
		).toStrictEqual([['1. one item'], ['2. another item']]);
	});

	it('counts the lines of a document from one', () => {
		expect(proseBlocks(document('', '', 'text'))[0]?.start).toBe(3);
	});

	// The two cases below hold the two shapes that a test on the first
	// character of a line cannot separate. The check accepts both shapes.
	// A change of that decision changes these two cases.
	it('passes over the prose of a block quote with the quote', () => {
		expect(
			blocksOf(
				document(
					'> A first line that runs out to the width of this quote here.',
					'> gap.',
					'> a third line that carries the rest of the words of the quote.',
				),
			),
		).toStrictEqual([]);
	});

	it('takes a row of a table that starts with a cell as prose', () => {
		expect(blocksOf(document('a | b', '--- | ---', 'x | y'))).toStrictEqual(
			[['a | b', '--- | ---', 'x | y']],
		);
	});
});

describe('the part of a line that cannot break', () => {
	it('takes the text up to the first space', () => {
		expect(firstUnit('word and more')).toBe('word');
	});

	it('passes over the leading white space of the line', () => {
		expect(firstUnit('   word and more')).toBe('word');
	});

	it('keeps a code span whole, with the spaces inside it', () => {
		expect(firstUnit('`npm run build` and more')).toBe('`npm run build`');
	});

	it('keeps a link whole, with the spaces in its label', () => {
		expect(firstUnit('[the clock port](ports/clock.ts) and more')).toBe(
			'[the clock port](ports/clock.ts)',
		);
	});

	it('takes a whole line that holds no space', () => {
		expect(firstUnit('unbroken')).toBe('unbroken');
	});

	it('takes an empty part from an empty line', () => {
		expect(firstUnit('')).toBe('');
	});
});

describe('the width that makes a line short', () => {
	it('calls a line of less than two fifths of the width short', () => {
		expect(short(39, 100)).toBe(true);
	});

	it('calls a line of exactly two fifths of the width long enough', () => {
		expect(short(40, 100)).toBe(false);
	});

	it('calls a line past two fifths of the width long enough', () => {
		expect(short(41, 100)).toBe(false);
	});
});

describe('the orphan that a reflow leaves behind', () => {
	it('reports a short line that the next word fits on', () => {
		const found = blockDefects(
			block(
				'The rule is this: a changed fact re-routes to its pre-stated',
				'branch. A',
				'fact that has no branch is a design gap. That fact goes back to it.',
			),
		);
		expect(found).toStrictEqual([
			{
				kind: 'orphan',
				line: 2,
				text: 'branch. A',
				width: 67,
				unit: 'fact',
			},
		]);
	});

	it('reports no orphan in a block that a wrap made', () => {
		expect(
			blockDefects(
				block(
					'The rule is this: a changed fact re-routes to its pre-stated branch.',
					'A fact that has no branch is a design gap, and it goes back to it.',
				),
			),
		).toStrictEqual([]);
	});

	it('reports no orphan when the next part is too long to fit', () => {
		expect(
			blockDefects(
				block(
					'Part 6.1 of',
					'[`docs/davenport-test-plan.md`](../../docs/davenport-test-plan.md) lists',
				),
			),
		).toStrictEqual([]);
	});

	it('reports no orphan on the last line of a block', () => {
		expect(
			blockDefects(
				block(
					'A line that runs to the width of this block and stops there.',
					'short.',
				),
			),
		).toStrictEqual([]);
	});

	it('reports no orphan in a block of one line', () => {
		expect(blockDefects(block('one line only'))).toStrictEqual([]);
	});

	it('reports an orphan under the indent of a list item', () => {
		expect(
			blockDefects(
				block(
					'- a first line that reaches out to the width of this block, so.',
					'  short',
					'  a third line that carries the rest of the text of this item.',
				),
			).map((defect) => defect.line),
		).toStrictEqual([2]);
	});
});

describe('the white space at the end of a line', () => {
	it('reports a line that ends with a space', () => {
		expect(defectsOf(document('text ', 'more text'))).toStrictEqual([
			{ kind: 'trailing space', line: 1, text: 'text ' },
		]);
	});

	it('reports a line that ends with a tab', () => {
		expect(kindsOf(defectsOf(document('text\t', 'more')))).toStrictEqual([
			'trailing space',
		]);
	});

	it('reports the white space of a line that holds nothing else', () => {
		expect(
			kindsOf(defectsOf(document('text', '  ', 'more'))),
		).toStrictEqual(['trailing space']);
	});

	it('reports a line inside a fenced block', () => {
		expect(
			kindsOf(defectsOf(document('```', 'code ', '```'))),
		).toStrictEqual(['trailing space']);
	});

	it('reports no defect in a document that ends each line cleanly', () => {
		expect(defectsOf(document('text', 'more text'))).toStrictEqual([]);
	});

	it('reports a line of a document that a windows host wrote', () => {
		expect(defectsOf(windows('text ', 'more text'))).toStrictEqual([
			{ kind: 'trailing space', line: 1, text: 'text ' },
		]);
	});
});

describe('the defects of one document, in order', () => {
	it('gives the defects in the order of the lines', () => {
		const text = document(
			'A first line that runs out to the width that this block states.',
			'short',
			'a third line that carries the rest of the words of this block. ',
		);
		expect(
			defectsOf(text).map((defect) => [defect.kind, defect.line]),
		).toStrictEqual([
			['orphan', 2],
			['trailing space', 3],
		]);
	});

	it('reads the prose between a break on the first line and a later break', () => {
		const text = document(
			'---',
			'A first line that runs out to the width that this block states.',
			'short',
			'a third line that carries the rest of the words of this block.',
			'',
			'---',
		);
		expect(
			defectsOf(text).map((defect) => [defect.kind, defect.line]),
		).toStrictEqual([['orphan', 3]]);
	});

	it('counts the characters of a line that a windows host wrote', () => {
		const text = windows(
			'A first line that runs out to the width that this block states.',
			'short',
			'a third line that carries the rest of the words of this block.',
		);
		expect(defectsOf(text)).toStrictEqual([
			{
				kind: 'orphan',
				line: 2,
				text: 'short',
				width: 63,
				unit: 'a',
			},
		]);
	});
});

describe('the survey of many documents', () => {
	it('counts the documents and the lines that it read', () => {
		const result = survey([
			{ path: 'a.md', text: document('one', 'two') },
			{ path: 'b.md', text: document('three') },
		]);
		expect(result.documents).toBe(2);
		expect(result.lines).toBe(3);
		expect(result.sites).toStrictEqual([]);
	});

	it('names the document that holds each defect', () => {
		const result = survey([
			{ path: 'a.md', text: document('clean') },
			{ path: 'b.md', text: document('text ') },
		]);
		expect(result.sites.map((site) => site.path)).toStrictEqual(['b.md']);
	});

	it('accepts a survey that found no defect', () => {
		expect(surveyFails(survey([{ path: 'a.md', text: 'text\n' }]))).toBe(
			false,
		);
	});

	it('fails a survey that found a defect', () => {
		expect(surveyFails(survey([{ path: 'a.md', text: 'text \n' }]))).toBe(
			true,
		);
	});

	it('fails a survey that read no document at all', () => {
		expect(surveyFails(survey([]))).toBe(true);
	});
});

describe('the words that the check prints', () => {
	it('says how many documents and lines it read', () => {
		const lines = reportLines(
			survey([{ path: 'a.md', text: document('one', 'two') }]),
		);
		expect(lines[0]).toBe(say('the check read 1 document and 2 lines'));
	});

	it('says that a survey of nothing proves nothing', () => {
		expect(failureLines(survey([])).join(' ')).toContain(
			'the check found no document',
		);
	});

	it('says nothing about a survey that found no defect', () => {
		expect(
			failureLines(survey([{ path: 'a.md', text: 'text\n' }])),
		).toStrictEqual([]);
	});

	it('names the place, the reason, and the line of a trailing space', () => {
		const lines = failureLines(
			survey([{ path: 'a.md', text: document('text ') }]),
		);
		expect(lines[0]).toContain('a.md:1');
		expect(lines[0]).toContain('ends with white space');
		expect(lines[1]).toBe('  text |');
	});

	it('marks the end of a line that ends with white space, and no other line', () => {
		const text = document(
			'A first line that runs out to the width that this block states.',
			'short',
			'a third line that carries the rest of the words of this block.',
		);
		const lines = failureLines(survey([{ path: 'a.md', text }]));
		expect(lines[0]).toContain('a.md:2');
		expect(lines[1]).toBe('  short');
	});

	it('names the width of the block and the part that fits', () => {
		const text = document(
			'A first line that runs out to the width that this block states.',
			'short',
			'a third line that carries the rest of the words of this block.',
		);
		const lines = failureLines(survey([{ path: 'a.md', text }]));
		expect(lines[0]).toContain('a.md:2');
		expect(lines[0]).toContain('63 characters');
		expect(lines[0]).toContain('"a"');
	});
});

describe('the check as a process', () => {
	let folder: string;

	beforeAll(() => {
		folder = mkdtempSync(join(tmpdir(), 'markdown-shape-'));
	});

	afterAll(() => {
		rmSync(folder, { recursive: true, force: true });
	});

	it('accepts the markdown of this repository', () => {
		const run = runNode([SCRIPT, REPOSITORY]);
		expect(run.stdout).toContain('the check read');
		expect(run.status).toBe(0);
	});

	it('passes over the note corpus, which holds data and not prose', () => {
		// The harness folder holds the corpus and no other markdown file.
		// A run over that folder therefore reads nothing, and a run that
		// reads nothing fails. A corpus file that reached the check would
		// make the run report a document instead.
		const run = runNode([SCRIPT, join(REPOSITORY, 'test', 'harness')]);
		expect(NOTE_FIXTURES.length).toBeGreaterThan(0);
		expect(run.stdout).toContain('the check read 0 documents');
		expect(run.stderr).toContain('the check found no document');
		expect(run.status).toBe(1);
	});

	it('passes over the corpus folder that an argument names as well', () => {
		const corpus = join(REPOSITORY, 'test', 'harness', 'fixtures');
		const run = runNode([SCRIPT, corpus]);
		expect(run.stdout).toContain('the check read 0 documents');
		expect(run.status).toBe(1);
	});

	it('passes over a folder below the corpus, and one note of it', () => {
		const notes = join(REPOSITORY, 'test', 'harness', 'fixtures', 'notes');
		const note = join(notes, 'lists.md');
		const runs = [notes, note].map((path) => {
			const run = runNode([SCRIPT, path]);
			return {
				path,
				read: run.stdout.includes('the check read 0 documents'),
				status: run.status,
			};
		});
		expect(runs).toStrictEqual([
			{ path: notes, read: true, status: 1 },
			{ path: note, read: true, status: 1 },
		]);
	});

	// Windows gives the right to make a symbolic link to an administrator and
	// to a machine in developer mode, and the runner of the tests is neither.
	// This case cannot make its link there.
	it.skipIf(process.platform === 'win32')(
		'reads a document one time, and passes over a link to it',
		() => {
			const linked = mkdtempSync(join(tmpdir(), 'markdown-shape-link-'));
			try {
				writeFileSync(
					join(linked, 'a.md'),
					document('one', 'two'),
					'utf8',
				);
				symlinkSync(join(linked, 'a.md'), join(linked, 'b.md'));
				const run = runNode([SCRIPT, linked]);
				expect(run.stdout).toContain(
					'the check read 1 document and 2 lines',
				);
				expect(run.status).toBe(0);
			} finally {
				rmSync(linked, { recursive: true, force: true });
			}
		},
	);

	it('refuses a document that holds an orphan, and names the line', () => {
		const bad = join(folder, 'orphan.md');
		writeFileSync(
			bad,
			document(
				'A first line that runs out to the width that this block states.',
				'short',
				'a third line that carries the rest of the words of this block.',
			),
			'utf8',
		);
		const run = runNode([SCRIPT, bad]);
		expect(run.stderr).toContain('orphan.md:2');
		expect(run.status).toBe(1);
	});

	it('refuses a directory that holds no markdown file', () => {
		const empty = mkdtempSync(join(tmpdir(), 'markdown-shape-empty-'));
		try {
			const run = runNode([SCRIPT, empty]);
			expect(run.stderr).toContain('the check found no document');
			expect(run.status).toBe(1);
		} finally {
			rmSync(empty, { recursive: true, force: true });
		}
	});
});
