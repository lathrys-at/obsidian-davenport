/**
 * The emitter that writes the frontmatter of a record.
 *
 * The plugin owns this emitter, and the plugin uses no YAML library for
 * this. A library writes the bytes that its own version writes. Two
 * devices at two versions of one library therefore write two different
 * files for one event, and each device rewrites the file of the other
 * one. The emitter here writes the same bytes on every device that runs
 * one plugin build, and the core component of the normalization stamp
 * names the build. A golden corpus holds the emitter to those bytes.
 *
 * The emitter takes a closed document, and not an arbitrary value. The
 * document holds four kinds of node: a text, a whole number, a flag, and
 * a list of texts. A map holds entries, and an entry holds a key and a
 * node. The record schema builds the document, and the schema is the only
 * caller. A node that the schema cannot build is a node that the emitter
 * refuses.
 *
 * The rules that fix the bytes:
 *
 * - Every line ends with one line feed. The emitter writes no carriage
 *   return, and it writes no trailing space.
 * - Each level of a map or a list stands two spaces further right than
 *   the level above it.
 * - A key stands bare when the key holds letters and digits only, starts
 *   with a letter, and does not read as a flag or as an empty value.
 *   Every other key stands in quotation marks. A date is one key of the
 *   second kind: `2026-03-02` bare reads as a date and not as a text.
 * - Every text value stands in quotation marks, and the emitter never
 *   asks whether the text needs them. A rule that asks that question has
 *   a boundary, and a boundary is a place where two builds can answer
 *   differently.
 * - A text value stands on one line. The emitter writes a line feed
 *   inside a text as the two characters `\n`, and it writes every other
 *   character that a reader cannot print as an escape. A value on one
 *   line keeps the blanking rule of the checksum simple, and it keeps a
 *   line-level merge from moving one half of a value.
 * - An empty list stands as `[]`, and an empty map stands as `{}`. The
 *   emitter therefore writes no empty line.
 *
 * The emitter refuses a number that is not a whole number, and it refuses
 * a whole number that is too large for the language to hold exactly. Such
 * a number is a fault of the caller, and not a value that a user wrote.
 */

/** One node of the document that the emitter writes. */
export type RecordNode =
	| { readonly kind: 'text'; readonly value: string }
	| { readonly kind: 'integer'; readonly value: number }
	| { readonly kind: 'flag'; readonly value: boolean }
	| { readonly kind: 'texts'; readonly values: readonly string[] }
	| { readonly kind: 'map'; readonly entries: readonly RecordEntry[] };

/** One entry of a map: a key and the node under that key. */
export interface RecordEntry {
	readonly key: string;
	readonly node: RecordNode;
}

/** The text of one text node. */
export function text(value: string): RecordNode {
	return { kind: 'text', value };
}

/** The node of one whole number. */
export function integer(value: number): RecordNode {
	return { kind: 'integer', value };
}

/** The node of one flag. */
export function flag(value: boolean): RecordNode {
	return { kind: 'flag', value };
}

/** The node of a list of texts. */
export function texts(values: readonly string[]): RecordNode {
	return { kind: 'texts', values };
}

/** The node of a map. The entries stand in the order that the caller gives. */
export function map(entries: readonly RecordEntry[]): RecordNode {
	return { kind: 'map', entries };
}

/**
 * The frontmatter that the entries give, with no fence around it. The
 * result ends with a line feed when the entries hold at least one entry.
 * An empty list of entries gives an empty text.
 */
export function emitFrontmatter(entries: readonly RecordEntry[]): string {
	return entries.map((entry) => emitEntry(entry, 0)).join('');
}

const INDENT = '  ';

