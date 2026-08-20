import { describe, expect, it } from 'vitest';
import { timezoneOffsetFixture } from '../../../test/harness/fixtures/timezone-offsets';
import {
	TIMEZONE_TABLE_START,
	instantOfWall,
	offsetAt,
	stateAt,
} from './offsets';
import type { WallInstant } from './offsets';
import { civilSeconds, dayOfMonth } from './calendar';
import type { TerminalChange, TimezoneRules, TimezoneState } from './table';
import { timezoneNames, timezoneRules } from './table';

function rulesOf(name: string): TimezoneRules {
	const rules = timezoneRules(name);
	if (rules === undefined) {
		throw new Error(`the table holds no zone named ${name}`);
	}
	return rules;
}

/** The offset that the table gives, where the table covers the instant. */
function offsetOf(rules: TimezoneRules, instant: number): number {
	const found = offsetAt(rules, instant);
	if (!found.ok) {
		throw new Error(
			`the table refused the instant ${String(instant)}: ${found.failure}`,
		);
	}
	return found.offset;
}

/** The state that the table gives, where the table covers the instant. */
function stateOf(rules: TimezoneRules, instant: number): TimezoneState {
	const found = stateAt(rules, instant);
	if (!found.ok) {
		throw new Error(
			`the table refused the instant ${String(instant)}: ${found.failure}`,
		);
	}
	return found.state;
}

/** The answer for a wall time, where the table covers that time. */
function wallOf(rules: TimezoneRules, at: number): WallInstant {
	const found = instantOfWall(rules, at);
	if (!found.ok) {
		throw new Error(
			`the table refused the wall time ${String(at)}: ${found.failure}`,
		);
	}
	return found;
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
			const state = stateOf(rules, row.at);
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
		expect(offsetOf(rules, change - 1)).toBe(-18000);
		expect(offsetOf(rules, change)).toBe(-14400);
	});

	it('keeps a zone with an offset of half an hour', () => {
		expect(offsetOf(rulesOf('Asia/Kolkata'), 1700000000)).toBe(19800);
	});

	it('keeps a zone with an offset of three quarters of an hour', () => {
		expect(offsetOf(rulesOf('Asia/Kathmandu'), 1700000000)).toBe(20700);
	});

	it('keeps a seasonal offset of half an hour', () => {
		const rules = rulesOf('Australia/Lord_Howe');
		const winter = offsetOf(rules, Date.UTC(2023, 5, 1) / 1000);
		const summer = offsetOf(rules, Date.UTC(2023, 11, 1) / 1000);
		expect(winter).toBe(37800);
		expect(summer).toBe(39600);
		expect(summer - winter).toBe(1800);
	});

	it('keeps the day that a zone lost at the date line', () => {
		// Samoa moved from the east of the date line to the west at the end
		// of 2011, and the offset stepped by a whole day.
		const rules = rulesOf('Pacific/Apia');
		const change = Date.UTC(2011, 11, 30, 10) / 1000;
		expect(offsetOf(rules, change - 1)).toBe(-36000);
		expect(offsetOf(rules, change)).toBe(50400);
	});
});

describe('the offset lookup after the last change that the table holds', () => {
	it('repeats the pair of a zone that repeats one', () => {
		const rules = rulesOf('America/New_York');
		// The pair states the second Sunday of March and the first Sunday
		// of November, at 02:00 on the local clock.
		expect(offsetOf(rules, Date.UTC(2098, 2, 9, 6, 59) / 1000)).toBe(
			-18000,
		);
		expect(offsetOf(rules, Date.UTC(2098, 2, 9, 7) / 1000)).toBe(-14400);
		expect(offsetOf(rules, Date.UTC(2098, 10, 2, 5, 59) / 1000)).toBe(
			-14400,
		);
		expect(offsetOf(rules, Date.UTC(2098, 10, 2, 6) / 1000)).toBe(-18000);
	});

	it('holds the last offset of a zone that repeats no pair', () => {
		const rules = rulesOf('Asia/Tokyo');
		expect(rules.terminal).toBeUndefined();
		expect(offsetOf(rules, Date.UTC(2099, 6, 1) / 1000)).toBe(32400);
	});

	it('repeats the pair of a zone in the south', () => {
		const rules = rulesOf('Pacific/Chatham');
		const winter = offsetOf(rules, Date.UTC(2090, 5, 1) / 1000);
		const summer = offsetOf(rules, Date.UTC(2090, 11, 1) / 1000);
		expect(winter).toBe(45900);
		expect(summer).toBe(49500);
	});
});

describe('a wall time that a change of the clock makes doubtful', () => {
	it('takes the earlier instant inside a gap', () => {
		const rules = rulesOf('America/New_York');
		// The clock steps from 02:00 to 03:00, so 02:30 never happens.
		const found = wallOf(rules, wall(2023, 3, 12, 2, 30));
		expect(found.resolution).toBe('gap');
		expect(found.instant).toBe(Date.UTC(2023, 2, 12, 6, 30) / 1000);
		expect(found.state.offset).toBe(-18000);
	});

	it('takes the later instant inside an overlap', () => {
		const rules = rulesOf('America/New_York');
		// The clock steps from 02:00 back to 01:00, so 01:30 happens two
		// times. The later instant is the second one.
		const found = wallOf(rules, wall(2023, 11, 5, 1, 30));
		expect(found.resolution).toBe('overlap');
		expect(found.instant).toBe(Date.UTC(2023, 10, 5, 6, 30) / 1000);
		expect(found.state.offset).toBe(-18000);
	});

	it('takes the one instant of a wall time that stands alone', () => {
		const rules = rulesOf('America/New_York');
		const found = wallOf(rules, wall(2023, 6, 15, 9, 0));
		expect(found.resolution).toBe('single');
		expect(found.instant).toBe(Date.UTC(2023, 5, 15, 13) / 1000);
		expect(found.state.offset).toBe(-14400);
	});

	it('takes the earlier instant inside a gap of half an hour', () => {
		const rules = rulesOf('Australia/Lord_Howe');
		const found = wallOf(rules, wall(2023, 10, 1, 2, 15));
		expect(found.resolution).toBe('gap');
		expect(found.state.offset).toBe(37800);
	});

	it('answers for a zone that makes no seasonal change', () => {
		const rules = rulesOf('Asia/Kolkata');
		const found = wallOf(rules, wall(2023, 6, 15, 9, 0));
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
					const found = wallOf(rules, asked);
					expect(
						found.instant + offsetOf(rules, found.instant),
						`${name} does not give back the wall time of the middle of the day`,
					).toBe(asked);
				}
			}
		}
	});
});

