/**
 * Frontmatter reading and writing for the vault fake. Frontmatter is the
 * block of YAML at the start of a note. The writer is deterministic. The
 * output of the writer depends only on the data that the writer gets, so
 * the same operations always give the same bytes.
 *
 * Some words below come from YAML. A mapping is a set of keys, with one
 * value for each key. A sequence is a list of values. A scalar is a
 * single value: not a mapping, and not a sequence. An anchor gives a name
 * to a value, and an alias later points to that name.
 *
 * YAML has more than one way to write the same data. Block style writes
 * each key of a mapping on its own line, and each item of a sequence on
 * its own line. Flow style writes a mapping between `{` and `}`, and a
 * sequence between `[` and `]`, on one line. Plain style writes a scalar
 * with no quotation marks around it. A literal block writes a string on
 * the lines below its key, and keeps each line break in the string.
 *
 * The writer applies these rules to every note, and the content that the
 * block had before does not change the rules:
 *
 * - The block starts with a line that contains `---` and nothing else.
 *   The YAML text comes next. A line that contains `---` and nothing else
 *   closes the block. A line feed ends each of these lines. The writer
 *   copies the text after the closing `---` line byte for byte.
 * - The keys keep the property order that the object has after the update
 *   function runs. A key that came from the note keeps its position. A
 *   key that the update function added comes after these keys, in the
 *   order that the update function added the keys. A key that the update
 *   function removed does not appear. JavaScript puts the keys that look
 *   like an array index before the other keys, so a key such as `2026`
 *   moves to the front.
 * - The writer writes a mapping and a sequence in block style, with an
 *   indent of two spaces. A sequence is indented below its key. Block
 *   style has no form for an empty mapping and no form for an empty
 *   sequence. The writer writes an empty mapping as `{}` and an empty
 *   sequence as `[]`, in flow style.
 * - The writer writes a scalar in plain style if the YAML 1.2 core schema
 *   permits plain style. If the schema does not permit plain style, the
 *   writer writes the scalar in double quotation marks. If the string
 *   contains a line break, or ends with a line break, the writer writes a
 *   literal block. The writer never breaks a long line into shorter
 *   lines.
 * - The writer removes a key that is set to `undefined`, the same as a
 *   key that the update function deleted.
 * - If more than one value in the data points to one object, the writer
 *   writes that object again each time. The writer does not write an
 *   anchor with an alias. If the data contains a cycle, the writer throws
 *   an error, and does not write an anchor.
 * - The writer keeps no comment. The writer builds the block again from
 *   the parsed data, so each comment in the block is lost.
 * - If the data has no keys, and the note already had a block, the writer
 *   writes an empty block. If the data has no keys, and the note had no
 *   block, the writer writes no block.
 *
 * The construction of the writer gives this determinism. The rules above
 * are not a claim about the frontmatter writer that Obsidian itself
 * supplies. A measurement against real Obsidian installations shows if
 * the two writers give the same bytes. This file never assumes that the
 * two writers agree.
 */

import { parse, stringify } from 'yaml';

const DELIMITER = '---';

const PARSE_OPTIONS = {
	version: '1.2',
	schema: 'core',
	uniqueKeys: true,
} as const;

const STRINGIFY_OPTIONS = {
	version: '1.2',
	schema: 'core',
	directives: false,
	indent: 2,
	indentSeq: true,
	lineWidth: 0,
	singleQuote: false,
	blockQuote: true,
	aliasDuplicateObjects: false,
} as const;

/**
 * The writer throws this error when it cannot rewrite the frontmatter
 * block of a note.
 */
export class FrontmatterError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FrontmatterError';
	}
}

export interface SplitNote {
	/**
	 * The YAML text between the two `---` lines. A line feed ends this
	 * text, unless the text is empty. The value is null when the note has
	 * no block.
	 */
	readonly yaml: string | null;
	/**
	 * All the text after the closing `---` line. When the note has no
	 * block, this is the full text of the note.
	 */
	readonly body: string;
}

/** The result when the reader reads a block that the note contains. */
export type BlockRead =
	| { readonly kind: 'invalid'; readonly reason: string }
	| { readonly kind: 'mapping'; readonly data: Record<string, unknown> };

