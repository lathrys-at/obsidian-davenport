/**
 * The checks of a parameter, on their own.
 *
 * The parse boundary calls these checks in one order, and each one rests on
 * the checks before it. Two of them therefore hold a guard for a state that
 * the order makes impossible: the parser reports no value under the name of
 * a parameter that the text writes. A parameter name that the two readings
 * disagree about is refused by the count of the parameters, so no text
 * reaches the guard. The cases here call the checks directly and hold what
 * each guard does.
 */

import { describe, expect, it } from 'vitest';
import type { ContentLine, ContentParameter } from './lines';
import { readContentLine } from './lines';
import { parameterTextProblem, valueStartProblem } from './parameters';

/** The reading of one line. The helper throws where the read fails. */
function lineOf(text: string): ContentLine {
	const reading = readContentLine(text);
	if (!reading.ok) {
		throw new Error(`the reader refused the line: ${reading.problem}`);
	}
	return reading.line;
}

/** One parameter of a line. */
function parameterOf(text: string): ContentParameter {
	const parameter = lineOf(text).parameters[0];
	if (parameter === undefined) {
		throw new Error('the line carries no parameter');
	}
	return parameter;
}

describe('the text of a parameter value', () => {
	it('states no problem where the parser reports no value', () => {
		expect(
			parameterTextProblem(parameterOf('X-A;X-P=one:two'), undefined),
		).toBeNull();
	});

	it('states the problem where the parser read other bytes', () => {
		expect(
			parameterTextProblem(parameterOf('X-A;X-P=one:two'), 'other'),
		).toContain('the parser read');
	});
});

describe('the place where the value of the property starts', () => {
	it('states no problem for a line that carries no parameter', () => {
		expect(valueStartProblem('X-A:one', lineOf('X-A:one'), {})).toBeNull();
	});

	it('states no problem where the parser reports no value for the parameter', () => {
		const line = 'X-A;X-P=one:two';
		expect(valueStartProblem(line, lineOf(line), {})).toBeNull();
	});

	it('states no problem where the two readings find the same colon', () => {
		const line = 'X-A;MEMBER="mailto:a@b.c","mailto:d@e.f":v';
		expect(
			valueStartProblem(line, lineOf(line), {
				member: ['mailto:a@b.c', 'mailto:d@e.f'],
			}),
		).toBeNull();
	});

	it('states the problem where a colon stands in the text that the library does not count', () => {
		const line = 'X-A;MEMBER="a","b:c":v';
		expect(
			valueStartProblem(line, lineOf(line), { member: ['a', 'b:c'] }),
		).toBe(
			'carries the parameter MEMBER, and the library does not count "b:c" at the end of that parameter; the library reads the colon in that text as the start of the value',
		);
	});

	it('reads every parameter of the line and not the last one alone', () => {
		// The canonical serializer writes the parameters in the order of
		// their names, so MEMBER stands last in the canonical text of this
		// line. The line reaches no colon of its own, and its canonical text
		// does.
		const line = 'X-A;MEMBER="a","b:c";AAA=1:v';
		expect(
			valueStartProblem(line, lineOf(line), {
				member: ['a', 'b:c'],
				aaa: '1',
			}),
		).toContain('the parameter MEMBER');
	});

	it('reads the text of the VALUE parameter as the length that the parser counted', () => {
		const line = 'X-A;VALUE=TEXT:v';
		expect(valueStartProblem(line, lineOf(line), {})).toBeNull();
	});
});
