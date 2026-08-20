/**
 * The decisions behind the markdown shape check:
 *
 * - where each line of a document ends, on a file that Linux wrote and on a
 *   file that Windows wrote;
 * - which lines of a document hold prose, and which lines hold something
 *   else;
 * - where one block of prose ends, and where the next block starts;
 * - how wide the lines of a block are;
 * - which part of the next line cannot break across a line end;
 * - which short line is a reflow orphan, and which short line is not;
 * - which line ends with white space.
 *
 * No function here reads a file. The caller reads the documents and gives
 * the text of each document to these functions. Therefore a test can
 * exercise every decision directly. `markdown-shape.mjs` finds the
 * documents, reads them, prints the report, and sets the exit status.
 * `markdown-shape-text.ts` holds the wording that the check prints.
 *
 * An edit leaves a reflow orphan behind. A person removes words from the
 * middle of a wrapped paragraph, and the person does not join the lines
 * again. The paragraph then holds a line that is much shorter than the
 * lines around it. The start of the next line also fits on that short line.
 * No wrap makes a line of that shape.
 *
 * The check reads the width of a block out of the block itself. The
 * documents of this repository wrap at different widths. Some of these
 * documents also hold paragraphs of one line that run past every width. A
 * width that the block states is therefore the only width that holds for
 * every document. A block of one line states no width, and the check passes
 * over such a block.
 */

/**
 * A line is short when the line holds less than two fifths of the longest
 * line of its block. The fraction is a fraction of two whole numbers, so
 * the comparison stays exact.
 *
 * The check sets this fraction far below the width on purpose. A wrap puts
 * a word on the next line only when the word does not fit. A wrap therefore
 * makes lines that come near the width. A line at less than two fifths of
 * the width comes from an edit, and it does not come from a wrap.
 *
 * A larger fraction would also report a paragraph that a person wrapped by
 * hand at an uneven width. Such a paragraph is untidy, and it is not the
 * defect that this check names.
 */
const SHORT_TOP = 2;
const SHORT_BOTTOM = 5;

/** The list markers that start a new block. */
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s/;