export type FrontmatterRead = { readonly kind: 'absent' } | BlockRead;

/**
 * Splits a note into its frontmatter block and its body. The note has a
 * block only when the first line of the note is `---` and nothing else,
 * and a later line is `---` and nothing else. When no later line closes
 * the block, the function makes the full note the body. A `---` line can
 * end with a carriage return.
 */
export function splitNote(content: string): SplitNote {
	const firstBreak = content.indexOf('\n');
	if (firstBreak === -1 || !isDelimiter(content.slice(0, firstBreak))) {
		return { yaml: null, body: content };
	}
	const yamlStart = firstBreak + 1;
	let lineStart = yamlStart;
	while (lineStart <= content.length) {
		const lineEnd = content.indexOf('\n', lineStart);
		const line =
			lineEnd === -1
				? content.slice(lineStart)
				: content.slice(lineStart, lineEnd);
		if (isDelimiter(line)) {
			return {
				yaml: content.slice(yamlStart, lineStart),
				body: lineEnd === -1 ? '' : content.slice(lineEnd + 1),
			};
		}
		if (lineEnd === -1) {
			break;
		}
		lineStart = lineEnd + 1;
	}
	return { yaml: null, body: content };
}

/**
 * Reads the frontmatter of a note. A note that has no block reads as
 * absent. An empty block gives an empty mapping, and a block that
 * contains only comments also gives an empty mapping. A block that does
 * not parse is invalid, and a block that parses to a value that is not a
 * mapping is also invalid.
 */
export function readFrontmatter(content: string): FrontmatterRead {
	const { yaml } = splitNote(content);
	return yaml === null ? { kind: 'absent' } : parseBlock(yaml);
}

/**
 * Applies the `update` function to the frontmatter of a note, then
 * returns the new text of the note. When the note has no block, the
 * update starts from an empty mapping. When the block of the note does
 * not read as a mapping, the function throws `FrontmatterError` and does
 * not overwrite the block.
 */
export function writeFrontmatter(
	content: string,
	update: (frontmatter: Record<string, unknown>) => void,
): string {
	const { yaml, body } = splitNote(content);
	const read = yaml === null ? null : parseBlock(yaml);
	if (read !== null && read.kind === 'invalid') {
		throw new FrontmatterError(
			`the writer cannot rewrite the frontmatter. Correct the frontmatter block in the note, then write again. The reason: ${read.reason}`,
		);
	}
	const data = read === null ? {} : read.data;
	update(data);
	return composeNote(data, body, yaml !== null);
}

function parseBlock(yaml: string): BlockRead {
	let document: unknown;
	try {
		document = parse(yaml, PARSE_OPTIONS);
	} catch (error) {
		return {
			kind: 'invalid',
			reason: error instanceof Error ? error.message : String(error),
		};
	}
	if (document === null || document === undefined) {
		return { kind: 'mapping', data: {} };
	}
	if (!isMapping(document)) {
		return { kind: 'invalid', reason: 'the block is not a mapping' };
	}
	return { kind: 'mapping', data: { ...document } };
}

function composeNote(
	data: Record<string, unknown>,
	body: string,
	hadBlock: boolean,
): string {
	const entries = Object.entries(data).filter(
		([, value]) => value !== undefined,
	);
	if (entries.length === 0 && !hadBlock) {
		return body;
	}
	let yaml = '';
	if (entries.length > 0) {
		try {
			yaml = endWithBreak(
				stringify(Object.fromEntries(entries), STRINGIFY_OPTIONS),
			);
		} catch (error) {
			throw new FrontmatterError(
				`the writer cannot write a value in the frontmatter as YAML. Use a value that YAML can hold. The reason: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}
	return `${DELIMITER}\n${yaml}${DELIMITER}\n${body}`;
}

function isMapping(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDelimiter(line: string): boolean {
	return (line.endsWith('\r') ? line.slice(0, -1) : line) === DELIMITER;
}

function endWithBreak(text: string): string {
	return text.endsWith('\n') ? text : `${text}\n`;
}
