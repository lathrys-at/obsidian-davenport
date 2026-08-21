import { describe, expect, it } from 'vitest';
import type { Duration } from './duration';
import { durationSeconds, icsDuration, parseDuration } from './duration';

const NOTHING: Duration = {
	negative: false,
	weeks: 0,
	days: 0,
	hours: 0,
	minutes: 0,
	seconds: 0,
};

/** The length that the parser reads out of a text. */
function read(text: string): Duration {
	const result = parseDuration(text);
	if (!result.ok) {
		throw new Error(`the parser refused ${text}`);
	}
	return result.value;
}

/** The form of the calendar format for a text that the parser reads. */
function emit(text: string): string {
	return icsDuration(read(text));
}

describe('the short form of a length of time', () => {
	it.each([
		['1s', { seconds: 1 }],
		['1m', { minutes: 1 }],
		['1h', { hours: 1 }],
		['1d', { days: 1 }],
		['1w', { weeks: 1 }],
		['0s', {}],
		['999999999s', { seconds: 999999999 }],
		['1w2d3h4m5s', { weeks: 1, days: 2, hours: 3, minutes: 4, seconds: 5 }],
		['1h30m', { hours: 1, minutes: 30 }],
	])('reads %s as the units that the note wrote', (text, counts) => {
		expect(read(text)).toEqual({ ...NOTHING, ...counts });
	});

	it('reads the sign of a value that stands before its time', () => {
		expect(read('-15m')).toEqual({
			...NOTHING,
			negative: true,
			minutes: 15,
		});
	});

	it('reads a value with no sign as a value after its time', () => {
		expect(read('15m')).toEqual({ ...NOTHING, minutes: 15 });
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

describe('the length in seconds', () => {
	it.each([
		['1s', 1],
		['1m', 60],
		['1h', 3600],
		['1d', 86400],
		['24h', 86400],
		['1440m', 86400],
		['1w', 604800],
		['0s', 0],
		['1w2d3h4m5s', 788645],
	])('gives %s as %i seconds', (text, expected) => {
		expect(durationSeconds(read(text))).toBe(expected);
	});

	it('leaves the sign out of the count of seconds', () => {
		expect(durationSeconds(read('-15m'))).toBe(900);
	});
});

// The two formats hold two kinds of length. A day and a week are nominal,
// and an hour, a minute and a second are exact. The pairs below state the
// same count of seconds and different lengths, so the writer must keep the
// two apart.
describe('the form of a length of time in the calendar format', () => {
	it.each([
		['1d', 'P1D'],
		['24h', 'PT24H'],
		['1440m', 'PT1440M'],
		['86400s', 'PT86400S'],
		['1w', 'P1W'],
		['168h', 'PT168H'],
		['7d', 'P7D'],
	])('writes %s as %s, and never as another unit', (text, expected) => {
		expect(emit(text)).toBe(expected);
	});

	it.each([
		['30m', 'PT30M'],
		['1h30m', 'PT1H30M'],
		['45s', 'PT45S'],
		['2d3h', 'P2DT3H'],
		['1w2d3h4m5s', 'P9DT3H4M5S'],
		['1w1h', 'P7DT1H'],
		['0s', 'PT0S'],
		['0m', 'PT0S'],
	])('writes %s as %s', (text, expected) => {
		expect(emit(text)).toBe(expected);
	});

	it.each([
		['-15m', '-PT15M'],
		['-1d', '-P1D'],
		['-1w', '-P1W'],
		['-0s', '-PT0S'],
	])('writes %s before the time as %s', (text, expected) => {
		expect(emit(text)).toBe(expected);
	});

	it('writes seven days for a week that stands with another part', () => {
		expect(emit('1w2d')).toBe('P9D');
		expect(emit('1w')).toBe('P1W');
	});
});
