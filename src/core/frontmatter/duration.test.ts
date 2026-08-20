import { describe, expect, it } from 'vitest';
import { icsDuration, parseDuration } from './duration';

/** The length in seconds, for a text that the parser reads. */
function seconds(text: string): number {
	const result = parseDuration(text);
	if (!result.ok) {
		throw new Error(`the parser refused ${text}`);
	}
	return result.value.seconds;
}

describe('the short form of a length of time', () => {
	it.each([
		['1s', 1],
		['1m', 60],
		['1h', 3600],
		['1d', 86400],
		['1w', 604800],
		['0s', 0],
		['999999999s', 999999999],
	])('reads %s as %i seconds', (text, expected) => {
		expect(seconds(text)).toBe(expected);
	});

	it('reads the sign of a value that stands before its time', () => {
		expect(parseDuration('-15m')).toEqual({
			ok: true,
			value: { seconds: 900, negative: true },
		});
	});

	it('reads a value with no sign as a value after its time', () => {
		expect(parseDuration('15m')).toEqual({
			ok: true,
			value: { seconds: 900, negative: false },
		});
	});

	it.each([
		['', { kind: 'empty' }],
		['+', { kind: 'empty' }],
		['12', { kind: 'no-unit', count: '12' }],
		['1h30', { kind: 'no-unit', count: '30' }],
		['5y', { kind: 'unknown-unit', text: 'y' }],
		['1h.5m', { kind: 'unknown-unit', text: '.' }],
		['m30', { kind: 'no-count', unit: 'm' }],
		['1h-30m', { kind: 'unknown-unit', text: '-' }],
		['1m1m', { kind: 'repeated-unit', unit: 'm' }],
		['1h2h', { kind: 'repeated-unit', unit: 'h' }],
		['30m1h', { kind: 'unit-order', unit: 'h', after: 'm' }],
		['1s1w', { kind: 'unit-order', unit: 'w', after: 's' }],
		['1000000000s', { kind: 'too-large', count: '1000000000' }],
	])('refuses %s and states where the fault is', (text, failure) => {
		expect(parseDuration(text)).toEqual({ ok: false, failure });
	});

	it('refuses a unit that stands with no count, and names that unit', () => {
		expect(parseDuration('h')).toEqual({
			ok: false,
			failure: { kind: 'no-count', unit: 'h' },
		});
	});
});

describe('the form of a length of time in the calendar format', () => {
	it.each([
		[0, 'PT0S'],
		[1, 'PT1S'],
		[60, 'PT1M'],
		[3600, 'PT1H'],
		[5400, 'PT1H30M'],
		[86400, 'P1D'],
		[90000, 'P1DT1H'],
		[604800, 'P7D'],
		[788645, 'P9DT3H4M5S'],
		[59, 'PT59S'],
		[86401, 'P1DT1S'],
	])('writes %i seconds as %s', (value, expected) => {
		expect(icsDuration({ seconds: value, negative: false })).toBe(expected);
	});

	it.each([
		[900, '-PT15M'],
		[86400, '-P1D'],
		[0, '-PT0S'],
	])('writes %i seconds before the time as %s', (value, expected) => {
		expect(icsDuration({ seconds: value, negative: true })).toBe(expected);
	});

	it('writes a week as seven days, because the format takes no other part beside a week', () => {
		expect(icsDuration({ seconds: seconds('1w'), negative: false })).toBe(
			'P7D',
		);
		expect(icsDuration({ seconds: seconds('1w1h'), negative: false })).toBe(
			'P7DT1H',
		);
	});
});
