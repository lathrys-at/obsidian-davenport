/**
 * Frontmatter reading and writing for the vault fake. The writer's output
 * is a pure function of the data it is handed, so the same operations
 * always produce the same bytes.
 *
 * The canon the writer emits, whatever the note looked like before:
 *
 * - The block is `---`, the YAML text, then `---`, each on its own line,
 *   separated by line feeds. Everything after the closing line is copied
 *   through byte for byte.
 * - Keys appear in the property order of the object the update leaves
 *   behind: keys parsed from the note hold their position, keys the update
 *   adds follow in the order it added them, and keys it removes are gone.
 *   JavaScript orders integer-like keys ahead of the rest, so a key such
 *   as `2026` moves to the front.
 * - Collections are block style, indented two spaces, sequences indented
 *   under their key. An empty collection has no block form and emits as
 *   `[]` or `{}`.
 * - Scalars are plain where the YAML 1.2 core schema permits, double
 *   quoted where it does not, and literal blocks where the string spans
 *   lines or ends in a line break. Lines are never folded to a width.
 * - A key set to `undefined` goes the way of a key that was deleted.
 * - Repeated references to one object emit as repeated values rather than
 *   anchors and aliases, and a cycle is an error rather than an anchor.
 * - Comments do not survive a write: the block is rebuilt from parsed
 *   data, so any comment in it is lost.
 * - A block with no keys emits as an empty block when the note already had
 *   one, and as no block at all when it did not.
 *
 * This is determinism by construction, not a claim about the writer
 * Obsidian itself ships. Whether the two agree byte for byte is measured
 * against real installations and never assumed here.
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

/** Raised when a note's frontmatter block cannot be rewritten. */
export class FrontmatterError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FrontmatterError';
	}
}

export interface SplitNote {
	/**
	 * The YAML text between the delimiters, ending in a line feed unless
	 * empty; null when the note carries no block.
	 */
	readonly yaml: string | null;
	/**
	 * Everything after the closing delimiter line, or the whole note when
	 * there is no block.
	 */
	readonly body: string;
}

/** What a block reads as once it is there to read. */
export type BlockRead =
	| { readonly kind: 'invalid'; readonly reason: string }
	| { readonly kind: 'mapping'; readonly data: Record<string, unknown> };

export type FrontmatterRead = { readonly kind: 'absent' } | BlockRead;

/**
 * Splits a note into its frontmatter block and its body. A block counts
 * only when `---` opens the very first line and a later line is `---` on
 * its own; an unterminated block is body text. Delimiter lines may end
 * with a carriage return.
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
 * Reads a note's frontmatter. A block that is empty, or holds nothing but
 * comments, reads as an empty mapping; one that does not parse, or parses
 * to anything other than a mapping, reads as invalid.
 */
export function readFrontmatter(content: string): FrontmatterRead {
	const { yaml } = splitNote(content);
	return yaml === null ? { kind: 'absent' } : parseBlock(yaml);
}

/**
 * Applies `update` to a note's frontmatter and returns the rewritten note.
 * A note with no block starts from an empty mapping; a note whose block
 * does not read as a mapping is refused rather than overwritten.
 */
export function writeFrontmatter(
	content: string,
	update: (frontmatter: Record<string, unknown>) => void,
): string {
	const { yaml, body } = splitNote(content);
	const read = yaml === null ? null : parseBlock(yaml);
	if (read !== null && read.kind === 'invalid') {
		throw new FrontmatterError(
			`frontmatter does not read as a mapping: ${read.reason}`,
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
		return { kind: 'invalid', reason: 'block is not a mapping' };
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
				`frontmatter holds a value the writer cannot represent: ${
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
