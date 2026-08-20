import { describe, expect, it } from 'vitest';
import {
	TIMEZONE_TABLE_RELEASE,
	isTimezoneName,
	readTimezoneTable,
	timezoneNames,
	timezoneRules,
} from './table';

describe('the bundled timezone table', () => {
	it('states the release that it comes from', () => {
		expect(TIMEZONE_TABLE_RELEASE).toBe('2026c');
	});

	it('holds every identifier of the release', () => {
		expect(timezoneNames().length).toBe(598);
	});

	it('holds the identifiers in order', () => {
		const names = timezoneNames();
		expect([...names].sort()).toEqual([...names]);
	});

	it('holds no identifier two times', () => {
		expect(new Set(timezoneNames()).size).toBe(timezoneNames().length);
	});

	it('states no rules for a name that it does not hold', () => {
		expect(timezoneRules('Mars/Olympus_Mons')).toBeUndefined();
		expect(isTimezoneName('Mars/Olympus_Mons')).toBe(false);
	});

	it('decodes every identifier that it holds', () => {
		for (const name of timezoneNames()) {
			const rules = timezoneRules(name);
			expect(rules, `the table does not decode ${name}`).toBeDefined();
			expect(rules?.initial.offset).toBeTypeOf('number');
		}
	});

	it('keeps the name that the caller asked for', () => {
		expect(timezoneRules('Asia/Calcutta')?.name).toBe('Asia/Calcutta');
		expect(timezoneRules('Asia/Kolkata')?.name).toBe('Asia/Kolkata');
		expect(timezoneRules('America/Indianapolis')?.name).toBe(
			'America/Indianapolis',
		);
	});

	it('gives one set of rules to two names of one zone', () => {
		const written = timezoneRules('Asia/Calcutta');
		const current = timezoneRules('Asia/Kolkata');
		expect(written?.initial).toEqual(current?.initial);
		expect(written?.changes).toEqual(current?.changes);
	});

	it('gives the same value at every request for one name', () => {
		expect(timezoneRules('Europe/Berlin')).toBe(
			timezoneRules('Europe/Berlin'),
		);
	});

	it('states a repeating pair for a zone that repeats one', () => {
		expect(timezoneRules('America/New_York')?.terminal).toBeDefined();
	});

	it('states no repeating pair for a zone that repeats none', () => {
		expect(timezoneRules('Asia/Tokyo')?.terminal).toBeUndefined();
	});

	it('holds a change that does not fall on a whole minute', () => {
		const changes = timezoneRules('Africa/Monrovia')?.changes ?? [];
		expect(changes.some((change) => change.at % 60 !== 0)).toBe(true);
	});
});