/** A line that holds a fence, and the marker that the fence uses. */
const FENCE = /^\s*(```|~~~)/;

/** A line that holds a thematic break or a heading underline. */
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,}|={3,})\s*$/;

/** A line that ends with a space or a tab. */
const TRAILING = /[ \t]$/;

/**
 * A line that can stand first in the frontmatter of a document: a key, an
 * item of a sequence, or a comment. A key holds any characters except a
 * colon, so `date created:` and `"date created":` are keys. A colon that
 * stands inside a value is therefore not a key, because the first colon of
 * the line ends the key.
 *
 * The first line of the frontmatter carries the weight of the test. YAML
 * gives that line no indent and no blank, so a document that opens with a
 * thematic break and holds an indented line, a blank line, or a line of
 * prose below the break keeps every line of that block.
 */
const FRONT_MATTER_TOP = /^(?:[^\s#][^:]*:(?:\s|$)|-(?:\s|$)|#)/;

/**
 * A line that the frontmatter can hold below its first line: a line of the
 * kinds above, or a line that continues the line above it. YAML indents
 * such a continuation.
 */
const FRONT_MATTER_LINE = /^(?:\s|[^\s#][^:]*:(?:\s|$)|-(?:\s|$)|#)/;

/** One document, and the text that the document holds. */
export interface Document {
	readonly path: string;
	readonly text: string;
}

/** A run of lines of prose, and the place where the run starts. */
export interface Block {
	/** The number of the first line, counted from one. */
	readonly start: number;
	readonly lines: readonly string[];
}

/** Something in a document that the check reports. */
export type Defect =
	| {
			readonly kind: 'trailing space';
			/** The number of the line, counted from one. */
			readonly line: number;
			readonly text: string;
	  }
	| {
			readonly kind: 'orphan';
			readonly line: number;
			readonly text: string;
			/** The length of the longest line of the block. */
			readonly width: number;
			/** The part of the next line that fits on this line. */
			readonly unit: string;
	  };

/** One defect, and the document that holds it. */
export interface Site {
	readonly path: string;
	readonly defect: Defect;
}

/** What the check found in the documents that it read. */
export interface Survey {
	readonly documents: number;
	readonly lines: number;
	readonly sites: readonly Site[];
}

/**
 * The lines of a text. A line feed at the end of the text closes the last
 * line of the text, and it does not start one more line. A carriage return
 * in front of a line feed belongs to the end of the line, and it is not
 * part of the text of the line. Therefore a file that Windows wrote gives
 * the same lines as a file that Linux wrote, and the count of the lines is
 * the count of the lines that a person sees.
 */
export function linesOf(text: string): readonly string[] {
	const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));
	if (lines[lines.length - 1] === '') {
		lines.pop();
	}
	return lines;
}

/**
 * The blocks of prose in a document. A block holds the lines of one
 * paragraph, or the lines of one item of a list. The function passes over
 * the frontmatter, the fenced code, the comments of HTML, the headings, the
 * rows of a table, the block quotes, the blocks of HTML, and the thematic
 * breaks. A blank line ends a block. A list marker starts a new block,
 * because each item of a list wraps on its own.
 */
export function proseBlocks(text: string): readonly Block[] {
	const lines = linesOf(text);
	const blocks: Block[] = [];
	let current: string[] = [];
	let start = 0;
	let fence: string | undefined;
	let comment = false;

	const close = (): void => {
		if (current.length > 0) {
			blocks.push({ start: start + 1, lines: current });
			current = [];
		}
	};

	for (let at = skipFrontMatter(lines); at < lines.length; at += 1) {
		const line = lines[at] ?? '';
		const trimmed = line.trim();

		if (comment) {
			comment = !trimmed.includes('-->');
			continue;
		}
		if (fence !== undefined) {
			if (trimmed.startsWith(fence)) {
				fence = undefined;
			}
			continue;
		}

		const opened = FENCE.exec(line)?.[1];
		if (opened !== undefined) {
			close();
			fence = opened;
			continue;
		}
		if (trimmed.startsWith('<!--')) {
			close();
			comment = !trimmed.includes('-->');
			continue;
		}
		if (skipped(trimmed, line)) {
			close();
			continue;
		}
		if (LIST_MARKER.test(line)) {
			close();
		}
		if (current.length === 0) {
			start = at;
		}
		current.push(line);
	}
	close();
	return blocks;
}

/**
 * The line after the frontmatter, or the first line when the document holds
 * no frontmatter. Frontmatter opens with three hyphens on the first line of
 * the document, and it closes with three hyphens on a later line. Three
 * conditions make the lines between the two frontmatter:
 *
 * - the line directly below the opening hyphens is a key, an item of a
 *   sequence, or a comment, or it is the closing hyphens of an empty block;
 * - each line below that one is a line of the same kinds, a line that
 *   continues the line above it, or a blank line;
 * - the closing hyphens stand somewhere below.
 *
 * A document can also open with a thematic break of three hyphens and hold
 * one more break further down. The conditions above keep the lines between
 * the two breaks, because a paragraph, a blank line, and an indented line
 * are each something that the first line of frontmatter cannot be.
 *
 * A sequence directly below the opening hyphens is the one shape that the
 * conditions cannot separate. `- one` below three hyphens is an item of a
 * YAML sequence, and it is also an item of a markdown list, and the two are
 * the same characters. The check reads that shape as frontmatter, because
 * the note corpus states that shape as frontmatter.
 */
function skipFrontMatter(lines: readonly string[]): number {
	if (lines[0] !== '---') {
		return 0;
	}
	const first = lines[1] ?? '';
	if (first !== '---' && !FRONT_MATTER_TOP.test(first)) {
		return 0;
	}
	for (let at = 1; at < lines.length; at += 1) {
		const line = lines[at] ?? '';
		if (line === '---') {
			return at + 1;
		}
		if (line.trim() !== '' && !FRONT_MATTER_LINE.test(line)) {
			return 0;
		}
	}
	return 0;
}

/**
 * True for a line that holds no prose that the check can measure. The test
 * reads the first character of the line, and it reads no more. Two shapes
 * follow from that, and the check accepts both. A block quote holds prose,
 * and the check passes over the whole quote. A row of a table that starts
 * with a cell, and not with a bar, reads as prose.
 */
function skipped(trimmed: string, line: string): boolean {
	return (
		trimmed === '' ||
		trimmed.startsWith('#') ||
		trimmed.startsWith('|') ||
		trimmed.startsWith('>') ||
		trimmed.startsWith('<') ||
		RULE.test(line)
	);
}

/**
 * The part at the start of a line that cannot break across a line end. The
 * part runs to the first space that stands outside a code span, outside the
 * label of a link, and outside the target of a link. A wrap moves this
 * whole part to the next line, or it moves none of it. Therefore this part
 * decides whether the line above had room for the next line.
 */
export function firstUnit(line: string): string {
	const text = line.trimStart();
	let code = false;
	let label = false;
	let target = false;
	for (let at = 0; at < text.length; at += 1) {
		const character = text.charAt(at);
		if (character === '`') {
			code = !code;
			continue;
		}
		if (code) {
			continue;
		}
		if (character === '[') {
			label = true;
		} else if (character === ']') {
			label = false;
			target = text.charAt(at + 1) === '(';
		} else if (character === ')') {
			target = false;
		} else if (character === ' ' && !label && !target) {
			return text.slice(0, at);
		}
	}
	return text;
}