function emitEntry(entry: RecordEntry, depth: number): string {
	const start = `${INDENT.repeat(depth)}${emitKey(entry.key)}:`;
	const node = entry.node;
	switch (node.kind) {
		case 'text':
			return `${start} ${quote(node.value)}\n`;
		case 'integer':
			return `${start} ${emitInteger(node.value)}\n`;
		case 'flag':
			return `${start} ${node.value ? 'true' : 'false'}\n`;
		case 'texts':
			return node.values.length === 0
				? `${start} []\n`
				: start +
						'\n' +
						node.values
							.map(
								(value) =>
									`${INDENT.repeat(depth + 1)}- ${quote(value)}\n`,
							)
							.join('');
		case 'map':
			return node.entries.length === 0
				? `${start} {}\n`
				: start +
						'\n' +
						node.entries
							.map((inside) => emitEntry(inside, depth + 1))
							.join('');
	}
}

/**
 * A key that holds letters and digits only and starts with a letter. Such
 * a key stands bare, unless the word below takes it back.
 */
const BARE_KEY = /^[A-Za-z][A-Za-z0-9]*$/;

/**
 * The words that a bare key must not be. A reader of YAML gives each of
 * these words a value of its own, so a bare key of this shape stops being
 * a text.
 */
const RESERVED_KEYS: ReadonlySet<string> = new Set([
	'true',
	'false',
	'yes',
	'no',
	'on',
	'off',
	'y',
	'n',
	'null',
]);

function emitKey(key: string): string {
	return BARE_KEY.test(key) && !RESERVED_KEYS.has(key.toLowerCase())
		? key
		: quote(key);
}

function emitInteger(value: number): string {
	if (!Number.isSafeInteger(value)) {
		throw new Error(
			`the record emitter writes whole numbers only, and it received ${String(value)}`,
		);
	}
	return String(value);
}

/** The characters that take a short escape of their own. */
const SHORT_ESCAPES: ReadonlyMap<string, string> = new Map([
	['\\', '\\\\'],
	['"', '\\"'],
	['\t', '\\t'],
	['\n', '\\n'],
	['\r', '\\r'],
]);

/**
 * The text in quotation marks, with an escape for every character that a
 * reader cannot print.
 *
 * The function reads the text one code unit at a time. A pair of
 * surrogates stands for one character above U+FFFF, and the two units of
 * such a pair pass through as they are. A surrogate with no partner
 * stands for no character at all: an encoder of UTF-8 replaces it, and
 * the replacement would give one text two forms. The function therefore
 * writes a lone surrogate as an escape, and the octets of the file then
 * hold the value whole.
 */
export function quote(value: string): string {
	let out = '"';
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		const next = value.charCodeAt(index + 1);
		if (isHighSurrogate(unit) && isLowSurrogate(next)) {
			out += String.fromCharCode(unit, next);
			index += 1;
			continue;
		}
		out += escapeUnit(unit);
	}
	return out + '"';
}

function escapeUnit(unit: number): string {
	const character = String.fromCharCode(unit);
	const short = SHORT_ESCAPES.get(character);
	if (short !== undefined) {
		return short;
	}
	return needsEscape(unit) ? hexEscape(unit) : character;
}

/**
 * True for a code unit that a reader cannot print. The set holds the
 * control characters of both ranges, the two line separators of Unicode,
 * the mark that some tools put at the front of a file, and every
 * surrogate that reaches this function alone.
 */
function needsEscape(unit: number): boolean {
	return (
		unit < 0x20 ||
		unit === 0x7f ||
		(unit >= 0x80 && unit <= 0x9f) ||
		unit === 0x2028 ||
		unit === 0x2029 ||
		unit === 0xfeff ||
		isHighSurrogate(unit) ||
		isLowSurrogate(unit)
	);
}

function hexEscape(unit: number): string {
	return unit < 0x100
		? `\\x${unit.toString(16).padStart(2, '0')}`
		: `\\u${unit.toString(16).padStart(4, '0')}`;
}

function isHighSurrogate(unit: number): boolean {
	return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
	return unit >= 0xdc00 && unit <= 0xdfff;
}
