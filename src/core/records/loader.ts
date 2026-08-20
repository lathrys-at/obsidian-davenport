/**
 * The reader of the frontmatter that the owned emitter writes.
 *
 * The reader takes the dialect of the emitter, and it takes nothing else.
 * The emitter writes one shape for each kind of value, and the reader
 * accepts that shape alone. A text stands in quotation marks on one line.
 * A whole number stands bare. A flag stands as `true` or as `false`. An
 * empty list stands as `[]`, and an empty map stands as `{}`. Every other
 * list and every other map opens a block, and each level of a block
 * stands two spaces further right than the level above it.
 *
 * The reader refuses everything else, and it names what it refused. It
 * refuses a tab, a line that ends with a space, an indent that is not a
 * multiple of two, a key that stands two times in one map, and a value
 * that it cannot read. A record is machine-owned, so a shape that the
 * emitter cannot write is damage, and damage must not pass as data.
 *
 * The reader is strict on purpose. A permissive reader would repair a
 * file that a merge damaged, and the repair would then travel to every
 * other device as the truth.
 */

/** One value that the reader took out of the frontmatter. */
export type Loaded =
	| { readonly kind: 'text'; readonly value: string }
	| { readonly kind: 'integer'; readonly value: number }
	| { readonly kind: 'flag'; readonly value: boolean }
	| { readonly kind: 'texts'; readonly values: readonly string[] }
	| { readonly kind: 'map'; readonly entries: ReadonlyMap<string, Loaded> };

/** What a read of the frontmatter gives back. */
export type LoadResult =
	| { readonly ok: true; readonly entries: ReadonlyMap<string, Loaded> }
	| { readonly ok: false; readonly message: string };

interface Line {
	readonly indent: number;
	readonly text: string;
	readonly number: number;
}

/** Reads the frontmatter of a record into a map of values. */
export function loadFrontmatter(text: string): LoadResult {
	const lines: Line[] = [];
	const source = text.split('\n');
	for (let index = 0; index < source.length; index += 1) {
		const raw = source[index] ?? '';
		if (raw.length === 0) {
			if (index === source.length - 1) {
				continue;
			}
			return refuse(`line ${String(index + 1)}: the line is empty`);
		}
		const problem = lineProblem(raw);
		if (problem !== null) {
			return refuse(`line ${String(index + 1)}: ${problem}`);
		}
		const indent = raw.length - raw.trimStart().length;
		lines.push({ indent, text: raw.slice(indent), number: index + 1 });
	}
	return readMap(lines, { at: 0 }, 0);
}

function lineProblem(raw: string): string | null {
	if (raw.includes('\t')) {
		return 'the line holds a tab';
	}
	if (raw.includes('\r')) {
		return 'the line holds a carriage return';
	}
	if (raw.endsWith(' ')) {
		return 'the line ends with a space';
	}
	const indent = raw.length - raw.trimStart().length;
	if (indent % 2 !== 0) {
		return `the indent of ${String(indent)} spaces is not a multiple of two`;
	}
	return null;
}

interface Cursor {
	at: number;
}

function readMap(
	lines: readonly Line[],
	state: Cursor,
	indent: number,
): LoadResult {
	const entries = new Map<string, Loaded>();
	while (state.at < lines.length) {
		const line = lines[state.at];
		if (line === undefined || line.indent < indent) {
			break;
		}
		if (line.indent > indent) {
			return refuse(
				`line ${String(line.number)}: the indent stands further right than the block that holds it`,
			);
		}
		const head = readHead(line);
		if (!head.ok) {
			return head;
		}
		if (entries.has(head.key)) {
			return refuse(
				`line ${String(line.number)}: the key ${head.key} stands more than one time in one map`,
			);
		}
		state.at += 1;
		const value =
			head.rest === null
				? readBlock(lines, state, indent + 2, line)
				: readScalar(head.rest, line);
		if (!value.ok) {
			return { ok: false, message: value.message };
		}
		entries.set(head.key, value.value);
	}
	return { ok: true, entries };
}

type HeadResult =
	| { readonly ok: true; readonly key: string; readonly rest: string | null }
	| { readonly ok: false; readonly message: string };

const BARE_KEY = /^[A-Za-z][A-Za-z0-9]*$/;