/** True when a line of this length is short for a block of this width. */
export function short(length: number, width: number): boolean {
	return length * SHORT_BOTTOM < width * SHORT_TOP;
}

/** The defects of one block, in the order of the lines. */
export function blockDefects(block: Block): readonly Defect[] {
	if (block.lines.length < 2) {
		return [];
	}
	const width = Math.max(...block.lines.map((line) => line.length));
	const found: Defect[] = [];
	for (let at = 0; at < block.lines.length - 1; at += 1) {
		const line = block.lines[at] ?? '';
		if (!short(line.length, width)) {
			continue;
		}
		const unit = firstUnit(block.lines[at + 1] ?? '');
		if (line.length + 1 + unit.length > width) {
			continue;
		}
		found.push({
			kind: 'orphan',
			line: block.start + at,
			text: line,
			width,
			unit,
		});
	}
	return found;
}

/** The defects of one document, in the order of the lines. */
export function defectsOf(text: string): readonly Defect[] {
	const found: Defect[] = [];
	const lines = linesOf(text);
	for (let at = 0; at < lines.length; at += 1) {
		const line = lines[at] ?? '';
		if (TRAILING.test(line)) {
			found.push({ kind: 'trailing space', line: at + 1, text: line });
		}
	}
	for (const block of proseBlocks(text)) {
		found.push(...blockDefects(block));
	}
	return found.sort((left, right) => left.line - right.line);
}

/** What the check found across all the documents that the caller read. */
export function survey(documents: readonly Document[]): Survey {
	const sites: Site[] = [];
	let lines = 0;
	for (const document of documents) {
		lines += linesOf(document.text).length;
		for (const defect of defectsOf(document.text)) {
			sites.push({ path: document.path, defect });
		}
	}
	return { documents: documents.length, lines, sites };
}

/**
 * True when the check must fail. A survey that holds a site fails. A survey
 * of no document also fails: a check that reads nothing reports success on
 * every repository, and such a report shows nothing.
 */
export function surveyFails(result: Survey): boolean {
	return result.documents === 0 || result.sites.length > 0;
}