describe('an instant that stands before the table', () => {
	it('refuses the state', () => {
		const rules = rulesOf('America/New_York');
		expect(stateAt(rules, -1)).toEqual({
			ok: false,
			failure: 'beforeTable',
		});
	});

	it('refuses the offset', () => {
		const rules = rulesOf('America/New_York');
		expect(offsetAt(rules, -1)).toEqual({
			ok: false,
			failure: 'beforeTable',
		});
	});

	it('refuses a summer of 1965 instead of naming the winter offset', () => {
		// The clock of New York ran one hour ahead in the summer of 1965.
		// The table starts in 1970 and states nothing about that summer, so
		// the answer is a refusal and never the offset of the winter.
		const rules = rulesOf('America/New_York');
		const summer = Date.UTC(1965, 6, 4, 12) / 1000;
		expect(offsetAt(rules, summer).ok).toBe(false);
	});

	it('refuses a wall time that names an earlier instant', () => {
		const rules = rulesOf('America/New_York');
		expect(instantOfWall(rules, wall(1965, 7, 4, 12, 0))).toEqual({
			ok: false,
			failure: 'beforeTable',
		});
	});

	it('takes the first instant that the table covers', () => {
		const rules = rulesOf('America/New_York');
		expect(offsetAt(rules, TIMEZONE_TABLE_START).ok).toBe(true);
		expect(offsetAt(rules, TIMEZONE_TABLE_START - 1).ok).toBe(false);
	});

	it('refuses a wall time whose zone puts it before the table', () => {
		// The start of 1970 on the wall clock of Tokyo stands nine hours
		// before the start of 1970 in universal time.
		const rules = rulesOf('Asia/Tokyo');
		expect(instantOfWall(rules, wall(1970, 1, 1, 0, 0)).ok).toBe(false);
		expect(instantOfWall(rules, wall(1970, 1, 1, 9, 0)).ok).toBe(true);
	});
});

describe('the window that the search for a wall time reads', () => {
	const WINDOW = 52 * 3600;

	/**
	 * The instant of one change of a repeating pair, in the given year.
	 * This repeats the arithmetic that the lookup applies, so that the
	 * walk below reaches the years that the committed changes do not hold.
	 */
	function terminalInstant(
		change: TerminalChange,
		year: number,
		offsetBefore: number,
	): number {
		return (
			civilSeconds(
				year,
				change.month,
				dayOfMonth(year, change.month, change.day),
			) +
			change.wallSeconds -
			offsetBefore
		);
	}

	/** Every change of one zone, from 1970 into the repeating years. */
	function walk(name: string): readonly number[] {
		const rules = timezoneRules(name);
		if (rules === undefined) {
			return [];
		}
		const instants = rules.changes.map((change) => change.at);
		const terminal = rules.terminal;
		if (terminal !== undefined) {
			const last = instants[instants.length - 1] ?? 0;
			const from = new Date(last * 1000).getUTCFullYear();
			for (let year = from; year <= from + 8; year += 1) {
				const pair = [
					terminalInstant(
						terminal.start,
						year,
						terminal.standard.offset,
					),
					terminalInstant(
						terminal.end,
						year,
						terminal.daylight.offset,
					),
				].sort((left, right) => left - right);
				for (const at of pair) {
					if (at > last) {
						instants.push(at);
					}
				}
			}
		}
		return instants;
	}

	it('holds every zone of the table to one change in 52 hours', () => {
		// The search reads the offset at each end of a window of 52 hours
		// and reads no instant inside it. A zone that changed its offset
		// two times inside that window would break the search. The walk
		// covers the changes that the table holds and then eight years of
		// the repeating pair, so it also covers the step from the last
		// change of a zone into the years that the pair states.
		const tooClose: string[] = [];
		let closest = Number.POSITIVE_INFINITY;
		for (const name of timezoneNames()) {
			const instants = walk(name);
			for (let index = 1; index < instants.length; index += 1) {
				const gap = (instants[index] ?? 0) - (instants[index - 1] ?? 0);
				closest = Math.min(closest, gap);
				if (gap < WINDOW) {
					tooClose.push(`${name} at ${String(instants[index])}`);
				}
			}
		}
		expect(tooClose).toEqual([]);
		// The margin is wide. On this release the closest pair stands 166
		// hours apart, at America/Cambridge_Bay in 2000. The step from the
		// last change of a zone into the repeating years is 1033 hours at
		// its closest, and two changes of one repeating pair stand 3024
		// hours apart at their closest. A release that narrowed any of the
		// three would show here before it reached the search.
		expect(closest).toBeGreaterThan(3 * WINDOW);
	});
});
