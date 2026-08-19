import { describe, expect, it } from 'vitest';
import { timezoneOffsetFixture } from '../../../test/harness/fixtures/timezone-offsets';
import { instantOfWall, offsetAt, stateAt } from './offsets';
import type { TimezoneRules } from './table';
import { timezoneRules } from './table';

function rulesOf(name: string): TimezoneRules {
	const rules = timezoneRules(name);
	if (rules === undefined) {
		throw new Error(`the table holds no zone named ${name}`);
	}
	return rules;
}

/** The seconds from the start of 1970 to a wall time, read as universal. */
function wall(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
): number {
	return Date.UTC(year, month - 1, day, hour, minute) / 1000;
}

describe('the offset lookup against the compiler of the release', () => {
	const fixture = timezoneOffsetFixture();

	it('covers every name that the table holds', () => {
		expect(fixture.length).toBe(598);
	});

	it.each(fixture)('gives the answers of $name', (zone) => {
		const rules = rulesOf(zone.name);
		for (const row of zone.rows) {
			const state = stateAt(rules, row.at);
			expect(
				{
					at: row.at,
					offset: state.offset,
					isDaylight: state.isDaylight,
					abbreviation: state.abbreviation,
				},
				`the table answers differently for ${zone.name} at ${String(row.at)}`,
			).toEqual({
				at: row.at,
				offset: row.offset,
				isDaylight: row.isDaylight,
				abbreviation: row.abbreviation,
			});
		}
	});
});

describe('the offset lookup at a change of the clock', () => {
	it('holds the offset before the change and after it', () => {
		const rules = rulesOf('America/New_York');
		// The clock of New York steps forward at 07:00 universal time on
		// the second Sunday of March.
		const change = Date.UTC(2023, 2, 12, 7) / 1000;
		expect(offsetAt(rules, change - 1)).toBe(-18000);
		expect(offsetAt(rules, change)).toBe(-14400);
	});

	it('keeps a zone with an offset of half an hour', () => {
		expect(offsetAt(rulesOf('Asia/Kolkata'), 1700000000)).toBe(19800);
	});

	it('keeps a zone with an offset of three quarters of an hour', () => {
		expect(offsetAt(rulesOf('Asia/Kathmandu'), 1700000000)).toBe(20700);
	});

	it('keeps a seasonal offset of half an hour', () => {
		const rules = rulesOf('Australia/Lord_Howe');
		const winter = offsetAt(rules, Date.UTC(2023, 5, 1) / 1000);
		const summer = offsetAt(rules, Date.UTC(2023, 11, 1) / 1000);
		expect(winter).toBe(37800);
		expect(summer).toBe(39600);
		expect(summer - winter).toBe(1800);
	});

	it('keeps the day that a zone lost at the date line', () => {
		// Samoa moved from the east of the date line to the west at the end
		// of 2011, and the offset stepped by a whole day.
		const rules = rulesOf('Pacific/Apia');
		const change = Date.UTC(2011, 11, 30, 10) / 1000;
		expect(offsetAt(rules, change - 1)).toBe(-36000);
		expect(offsetAt(rules, change)).toBe(50400);
	});

	it('gives the state of the start of 1970 for an earlier instant', () => {
		const rules = rulesOf('America/New_York');
		expect(stateAt(rules, -1).abbreviation).toBe(
			stateAt(rules, 0).abbreviation,
		);
	});
});

describe('the offset lookup after the last change that the table holds', () => {
	it('repeats the pair of a zone that repeats one', () => {
		const rules = rulesOf('America/New_York');
		// The pair states the second Sunday of March and the first Sunday
		// of November, at 02:00 on the local clock.
		expect(offsetAt(rules, Date.UTC(2098, 2, 9, 6, 59) / 1000)).toBe(
			-18000,
		);
		expect(offsetAt(rules, Date.UTC(2098, 2, 9, 7) / 1000)).toBe(-14400);
		expect(offsetAt(rules, Date.UTC(2098, 10, 2, 5, 59) / 1000)).toBe(
			-14400,
		);
		expect(offsetAt(rules, Date.UTC(2098, 10, 2, 6) / 1000)).toBe(-18000);
	});

	it('holds the last offset of a zone that repeats no pair', () => {
		const rules = rulesOf('Asia/Tokyo');
		expect(rules.terminal).toBeUndefined();
		expect(offsetAt(rules, Date.UTC(2099, 6, 1) / 1000)).toBe(32400);
	});

	it('repeats the pair of a zone in the south', () => {
		const rules = rulesOf('Pacific/Chatham');
		const winter = offsetAt(rules, Date.UTC(2090, 5, 1) / 1000);
		const summer = offsetAt(rules, Date.UTC(2090, 11, 1) / 1000);
		expect(winter).toBe(45900);
		expect(summer).toBe(49500);
	});
});

describe('a wall time that a change of the clock makes doubtful', () => {
	it('takes the earlier instant inside a gap', () => {
		const rules = rulesOf('America/New_York');
		// The clock steps from 02:00 to 03:00, so 02:30 never happens.
		const found = instantOfWall(rules, wall(2023, 3, 12, 2, 30));
		expect(found.resolution).toBe('gap');
		expect(found.instant).toBe(Date.UTC(2023, 2, 12, 6, 30) / 1000);
		expect(found.state.offset).toBe(-18000);
	});

	it('takes the later instant inside an overlap', () => {
		const rules = rulesOf('America/New_York');
		// The clock steps from 02:00 back to 01:00, so 01:30 happens two
		// times. The later instant is the second one.
		const found = instantOfWall(rules, wall(2023, 11, 5, 1, 30));
		expect(found.resolution).toBe('overlap');
		expect(found.instant).toBe(Date.UTC(2023, 10, 5, 6, 30) / 1000);
		expect(found.state.offset).toBe(-18000);
	});

	it('takes the one instant of a wall time that stands alone', () => {
		const rules = rulesOf('America/New_York');
		const found = instantOfWall(rules, wall(2023, 6, 15, 9, 0));
		expect(found.resolution).toBe('single');
		expect(found.instant).toBe(Date.UTC(2023, 5, 15, 13) / 1000);
		expect(found.state.offset).toBe(-14400);
	});

	it('takes the earlier instant inside a gap of half an hour', () => {
		const rules = rulesOf('Australia/Lord_Howe');
		const found = instantOfWall(rules, wall(2023, 10, 1, 2, 15));
		expect(found.resolution).toBe('gap');
		expect(found.state.offset).toBe(37800);
	});

	it('answers for a zone that makes no seasonal change', () => {
		const rules = rulesOf('Asia/Kolkata');
		const found = instantOfWall(rules, wall(2023, 6, 15, 9, 0));
		expect(found.resolution).toBe('single');
		expect(found.instant).toBe(Date.UTC(2023, 5, 15, 9) / 1000 - 19800);
	});

	it('gives back the wall time that its own answer states', () => {
		for (const name of [
			'America/New_York',
			'Europe/London',
			'Australia/Lord_Howe',
			'Pacific/Chatham',
			'Asia/Kolkata',
			'Africa/Casablanca',
		]) {
			const rules = rulesOf(name);
			for (let day = 1; day <= 28; day += 3) {
				for (const month of [1, 4, 7, 10]) {
					const asked = wall(2024, month, day, 12, 0);
					const found = instantOfWall(rules, asked);
					expect(
						found.instant + offsetAt(rules, found.instant),
						`${name} does not give back the wall time of the middle of the day`,
					).toBe(asked);
				}
			}
		}
	});
});
