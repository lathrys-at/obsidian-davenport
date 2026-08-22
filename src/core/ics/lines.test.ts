/**
 * The reader of the lines, on its own.
 *
 * The parse boundary calls this reader after the parse library read the same
 * text, so the library throws before the boundary reaches four of the
 * refusals below. The reader states those refusals because it must not
 * invent a reading of a line that it cannot read. The cases here call the
 * reader directly, and they hold that contract.
 */

import { describe, expect, it } from 'vitest';
import { hasControlCharacter, logicalLines, readContentLine } from './lines';

/** The line that a read gives back. The helper throws where the read fails. */
function lineOf(text: string) {
	const reading = readContentLine(text);
	if (!reading.ok) {
		throw new Error(`the reader refused the line: ${reading.problem}`);
	}
	return reading.line;
}

/** The problem of a read. The helper throws where the read succeeds. */
function problemOf(text: string): string {
	const reading = readContentLine(text);
	if (reading.ok) {
		throw new Error('the reader read the line');
	}
	return reading.problem;
}

describe('the logical lines of a text', () => {
	it('joins a fold that a space opens', () => {
		expect(logicalLines('X-A:one\r\n two\r\n')).toEqual(['X-A:onetwo']);
	});

	it('joins a fold that a tab opens', () => {
		expect(logicalLines('X-A:one\r\n\ttwo\r\n')).toEqual(['X-A:onetwo']);
	});

	it('reads a line that ends with a line feed alone', () => {
		expect(logicalLines('X-A:one\nX-B:two\n')).toEqual([
			'X-A:one',
			'X-B:two',
		]);
	});

	it('keeps a carriage return that no line feed follows', () => {
		expect(logicalLines('X-A:one\rtwo\r\n')).toEqual(['X-A:one\rtwo']);
	});

	it('gives nothing back for a text that starts with a fold', () => {
		expect(logicalLines(' X-A:one\r\n')).toBeNull();
	});
});

describe('the control characters of a line', () => {
	it('permits the horizontal tab', () => {
		expect(hasControlCharacter('X-A:one\ttwo')).toBe(false);
	});

	it('finds a carriage return', () => {
		expect(hasControlCharacter('X-A:one\rtwo')).toBe(true);
	});

	it('finds the delete character', () => {
		expect(hasControlCharacter('X-A:onetwo')).toBe(true);
	});

	it('finds nothing in a line of ordinary characters', () => {
		expect(hasControlCharacter('X-A;X-P=one:two')).toBe(false);
	});
});

describe('the read of one content line', () => {
	it('reads a name and a value', () => {
		expect(lineOf('X-A:one')).toEqual({
			name: 'X-A',
			parameters: [],
			value: 'one',
		});
	});

	it('reads one parameter that carries no quotation marks', () => {
		const line = lineOf('X-A;X-P=one:two');
		expect(line.parameters).toEqual([
			{
				name: 'X-P',
				text: 'one',
				values: ['one'],
				quoted: false,
				at: 8,
			},
		]);
		expect(line.value).toBe('two');
	});

	it('reads one parameter that quotation marks enclose', () => {
		const line = lineOf('X-A;X-P="one":two');
		expect(line.parameters).toEqual([
			{
				name: 'X-P',
				text: 'one',
				values: ['one'],
				quoted: true,
				at: 9,
			},
		]);
		expect(line.value).toBe('two');
	});

	it('divides a list of quoted values before it decodes any of them', () => {
		const line = lineOf('X-A;MEMBER="^\',","x":two');
		expect(line.parameters[0]?.values).toEqual(["^',", 'x']);
		expect(line.value).toBe('two');
	});

	it('reads a comma that no second value follows as one value', () => {
		expect(lineOf('X-A;X-P="a,b":two').parameters[0]?.values).toEqual([
			'a,b',
		]);
	});

	it('reads a colon inside a quoted value as one character of it', () => {
		const line = lineOf('X-A;X-P="a:b":two');
		expect(line.parameters[0]?.text).toBe('a:b');
		expect(line.value).toBe('two');
	});

	it('reads a parameter that carries no value', () => {
		expect(lineOf('X-A;X-P=:two').parameters[0]?.text).toBe('');
	});

	it('refuses a line that holds no colon and no semicolon', () => {
		expect(problemOf('X-A')).toBe('holds no colon and no semicolon');
	});

	it('refuses a line that holds a semicolon and no colon', () => {
		expect(problemOf('X-A;X-P=one')).toBe(
			'holds text between its last parameter and its value',
		);
	});

	it('refuses a parameter with no name', () => {
		expect(problemOf('X-A;=one:two')).toBe(
			'holds a parameter with no name',
		);
	});

	it('refuses a quoted value with no closing quotation mark', () => {
		expect(problemOf('X-A;X-P="one:two')).toBe(
			'holds a quoted parameter value with no closing quotation mark',
		);
	});

	it('refuses a second quoted value with no closing quotation mark', () => {
		expect(problemOf('X-A;MEMBER="a","b:two')).toBe(
			'holds a quoted parameter value with no closing quotation mark',
		);
	});

	it('refuses a line that holds text between its parameters and its value', () => {
		expect(problemOf('X-A;X-P="one" junk:two')).toBe(
			'holds text between its last parameter and its value',
		);
	});
});
