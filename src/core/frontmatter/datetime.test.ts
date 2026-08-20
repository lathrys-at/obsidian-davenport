import { describe, expect, it } from 'vitest';
import { MIN_YEAR, parseIsoValue } from './datetime';

describe('the forms of a day and of a day with a time of day', () => {
	it('refuses a text with no character in it', () => {
		expect(parseIsoValue('')).toEqual({
			ok: false,
			failure: { kind: 'empty' },
		});
	});

	it('reads a day', () => {
		expect(parseIsoValue('2026-03-14')).toEqual({
			ok: true,
			value: { kind: 'date', date: { year: 2026, month: 3, day: 14 } },
		});
	});

	it('reads the first year that the plugin takes', () => {
		expect(parseIsoValue(`${String(MIN_YEAR)}-01-01`)).toMatchObject({
			ok: true,
		});
	});

	it('refuses the year before the first year that the plugin takes', () => {
		expect(parseIsoValue(`0${String(MIN_YEAR - 1)}-01-01`)).toEqual({
			ok: false,
			failure: { kind: 'year-range', year: MIN_YEAR - 1 },
		});
	});

	it('refuses a year of two digits, which a reader could take for another year', () => {
		expect(parseIsoValue('0050-01-01')).toEqual({
			ok: false,
			failure: { kind: 'year-range', year: 50 },
		});
	});

	it.each([
		['2026-01-31', 31],
		['2026-02-28', 28],
		['2028-02-29', 29],
		['2000-02-29', 29],
		['2026-04-30', 30],
	])('reads the last day %s of its month', (text, day) => {
		expect(parseIsoValue(text)).toMatchObject({
			ok: true,
			value: { date: { day } },
		});
	});

	it.each(['2026-02-29', '2100-02-29', '2026-04-31', '2026-06-31'])(
		'refuses the day %s, which its month does not hold',
		(text) => {
			expect(parseIsoValue(text)).toEqual({
				ok: false,
				failure: { kind: 'no-such-day', date: dateOf(text) },
			});
		},
	);

	it('reads the greatest time of day that a clock states', () => {
		expect(parseIsoValue('2026-03-14T23:59:59')).toMatchObject({
			ok: true,
			value: { time: { hour: 23, minute: 59, second: 59 } },
		});
	});

	it('reads an offset of zero with a minus sign as universal time', () => {
		const result = parseIsoValue('2026-03-14T09:00:00-00:00');
		expect(result).toMatchObject({ ok: true, value: { offsetSeconds: 0 } });
		expect(Object.is(offsetOf(result), -0)).toBe(false);
	});

	it.each([
		['2026-03-14T09:00:00+23:59', 86340],
		['2026-03-14T09:00:00-23:59', -86340],
	])('reads the offset of %s', (text, offsetSeconds) => {
		expect(parseIsoValue(text)).toMatchObject({
			ok: true,
			value: { offsetSeconds },
		});
	});
});

function dateOf(text: string): {
	year: number;
	month: number;
	day: number;
} {
	return {
		year: Number(text.slice(0, 4)),
		month: Number(text.slice(5, 7)),
		day: Number(text.slice(8, 10)),
	};
}

function offsetOf(result: ReturnType<typeof parseIsoValue>): number | null {
	if (!result.ok || result.value.kind !== 'date-time') {
		throw new Error('the text states no time of day');
	}
	return result.value.offsetSeconds;
}