function readHead(line: Line): HeadResult {
	if (line.text.startsWith('- ')) {
		return refuse(
			`line ${String(line.number)}: a list item stands where a key stands`,
		);
	}
	const quoted = /^"((?:[^"\\]|\\.)*)":( (.*))?$/.exec(line.text);
	if (quoted !== null) {
		const key = unquote(quoted[1] ?? '');
		if (!key.ok) {
			return refuse(`line ${String(line.number)}: ${key.message}`);
		}
		return { ok: true, key: key.value, rest: quoted[3] ?? null };
	}
	const bare = /^([^:"]*):( (.*))?$/.exec(line.text);
	if (bare === null || !BARE_KEY.test(bare[1] ?? '')) {
		return refuse(
			`line ${String(line.number)}: the line is not a key and a value`,
		);
	}
	return { ok: true, key: bare[1] ?? '', rest: bare[3] ?? null };
}

type ValueResult =
	| { readonly ok: true; readonly value: Loaded }
	| { readonly ok: false; readonly message: string };

function readScalar(token: string, line: Line): ValueResult {
	if (token === '[]') {
		return { ok: true, value: { kind: 'texts', values: [] } };
	}
	if (token === '{}') {
		return { ok: true, value: { kind: 'map', entries: new Map() } };
	}
	if (token === 'true' || token === 'false') {
		return { ok: true, value: { kind: 'flag', value: token === 'true' } };
	}
	if (/^-?\d+$/.test(token)) {
		const value = Number(token);
		return Number.isSafeInteger(value)
			? { ok: true, value: { kind: 'integer', value } }
			: refuse(
					`line ${String(line.number)}: the whole number ${token} is too large`,
				);
	}
	const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(token);
	if (quoted === null) {
		return refuse(
			`line ${String(line.number)}: the value ${token} is not a text, a whole number, a flag, or an empty collection`,
		);
	}
	const read = unquote(quoted[1] ?? '');
	return read.ok
		? { ok: true, value: { kind: 'text', value: read.value } }
		: refuse(`line ${String(line.number)}: ${read.message}`);
}

function readBlock(
	lines: readonly Line[],
	state: Cursor,
	indent: number,
	head: Line,
): ValueResult {
	const first = lines[state.at];
	if (first?.indent !== indent) {
		return refuse(
			`line ${String(head.number)}: the key opens a block and the block is empty`,
		);
	}
	if (first.text.startsWith('- ')) {
		return readList(lines, state, indent);
	}
	const entries = readMap(lines, state, indent);
	return entries.ok
		? { ok: true, value: { kind: 'map', entries: entries.entries } }
		: { ok: false, message: entries.message };
}

function readList(
	lines: readonly Line[],
	state: Cursor,
	indent: number,
): ValueResult {
	const values: string[] = [];
	while (state.at < lines.length) {
		const line = lines[state.at];
		if (line === undefined || line.indent < indent) {
			break;
		}
		if (line.indent > indent || !line.text.startsWith('- ')) {
			return refuse(
				`line ${String(line.number)}: the line stands in a list and is not a list item`,
			);
		}
		const item = readScalar(line.text.slice(2), line);
		if (!item.ok) {
			return item;
		}
		if (item.value.kind !== 'text') {
			return refuse(
				`line ${String(line.number)}: a list holds texts only`,
			);
		}
		values.push(item.value.value);
		state.at += 1;
	}
	return { ok: true, value: { kind: 'texts', values } };
}

type UnquoteResult =
	| { readonly ok: true; readonly value: string }
	| { readonly ok: false; readonly message: string };

const SHORT_ESCAPES: ReadonlyMap<string, string> = new Map([
	['\\', '\\'],
	['"', '"'],
	['t', '\t'],
	['n', '\n'],
	['r', '\r'],
]);

/** The text that the characters inside one pair of quotation marks hold. */
export function unquote(inside: string): UnquoteResult {
	let out = '';
	let index = 0;
	while (index < inside.length) {
		const character = inside.charAt(index);
		if (character !== '\\') {
			out += character;
			index += 1;
			continue;
		}
		const mark = inside.charAt(index + 1);
		const short = SHORT_ESCAPES.get(mark);
		if (short !== undefined) {
			out += short;
			index += 2;
			continue;
		}
		const width = mark === 'x' ? 2 : mark === 'u' ? 4 : 0;
		if (width === 0) {
			return {
				ok: false,
				message: `the escape \\${mark} is not one that the emitter writes`,
			};
		}
		const digits = inside.slice(index + 2, index + 2 + width);
		if (!new RegExp(`^[0-9a-f]{${String(width)}}$`).test(digits)) {
			return {
				ok: false,
				message: `the escape \\${mark}${digits} is not one that the emitter writes`,
			};
		}
		out += String.fromCharCode(Number.parseInt(digits, 16));
		index += 2 + width;
	}
	return { ok: true, value: out };
}

function refuse(message: string): { ok: false; message: string } {
	return { ok: false, message };
}
