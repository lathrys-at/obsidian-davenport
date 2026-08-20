import { describe, expect, it } from 'vitest';
import type { RecordEntry } from './emitter';
import { emitFrontmatter, flag, integer, map, text, texts } from './emitter';
import type { Loaded } from './loader';
import { loadFrontmatter, unquote } from './loader';

const NUL = String.fromCharCode(0);
const LONE_HIGH = String.fromCharCode(0xd800);

function load(source: string): ReadonlyMap<string, Loaded> {
	const result = loadFrontmatter(source);
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result.entries;
}

function refusal(source: string): string {
	const result = loadFrontmatter(source);
	if (result.ok) {
		throw new Error('the reader took a text that it must refuse');
	}
	return result.message;
}

/** The tree that the loader gives, as plain values. */
function plain(node: Loaded): unknown {
	switch (node.kind) {
		case 'text':
			return node.value;
		case 'integer':
			return node.value;
		case 'flag':
			return node.value;
		case 'texts':
			return [...node.values];
		case 'map':
			return Object.fromEntries(
				[...node.entries].map(([key, inside]) => [key, plain(inside)]),
			);
	}
}

const DOCUMENT: readonly RecordEntry[] = [
	{ key: 'plain', node: text('a value') },
	{ key: 'number', node: integer(-4) },
	{ key: 'yes', node: flag(true) },
	{ key: 'empty', node: texts([]) },
	{ key: 'nothing', node: map([]) },
	{ key: 'list', node: texts(['one', 'two']) },
	{
		key: 'nested',
		node: map([
			{ key: 'inside', node: map([{ key: 'deep', node: text('x') }]) },
			{ key: 'after', node: text('y') },
		]),
	},
	{ key: 'last', node: text('z') },
];

describe('the reader of the frontmatter of a record', () => {
	it('reads back what the emitter wrote', () => {
		const entries = load(emitFrontmatter(DOCUMENT));
		expect(plain({ kind: 'map', entries })).toEqual({
			plain: 'a value',
			number: -4,
			yes: true,
			empty: [],
			nothing: {},
			list: ['one', 'two'],
			nested: { inside: { deep: 'x' }, after: 'y' },
			last: 'z',
		});
	});

	it('reads back a text that holds every kind of escape', () => {
		const value = `a"b\\c\nd\te${NUL}f${LONE_HIGH}g😀h`;
		const entries = load(
			emitFrontmatter([{ key: 'a', node: text(value) }]),
		);
		expect(entries.get('a')).toEqual({ kind: 'text', value });
	});

	it('reads back a key that stands in quotation marks', () => {
		const entries = load(
			emitFrontmatter([{ key: '2026-03-02', node: text('a') }]),
		);
		expect(entries.get('2026-03-02')).toEqual({ kind: 'text', value: 'a' });
	});

	it('reads an empty document as no entries', () => {
		expect(load('').size).toBe(0);
	});
});

describe('what the reader of the frontmatter refuses', () => {
	it('refuses a tab', () => {
		expect(refusal('a:\tb\n')).toContain('holds a tab');
	});

	it('refuses a carriage return', () => {
		expect(refusal('a: "b"\r\n')).toContain('holds a carriage return');
	});

	it('refuses a line that ends with a space', () => {
		expect(refusal('a: "b" \n')).toContain('ends with a space');
	});

	it('refuses an indent that is not a multiple of two', () => {
		expect(refusal('a:\n   b: "c"\n')).toContain('multiple of two');
	});

	it('refuses an empty line inside the block', () => {
		expect(refusal('a: "b"\n\nc: "d"\n')).toContain('the line is empty');
	});

	it('refuses one key that stands two times in one map', () => {
		expect(refusal('a: "b"\na: "c"\n')).toContain('more than one time');
	});

	it('refuses a key that opens a block and holds nothing', () => {
		expect(refusal('a:\nb: "c"\n')).toContain('the block is empty');
	});

	it('refuses a key that opens a block at the end of the text', () => {
		expect(refusal('a:\n')).toContain('the block is empty');
	});

	it('refuses an indent that stands further right than the block', () => {
		expect(refusal('a: "b"\n    c: "d"\n')).toContain('further right');
	});

	it('refuses a list item that stands further right than the list', () => {
		expect(refusal('a:\n  - "x"\n      - "y"\n')).toContain(
			'not a list item',
		);
	});

	it('refuses a line that is not a key and a value', () => {
		expect(refusal('a value\n')).toContain('not a key and a value');
	});

	it('refuses a list item where a key stands', () => {
		expect(refusal('- "a"\n')).toContain('a list item stands where a key');
	});

	it('refuses a line of a list that is not a list item', () => {
		expect(refusal('a:\n  - "x"\n  b: "c"\n')).toContain('not a list item');
	});

	it('refuses a list item that is not a text', () => {
		expect(refusal('a:\n  - 4\n')).toContain('a list holds texts only');
	});

	it('refuses a list item that does not read at all', () => {
		expect(refusal('a:\n  - bare\n')).toContain('is not a text');
	});

	it('refuses a value that is not a text, a number, a flag, or an empty collection', () => {
		expect(refusal('a: bare\n')).toContain('the value bare is not a text');
	});

	it('refuses a whole number that the language cannot hold exactly', () => {
		expect(refusal('a: 900719925474099123\n')).toContain('too large');
	});

	it('refuses an escape that the emitter does not write', () => {
		expect(refusal('a: "\\z"\n')).toContain('is not one that the emitter');
	});

	it('refuses a short escape with a digit that is not hexadecimal', () => {
		expect(refusal('a: "\\xzz"\n')).toContain(
			'is not one that the emitter',
		);
	});

	it('refuses a long escape with letters in upper case', () => {
		expect(refusal('a: "\\uFEFF"\n')).toContain(
			'is not one that the emitter',
		);
	});

	it('refuses a text that does not close its quotation marks', () => {
		expect(refusal('a: "b\n')).toContain('is not a text');
	});
});

describe('the read of one text out of quotation marks', () => {
	it('reads a text with no escape', () => {
		expect(unquote('plain')).toEqual({ ok: true, value: 'plain' });
	});

	it('reads a short escape at the end of the text', () => {
		expect(unquote('a\\n')).toEqual({ ok: true, value: 'a\n' });
	});

	it('refuses a backslash at the end of the text', () => {
		expect(unquote('a\\').ok).toBe(false);
	});

	it('refuses a long escape that runs past the end of the text', () => {
		expect(unquote('\\u00').ok).toBe(false);
	});
});