describe('a table that is damaged', () => {
	it('refuses a line with no name', () => {
		expect(() => readTimezoneTable('Zone/One')).toThrow(/no name/);
	});

	it('refuses a name that points at a name it does not hold', () => {
		const table = readTimezoneTable('Zone/One=Zone/Two\n');
		expect(() => table.rules('Zone/One')).toThrow(/holds no rules/);
	});

	it('refuses a name that points at another name that points on', () => {
		const table = readTimezoneTable(
			'Zone/One=Zone/Two\nZone/Two=Zone/Three\nZone/Three|0,0,GMT|0||-\n',
		);
		expect(() => table.rules('Zone/One')).toThrow(/holds no rules/);
	});

	it('refuses a line with the wrong count of parts', () => {
		const table = readTimezoneTable('Zone/One|0,0,GMT|0|\n');
		expect(() => table.rules('Zone/One')).toThrow(/damaged line/);
	});

	it('refuses a state with the wrong count of parts', () => {
		const table = readTimezoneTable('Zone/One|0,0|0||-\n');
		expect(() => table.rules('Zone/One')).toThrow(/damaged state/);
	});

	it('refuses a place that names no state', () => {
		const table = readTimezoneTable('Zone/One|0,0,GMT|4||-\n');
		expect(() => table.rules('Zone/One')).toThrow(/does not hold/);
	});

	it('refuses a repeating pair with the wrong count of parts', () => {
		const table = readTimezoneTable('Zone/One|0,0,GMT|0||0,0\n');
		expect(() => table.rules('Zone/One')).toThrow(/damaged repeating pair/);
	});

	it('refuses a repeating change with the wrong count of parts', () => {
		const table = readTimezoneTable(
			'Zone/One|0,0,GMT|0||0,0,3:l0,10:l0:7200\n',
		);
		expect(() => table.rules('Zone/One')).toThrow(
			/damaged repeating change/,
		);
	});

	it('reads the name of a line that holds both marks', () => {
		// The name of a line ends at the first of the two marks, whichever
		// of them stands first.
		const table = readTimezoneTable('Zone/One|0,0,G=T|0||-\n');
		expect(table.names()).toEqual(['Zone/One']);
		expect(table.rules('Zone/One')?.initial.abbreviation).toBe('G=T');
	});

	it('refuses an offset that is not a whole number', () => {
		const table = readTimezoneTable('Zone/One|xx,0,UTC|0||-\n');
		expect(() => table.rules('Zone/One')).toThrow(/not a whole number/);
	});

	it('refuses a count of minutes that holds a character it cannot read', () => {
		const table = readTimezoneTable(
			'Zone/One|0,0,ONE;3600,1,TWO|0|zz$$,1|-\n',
		);
		expect(() => table.rules('Zone/One')).toThrow(
			/damaged count of minutes/,
		);
	});

	it('refuses a count of minutes that states a sign', () => {
		const table = readTimezoneTable(
			'Zone/One|0,0,ONE;3600,1,TWO|0|-5,1|-\n',
		);
		expect(() => table.rules('Zone/One')).toThrow(
			/damaged count of minutes/,
		);
	});

	it('refuses a change that does not run forward', () => {
		const table = readTimezoneTable(
			'Zone/One|0,0,ONE;3600,1,TWO|0|0,1|-\n',
		);
		expect(() => table.rules('Zone/One')).toThrow(/does not run forward/);
	});

	it('refuses a count of seconds that a minute does not hold', () => {
		const table = readTimezoneTable(
			'Zone/One|0,0,ONE;3600,1,TWO|0|z.90,1|-\n',
		);
		expect(() => table.rules('Zone/One')).toThrow(/outside a minute/);
	});

	it('refuses a time of day that is not a whole number', () => {
		const table = readTimezoneTable(
			'Zone/One|0,0,ONE;3600,1,TWO|0||0,1,3:l0:zz,10:l0:7200\n',
		);
		expect(() => table.rules('Zone/One')).toThrow(/not a whole number/);
	});

	it('refuses a month outside the year', () => {
		const table = readTimezoneTable(
			'Zone/One|0,0,ONE;3600,1,TWO|0||0,1,13:l0:7200,10:l0:7200\n',
		);
		expect(() => table.rules('Zone/One')).toThrow(/outside the year/);
	});

	it('refuses a day below the first of the month', () => {
		const table = readTimezoneTable(
			'Zone/One|0,0,ONE;3600,1,TWO|0||0,1,3:d-5:7200,10:l0:7200\n',
		);
		expect(() => table.rules('Zone/One')).toThrow(/outside the month/);
	});

	it('refuses a day past the last of the month', () => {
		const table = readTimezoneTable(
			'Zone/One|0,0,ONE;3600,1,TWO|0||0,1,3:d99:7200,10:l0:7200\n',
		);
		expect(() => table.rules('Zone/One')).toThrow(/outside the month/);
	});

	it('refuses such a day in the form that names a weekday', () => {
		const table = readTimezoneTable(
			'Zone/One|0,0,ONE;3600,1,TWO|0||0,1,3:a0.99:7200,10:l0:7200\n',
		);
		expect(() => table.rules('Zone/One')).toThrow(/outside the month/);
	});

	it('refuses a time of day past what the format can hold', () => {
		const table = readTimezoneTable(
			'Zone/One|0,0,ONE;3600,1,TWO|0||0,1,3:l0:999999,10:l0:7200\n',
		);
		expect(() => table.rules('Zone/One')).toThrow(/outside the day/);
	});

	it('refuses a time of day below what the format can hold', () => {
		const table = readTimezoneTable(
			'Zone/One|0,0,ONE;3600,1,TWO|0||0,1,3:l0:-999999,10:l0:7200\n',
		);
		expect(() => table.rules('Zone/One')).toThrow(/outside the day/);
	});

	it('refuses a weekday outside the week', () => {
		const table = readTimezoneTable(
			'Zone/One|0,0,ONE;3600,1,TWO|0||0,1,3:l9:7200,10:l0:7200\n',
		);
		expect(() => table.rules('Zone/One')).toThrow(/outside the week/);
	});

	it('refuses one name that stands on two lines', () => {
		expect(() =>
			readTimezoneTable('Zone/One|0,0,GMT|0||-\nZone/One|0,0,UTC|0||-\n'),
		).toThrow(/two times/);
	});

	it('refuses a day that it does not know', () => {
		const table = readTimezoneTable(
			'Zone/One|0,0,GMT|0||0,0,3:q9:7200,10:l0:7200\n',
		);
		expect(() => table.rules('Zone/One')).toThrow(/damaged day/);
	});
});

