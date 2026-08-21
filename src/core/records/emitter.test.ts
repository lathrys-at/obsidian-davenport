import { describe, expect, it } from 'vitest';
import {
	emitFrontmatter,
	flag,
	integer,
	map,
	quote,
	text,
	texts,
} from './emitter';

const NUL = String.fromCharCode(0);
const BELL = String.fromCharCode(7);
const ESCAPE = String.fromCharCode(27);
const DELETE = String.fromCharCode(127);
const NEXT_LINE = String.fromCharCode(0x85);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
const LONE_HIGH = String.fromCharCode(0xd800);
const LONE_LOW = String.fromCharCode(0xdc00);
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

describe('the keys that the emitter writes', () => {
	it('writes a key of letters and digits bare', () => {
		expect(emitFrontmatter([{ key: 'endDate', node: text('a') }])).toBe(
			'endDate: "a"\n',
		);
	});

	it('writes a key that holds a hyphen in quotation marks', () => {
		expect(emitFrontmatter([{ key: 'x-name', node: text('a') }])).toBe(
			'"x-name": "a"\n',
		);
	});

	it('writes a key that starts with a digit in quotation marks', () => {
		expect(emitFrontmatter([{ key: '2026', node: text('a') }])).toBe(
			'"2026": "a"\n',
		);
	});

	it('writes a date key in quotation marks', () => {
		expect(emitFrontmatter([{ key: '2026-03-02', node: text('a') }])).toBe(
			'"2026-03-02": "a"\n',
		);
	});

	it.each(['true', 'false', 'yes', 'no', 'on', 'off', 'y', 'n', 'null'])(
		'writes the key %s in quotation marks, because a reader gives it a value',
		(word) => {
			expect(emitFrontmatter([{ key: word, node: text('a') }])).toBe(
				`"${word}": "a"\n`,
			);
		},
	);

	it('writes a key of the same word in other letters in quotation marks', () => {
		expect(emitFrontmatter([{ key: 'True', node: text('a') }])).toBe(
			'"True": "a"\n',
		);
	});

	it('writes an empty key in quotation marks', () => {
		expect(emitFrontmatter([{ key: '', node: text('a') }])).toBe(
			'"": "a"\n',
		);
	});
});

describe('the values that the emitter writes', () => {
	it('writes every text in quotation marks', () => {
		expect(emitFrontmatter([{ key: 'a', node: text('plain') }])).toBe(
			'a: "plain"\n',
		);
	});

	it('writes a whole number bare', () => {
		expect(emitFrontmatter([{ key: 'a', node: integer(-12) }])).toBe(
			'a: -12\n',
		);
	});

	it('writes a flag bare', () => {
		expect(
			emitFrontmatter([
				{ key: 'a', node: flag(true) },
				{ key: 'b', node: flag(false) },
			]),
		).toBe('a: true\nb: false\n');
	});

	it('refuses a number that is not a whole number', () => {
		expect(() =>
			emitFrontmatter([{ key: 'a', node: integer(1.5) }]),
		).toThrow('whole numbers only');
	});

	it('refuses a whole number that the language cannot hold exactly', () => {
		expect(() =>
			emitFrontmatter([
				{ key: 'a', node: integer(Number.MAX_SAFE_INTEGER + 2) },
			]),
		).toThrow('whole numbers only');
	});

	it('writes an empty list on one line', () => {
		expect(emitFrontmatter([{ key: 'a', node: texts([]) }])).toBe(
			'a: []\n',
		);
	});

	it('writes an empty map on one line', () => {
		expect(emitFrontmatter([{ key: 'a', node: map([]) }])).toBe('a: {}\n');
	});

	it('writes a list one item to a line, two spaces further right', () => {
		expect(emitFrontmatter([{ key: 'a', node: texts(['x', 'y']) }])).toBe(
			'a:\n  - "x"\n  - "y"\n',
		);
	});

	it('writes each level of a map two spaces further right', () => {
		expect(
			emitFrontmatter([
				{
					key: 'a',
					node: map([
						{
							key: 'b',
							node: map([{ key: 'c', node: text('d') }]),
						},
					]),
				},
			]),
		).toBe('a:\n  b:\n    c: "d"\n');
	});

	it('writes the entries of a map in the order that the caller gives', () => {
		expect(
			emitFrontmatter([
				{ key: 'b', node: text('1') },
				{ key: 'a', node: text('2') },
			]),
		).toBe('b: "1"\na: "2"\n');
	});

	it('writes no line that ends with a space, and no empty line', () => {
		const written = emitFrontmatter([
			{ key: 'a', node: texts([]) },
			{ key: 'b', node: map([{ key: 'c', node: texts(['d']) }]) },
		]);
		for (const line of written.split('\n').slice(0, -1)) {
			expect(line).not.toBe('');
			expect(line.endsWith(' ')).toBe(false);
		}
	});

	it('writes nothing for an empty document', () => {
		expect(emitFrontmatter([])).toBe('');
	});
});

describe('the escapes of a text', () => {
	it.each([
		['a backslash', '\\', '"\\\\"'],
		['a quotation mark', '"', '"\\""'],
		['a tab', '\t', '"\\t"'],
		['a line feed', '\n', '"\\n"'],
		['a carriage return', '\r', '"\\r"'],
		['the character with the value zero', NUL, '"\\x00"'],
		['a bell', BELL, '"\\x07"'],
		['an escape', ESCAPE, '"\\x1b"'],
		['the delete character', DELETE, '"\\x7f"'],
		['a control character of the second range', NEXT_LINE, '"\\x85"'],
		['the line separator of Unicode', LINE_SEPARATOR, '"\\u2028"'],
		['the mark at the front of a file', BYTE_ORDER_MARK, '"\\ufeff"'],
		['a high surrogate with no partner', LONE_HIGH, '"\\ud800"'],
		['a low surrogate with no partner', LONE_LOW, '"\\udc00"'],
	])('writes %s as an escape', (_name, value, written) => {
		expect(quote(value)).toBe(written);
	});

	it.each([
		['a space that does not break a line', NO_BREAK_SPACE],
		['a letter with a mark', 'é'],
		['a character of another writing system', '日'],
		['a character above the first plane', '😀'],
		['a mark that stands after its letter', 'e\u0301'],
	])('writes %s as it stands', (_name, value) => {
		expect(quote(value)).toBe(`"${value}"`);
	});

	it('keeps the two halves of one character above the first plane together', () => {
		expect(quote('a😀b')).toBe('"a😀b"');
	});

	it('escapes a high surrogate that stands before a character', () => {
		expect(quote(`${LONE_HIGH}a`)).toBe('"\\ud800a"');
	});

	it('escapes a low surrogate that stands before a high surrogate', () => {
		expect(quote(`${LONE_LOW}${LONE_HIGH}`)).toBe('"\\udc00\\ud800"');
	});

	it('writes an empty text as two quotation marks', () => {
		expect(quote('')).toBe('""');
	});
});
