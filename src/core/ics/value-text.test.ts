/**
 * The comparison of the values, on its own.
 *
 * The check of the place where the value of the property starts stands in
 * front of this comparison, and it refuses a line whose two readings find
 * another colon. No text of the format therefore reaches this comparison
 * with a value that differs, and the messages below need a caller of their
 * own. The cases here are that caller. They hold what the comparison says
 * when the parser read another value than the text states.
 */

import { describe, expect, it } from 'vitest';
import { valueContentProblem } from './value-text';

const NO_DIVIDERS = { between: null, inside: null } as const;

describe('a type that the library carries with no change', () => {
	it('states no problem where the value is the text', () => {
		expect(
			valueContentProblem('unknown', 'one', ['one'], NO_DIVIDERS),
		).toBeNull();
	});

	it('states the problem where the parser read another value', () => {
		expect(
			valueContentProblem('unknown', 'one', ['two'], NO_DIVIDERS),
		).toBe('carries "one", and the parser read "two"');
	});

	it('reads no value of a property that divides its text', () => {
		expect(
			valueContentProblem('uri', 'one,two', ['one', 'two'], {
				between: ',',
				inside: null,
			}),
		).toBeNull();
	});

	it('reads no property that the parser gave more than one value', () => {
		expect(
			valueContentProblem('unknown', 'one', ['one', 'two'], NO_DIVIDERS),
		).toBeNull();
	});

	it('reads no type that the library gives a form of its own', () => {
		expect(
			valueContentProblem(
				'date-time',
				'19000101T000000',
				['1900-01-01T00:00:00'],
				NO_DIVIDERS,
			),
		).toBeNull();
	});
});

describe('a value of the type text', () => {
	it('states no problem where the values are the values of the text', () => {
		expect(
			valueContentProblem('text', 'one,two', ['one', 'two'], {
				between: ',',
				inside: null,
			}),
		).toBeNull();
	});

	it('reads an escaped separator as one character of a value', () => {
		expect(
			valueContentProblem('text', 'one\\,two', ['one,two'], {
				between: ',',
				inside: null,
			}),
		).toBeNull();
	});

	it('states the count where the parser reports another number of values', () => {
		expect(
			valueContentProblem('text', 'one,two', ['one,two'], {
				between: ',',
				inside: null,
			}),
		).toBe('carries 2 values, and the parser reports 1');
	});

	it('states the count where the parser reports another number of parts', () => {
		expect(
			valueContentProblem('text', 'one;two', ['one;two'], {
				between: null,
				inside: ';',
			}),
		).toBe(
			'carries 2 parts in "one;two", and the parser reports "one;two"',
		);
	});

	it('states the problem where the parser read another part', () => {
		expect(
			valueContentProblem('text', 'one;two', [['one', 'three']], {
				between: null,
				inside: ';',
			}),
		).toBe('carries "two", and the parser read "three"');
	});

	it('states the problem where the parser read nothing for a value', () => {
		expect(valueContentProblem('text', 'one', [], NO_DIVIDERS)).toBe(
			'carries 1 values, and the parser reports 0',
		);
	});
});