describe('a table that a test states', () => {
	it('reads a zone that makes no change', () => {
		const table = readTimezoneTable('Zone/Flat|3600,0,ONE|0||-\n');
		expect(table.rules('Zone/Flat')).toEqual({
			name: 'Zone/Flat',
			initial: { offset: 3600, isDaylight: false, abbreviation: 'ONE' },
			changes: [],
			terminal: undefined,
		});
	});

	it('reads the count of minutes of a change in base 36', () => {
		const table = readTimezoneTable(
			'Zone/Step|0,0,ONE;3600,1,TWO|0|z,1|-\n',
		);
		expect(table.rules('Zone/Step')?.changes).toEqual([
			{
				at: 35 * 60,
				state: { offset: 3600, isDaylight: true, abbreviation: 'TWO' },
			},
		]);
	});

	it('reads the seconds of a change that no whole minute holds', () => {
		const table = readTimezoneTable(
			'Zone/Step|0,0,ONE;3600,1,TWO|0|z.7,1|-\n',
		);
		expect(table.rules('Zone/Step')?.changes[0]?.at).toBe(35 * 60 + 7);
	});

	it('takes the times of day that the release itself holds', () => {
		// The release states one change on the universal clock in a zone
		// that stands behind it, which gives a time below the start of the
		// day. It states another at the end of a day. Both are legal and
		// the bounds must not refuse them.
		for (const time of ['-7200', '0', '86400']) {
			const table = readTimezoneTable(
				`Zone/One|0,0,ONE;3600,1,TWO|0||0,1,3:l0:${time},10:l0:7200\n`,
			);
			expect(
				table.rules('Zone/One')?.terminal?.start.wallSeconds,
				`the reader refuses the time of day ${time}`,
			).toBe(Number(time));
		}
	});

	it('takes the last day of a month', () => {
		const table = readTimezoneTable(
			'Zone/One|0,0,ONE;3600,1,TWO|0||0,1,3:d31:7200,10:l0:7200\n',
		);
		expect(table.rules('Zone/One')?.terminal?.start.day).toEqual({
			kind: 'fixed',
			day: 31,
		});
	});

	it('reads each of the four forms of a day', () => {
		const forms = [
			['d9', { kind: 'fixed', day: 9 }],
			['l3', { kind: 'last', weekday: 3 }],
			['a0.8', { kind: 'onOrAfter', weekday: 0, day: 8 }],
			['b6.30', { kind: 'onOrBefore', weekday: 6, day: 30 }],
		] as const;
		for (const [text, expected] of forms) {
			const table = readTimezoneTable(
				`Zone/Day|0,0,ONE;3600,1,TWO|0||0,1,3:${text}:7200,10:l0:7200\n`,
			);
			expect(table.rules('Zone/Day')?.terminal?.start.day).toEqual(
				expected,
			);
		}
	});
});
