/**
 * The generator of the timezone table.
 *
 * The plugin ships a table of timezone rules, and a generator writes that
 * table from one release of the timezone database. The release sits in
 * the repository under `tools/timezone-table/vendor/`, so the generator
 * needs no network and any person can run it again and compare.
 *
 * These tests hold three promises.
 *
 * - The vendored files are the files of the pinned release. The checksum
 *   of every one of them agrees with the pin.
 * - The generator over those files writes the table that the repository
 *   ships, byte for byte. A change to the generator that nobody meant
 *   therefore fails here, and so does an edit of the generated file.
 * - The generator reads its input and refuses what it does not
 *   understand.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeTable, tableNames } from '../tools/timezone-table/encode';
import { expandZone, expandZones } from '../tools/timezone-table/expand';
import { tableModule } from '../tools/timezone-table/module';
import { parseTimezoneSource } from '../tools/timezone-table/source';

const ROOT = join(import.meta.dirname, '..');
const VENDOR = join(ROOT, 'tools', 'timezone-table', 'vendor');
const TABLE_MODULE = join(ROOT, 'src', 'core', 'timezone', 'table-data.ts');

interface Pin {
	readonly release: string;
	readonly form: string;
	readonly archive: { readonly name: string; readonly sha256: string };
	readonly data: readonly string[];
	readonly files: Readonly<Record<string, string>>;
}

const pin = JSON.parse(
	readFileSync(join(ROOT, 'tools', 'timezone-table', 'pin.json'), 'utf8'),
) as Pin;

function vendored(name: string): string {
	return readFileSync(join(VENDOR, name), 'utf8');
}

function generate(): string {
	const source = parseTimezoneSource(
		pin.data.map((name) => ({ name, text: vendored(name) })),
	);
	return tableModule(
		pin.release,
		encodeTable(expandZones(source), tableNames(source)),
	);
}

describe('the pin of the timezone release', () => {
	it('names the main form of the data', () => {
		// The release also ships a rearguard form, which states a negative
		// seasonal offset in another way. The two forms disagree about the
		// zones that run a negative seasonal offset.
		expect(pin.form).toBe('main');
	});

	it('agrees with the release that the vendored files state', () => {
		expect(vendored('version').trim()).toBe(pin.release);
	});

	it('holds the checksum of every vendored file', () => {
		for (const [name, expected] of Object.entries(pin.files)) {
			const found = createHash('sha256')
				.update(readFileSync(join(VENDOR, name)))
				.digest('hex');
			expect(found, `vendor/${name} does not agree with the pin`).toBe(
				expected,
			);
		}
	});

	it('names every file that the generator reads', () => {
		for (const name of pin.data) {
			expect(Object.keys(pin.files)).toContain(name);
		}
	});

	it('carries the notice of the release', () => {
		expect(vendored('LICENSE')).toContain('public domain');
	});
});

describe('the generator over the vendored release', () => {
	it('writes the table that the repository ships', () => {
		expect(
			generate(),
			'the generator writes a different table from the one in the tree. Run node tools/timezone-table/generate.mjs and commit the result.',
		).toBe(readFileSync(TABLE_MODULE, 'utf8'));
	});

	it('writes the same bytes at every run', () => {
		expect(generate()).toBe(generate());
	});

	it('reads every zone and every link of the release', () => {
		const source = parseTimezoneSource(
			pin.data.map((name) => ({ name, text: vendored(name) })),
		);
		expect(source.zones.length).toBe(341);
		expect(source.links.length).toBe(257);
		expect(source.zones.length + source.links.length).toBe(598);
	});

	it('gives every zone a state at the start of 1970', () => {
		const source = parseTimezoneSource(
			pin.data.map((name) => ({ name, text: vendored(name) })),
		);
		for (const zone of expandZones(source)) {
			expect(
				zone.initial.abbreviation.length,
				`${zone.name} states no abbreviation at the start of 1970`,
			).toBeGreaterThan(0);
		}
	});

	it('states the changes of every zone in order', () => {
		const source = parseTimezoneSource(
			pin.data.map((name) => ({ name, text: vendored(name) })),
		);
		for (const zone of expandZones(source)) {
			let previous = 0;
			for (const change of zone.changes) {
				expect(
					change.at,
					`${zone.name} states a change out of order`,
				).toBeGreaterThan(previous);
				previous = change.at;
			}
		}
	});
});

describe('the reader of the release', () => {
	const source = (text: string) =>
		parseTimezoneSource([{ name: 'test', text }]);

	it('reads a zone with one line', () => {
		const read = source('Zone\tTest/One\t1:00\t-\tCET\n');
		expect(read.zones).toEqual([
			{
				name: 'Test/One',
				lines: [
					{
						standardOffset: 3600,
						rules: { kind: 'standard' },
						format: 'CET',
						until: undefined,
					},
				],
			},
		]);
	});

	it('reads a zone that continues over more lines', () => {
		const read = source(
			'Zone\tTest/Two\t1:00\t-\tA\t1980 Mar 3 2:00\n\t\t2:00\t-\tB\n',
		);
		expect(read.zones[0]?.lines.length).toBe(2);
		expect(read.zones[0]?.lines[1]?.until).toBeUndefined();
	});

	it('reads a rule that repeats with no last year', () => {
		const read = source(
			'Rule\tTest\t1990\tmax\t-\tMar\tlastSun\t2:00s\t1:00\tD\n',
		);
		expect(read.rules.get('Test')?.[0]).toEqual({
			name: 'Test',
			firstYear: 1990,
			lastYear: 9999,
			month: 3,
			day: { kind: 'last', weekday: 0 },
			at: { seconds: 7200, base: 'standard' },
			save: 3600,
			letters: 'D',
		});
	});

	it('reads a rule that runs in one year only', () => {
		const read = source('Rule\tTest\t1990\tonly\t-\tMar\t8\t2:00\t0\t-\n');
		const rule = read.rules.get('Test')?.[0];
		expect(rule?.firstYear).toBe(1990);
		expect(rule?.lastYear).toBe(1990);
		expect(rule?.day).toEqual({ kind: 'fixed', day: 8 });
		expect(rule?.letters).toBe('');
	});

	it('reads each of the marks that name a clock', () => {
		const marks: readonly [string, string][] = [
			['2:00', 'wall'],
			['2:00w', 'wall'],
			['2:00s', 'standard'],
			['2:00u', 'universal'],
			['2:00g', 'universal'],
			['2:00z', 'universal'],
		];
		for (const [text, base] of marks) {
			const read = source(
				`Rule\tTest\t1990\tonly\t-\tMar\t8\t${text}\t0\t-\n`,
			);
			expect(read.rules.get('Test')?.[0]?.at.base).toBe(base);
		}
	});

	it('reads a day that a comparison states', () => {
		const after = source(
			'Rule\tTest\t1990\tonly\t-\tMar\tSun>=8\t2:00\t0\t-\n',
		);
		expect(after.rules.get('Test')?.[0]?.day).toEqual({
			kind: 'onOrAfter',
			weekday: 0,
			day: 8,
		});
		const before = source(
			'Rule\tTest\t1990\tonly\t-\tOct\tSat<=30\t2:00\t0\t-\n',
		);
		expect(before.rules.get('Test')?.[0]?.day).toEqual({
			kind: 'onOrBefore',
			weekday: 6,
			day: 30,
		});
	});

	it('reads a time that states the end of a day', () => {
		// A rule can end a day at 24:00, and the change then falls at the
		// start of the day that follows.
		const read = source(
			'Rule\tTest\t1990\tonly\t-\tOct\tlastThu\t24:00\t0\t-\n',
		);
		expect(read.rules.get('Test')?.[0]?.at.seconds).toBe(86400);
	});

	it('reads a seasonal offset that steps the clock back', () => {
		// The main form of the release states the winter of Ireland as a
		// seasonal offset of one hour below the standard offset.
		const read = source(
			'Rule\tTest\t1990\tmax\t-\tOct\tlastSun\t1:00u\t-1:00\t-\n',
		);
		expect(read.rules.get('Test')?.[0]?.save).toBe(-3600);
	});

	it('reads an offset that states hours, minutes and seconds', () => {
		const read = source('Zone\tTest/One\t-0:44:30\t-\tMMT\n');
		expect(read.zones[0]?.lines[0]?.standardOffset).toBe(-2670);
	});

	it('reads a zone that states a constant seasonal offset', () => {
		const read = source('Zone\tTest/One\t4:00\t1:00\t%z\n');
		expect(read.zones[0]?.lines[0]?.rules).toEqual({
			kind: 'constant',
			save: 3600,
		});
	});

	it('drops a comment and an empty line', () => {
		const read = source(
			'# a comment\n\nZone\tTest/One\t1:00\t-\tCET\t# and here\n',
		);
		expect(read.zones.length).toBe(1);
		expect(read.zones[0]?.lines[0]?.format).toBe('CET');
	});

	it('reads a link', () => {
		const read = source('Link\tTest/One\tTest/Other\n');
		expect(read.links).toEqual([
			{ target: 'Test/One', name: 'Test/Other' },
		]);
	});

	it('refuses a line that it does not know', () => {
		expect(() => source('Wibble\tTest\n')).toThrow(
			/does not know this line/,
		);
	});

	it('refuses a rule with the wrong count of fields', () => {
		expect(() => source('Rule\tTest\t1990\tonly\t-\tMar\n')).toThrow(
			/the reader wants 10/,
		);
	});

	it('refuses a rule whose fifth field is not a dash', () => {
		expect(() =>
			source('Rule\tTest\t1990\tonly\tx\tMar\t8\t2:00\t0\t-\n'),
		).toThrow(/the reader wants a dash/);
	});

	it('refuses a month that it does not know', () => {
		expect(() =>
			source('Rule\tTest\t1990\tonly\t-\tSmarch\t8\t2:00\t0\t-\n'),
		).toThrow(/does not know the month/);
	});

	it('refuses a weekday that it does not know', () => {
		expect(() =>
			source('Rule\tTest\t1990\tonly\t-\tMar\tlastFooday\t2:00\t0\t-\n'),
		).toThrow(/does not know the weekday/);
	});

	it('refuses a day that it does not know', () => {
		expect(() =>
			source('Rule\tTest\t1990\tonly\t-\tMar\tSoon\t2:00\t0\t-\n'),
		).toThrow(/does not know the day/);
	});

	it('refuses an offset that it does not know', () => {
		expect(() => source('Zone\tTest/One\tnoon\t-\tCET\n')).toThrow(
			/does not know the offset/,
		);
	});

	it('refuses a year that it does not know', () => {
		expect(() =>
			source('Rule\tTest\t19x0\tonly\t-\tMar\t8\t2:00\t0\t-\n'),
		).toThrow(/does not know the year/);
	});

	it('refuses a mark that names no clock', () => {
		expect(() =>
			source('Rule\tTest\t1990\tonly\t-\tMar\t8\t2:00q\t0\t-\n'),
		).toThrow(/does not know the time mark/);
	});

	it('refuses one name that stands two times', () => {
		expect(() =>
			source('Zone\tTest/One\t1:00\t-\tA\nZone\tTest/One\t2:00\t-\tB\n'),
		).toThrow(/two times/);
	});

	it('refuses a zone line with too few fields', () => {
		expect(() => source('Zone\tTest/One\t1:00\n')).toThrow(
			/too few fields/,
		);
	});
});

describe('the expansion of one zone', () => {
	const source = (text: string) =>
		parseTimezoneSource([{ name: 'test', text }]);

	it('refuses a zone that names a rule set the release does not state', () => {
		const read = source('Zone\tTest/One\t1:00\tMissing\tC%sT\n');
		const zone = read.zones[0];
		expect(zone).toBeDefined();
		expect(() => zone && expandZone(zone, read)).toThrow(
			/states no such set/,
		);
	});

	it('refuses a format that holds the mark for the offset beside more', () => {
		const read = source('Zone\tTest/One\t1:00\t-\tX%zY\n');
		const zone = read.zones[0];
		expect(zone).toBeDefined();
		expect(() => zone && expandZone(zone, read)).toThrow(
			/stands for a whole format/,
		);
	});

	it('refuses a line that stops before its own rules start', () => {
		// The compiler of the release refuses this shape: it can name no
		// abbreviation for the span between the start of the line and the
		// first rule of the set.
		const read = source(
			'Rule\tPb\t1979\tmax\t-\tFeb\tlastSun\t0:00\t1:00\tD\n' +
				'Rule\tPb\t1979\tmax\t-\tJun\tSun>=1\t0:00\t0\tS\n' +
				'Zone\tTest/Mid\t-4:00\t-\tAST\t1972 Jan 1\n' +
				'\t\t\t-6:00\tPb\tC%sT\t1975 Jan 1\n' +
				'\t\t\t-5:00\t-\tEST\n',
		);
		const zone = read.zones[0];
		expect(zone).toBeDefined();
		expect(() => zone && expandZone(zone, read)).toThrow(
			/no rule states the letters/,
		);
	});

	it('takes such a line where its format asks for no letters', () => {
		const read = source(
			'Rule\tPb\t1979\tmax\t-\tFeb\tlastSun\t0:00\t1:00\tD\n' +
				'Rule\tPb\t1979\tmax\t-\tJun\tSun>=1\t0:00\t0\tS\n' +
				'Zone\tTest/Mid\t-4:00\t-\tAST\t1972 Jan 1\n' +
				'\t\t\t-6:00\tPb\tCST\t1975 Jan 1\n' +
				'\t\t\t-5:00\t-\tEST\n',
		);
		const zone = read.zones[0];
		expect(zone && expandZone(zone, read).changes.length).toBeGreaterThan(
			0,
		);
	});

	it('writes the abbreviation of an offset in digits', () => {
		const read = source('Zone\tTest/One\t-3:30\t-\t%z\n');
		const zone = read.zones[0];
		expect(zone && expandZone(zone, read).initial.abbreviation).toBe(
			'-0330',
		);
	});

	it('marks a seasonal offset that steps the clock back as daylight', () => {
		const read = source(
			'Rule\tT\t1990\tmax\t-\tMar\tlastSun\t1:00u\t0\t-\n' +
				'Rule\tT\t1990\tmax\t-\tOct\tlastSun\t1:00u\t-1:00\t-\n' +
				'Zone\tTest/One\t1:00\tT\tIST/GMT\n',
		);
		const zone = read.zones[0];
		const expanded = zone && expandZone(zone, read);
		expect(expanded?.terminal?.standard).toEqual({
			offset: 3600,
			isDaylight: false,
			abbreviation: 'IST',
		});
		expect(expanded?.terminal?.daylight).toEqual({
			offset: 0,
			isDaylight: true,
			abbreviation: 'GMT',
		});
	});

	it('takes the second name of a format for a seasonal offset', () => {
		const read = source(
			'Rule\tT\t1990\tmax\t-\tMar\tlastSun\t2:00\t1:00\t-\n' +
				'Rule\tT\t1990\tmax\t-\tOct\tlastSun\t2:00\t0\t-\n' +
				'Zone\tTest/One\t0:00\tT\tGMT/BST\n',
		);
		const zone = read.zones[0];
		const expanded = zone && expandZone(zone, read);
		expect(expanded?.terminal?.standard.abbreviation).toBe('GMT');
		expect(expanded?.terminal?.daylight.abbreviation).toBe('BST');
	});
});

describe('the horizon of the expansion', () => {
	const source = (text: string) =>
		parseTimezoneSource([{ name: 'test', text }]);

	it('refuses a rule whose last year reaches the horizon', () => {
		const read = source(
			'Rule\tFar\t1990\t2300\t-\tMar\tlastSun\t2:00\t1:00\tD\n' +
				'Zone\tTest/Far\t1:00\tFar\tC%sT\n',
		);
		expect(() => expandZones(read)).toThrow(/Raise MATERIAL_YEAR/);
	});

	it('names the year and the constant in the refusal', () => {
		const read = source(
			'Rule\tFar\t1990\t2300\t-\tMar\tlastSun\t2:00\t1:00\tD\n' +
				'Zone\tTest/Far\t1:00\tFar\tC%sT\n',
		);
		expect(() => expandZones(read)).toThrow(/2300/);
		expect(() => expandZones(read)).toThrow(/2200/);
	});

	it('takes a rule that repeats with no last year', () => {
		const read = source(
			'Rule\tOn\t1990\tmax\t-\tMar\tlastSun\t2:00\t1:00\tD\n' +
				'Rule\tOn\t1990\tmax\t-\tOct\tlastSun\t2:00\t0\tS\n' +
				'Zone\tTest/On\t1:00\tOn\tC%sT\n',
		);
		expect(expandZones(read).length).toBe(1);
	});

	it('holds the pinned release below the horizon', () => {
		// The refusal above runs over the pinned release at every test run,
		// because the generator calls it. This states the margin.
		const read = parseTimezoneSource(
			pin.data.map((name) => ({ name, text: vendored(name) })),
		);
		let latest = 0;
		for (const set of read.rules.values()) {
			for (const rule of set) {
				if (rule.lastYear !== 9999) {
					latest = Math.max(latest, rule.lastYear);
				}
			}
		}
		expect(latest).toBe(2086);
	});
});

describe('the writer of the table', () => {
	it('refuses a name that holds a character it keeps for itself', () => {
		expect(() =>
			encodeTable(
				[
					{
						name: 'Bad|Name',
						initial: {
							offset: 0,
							isDaylight: false,
							abbreviation: 'GMT',
						},
						changes: [],
						terminal: undefined,
					},
				],
				[{ name: 'Bad|Name', zone: 'Bad|Name' }],
			),
		).toThrow(/keeps the parts of a line apart/);
	});

	it('refuses an abbreviation that holds such a character', () => {
		expect(() =>
			encodeTable(
				[
					{
						name: 'Test/One',
						initial: {
							offset: 0,
							isDaylight: false,
							abbreviation: 'G,T',
						},
						changes: [],
						terminal: undefined,
					},
				],
				[{ name: 'Test/One', zone: 'Test/One' }],
			),
		).toThrow(/keeps the parts of a line apart/);
	});

	it('refuses a name that points at a zone the release does not state', () => {
		expect(() =>
			encodeTable([], [{ name: 'Test/One', zone: 'Test/Missing' }]),
		).toThrow(/states no such zone/);
	});

	it('gives one line to each of two names of one zone', () => {
		const zone = {
			name: 'Test/One',
			initial: { offset: 0, isDaylight: false, abbreviation: 'GMT' },
			changes: [],
			terminal: undefined,
		};
		const text = encodeTable(
			[zone],
			[
				{ name: 'Test/One', zone: 'Test/One' },
				{ name: 'Test/Other', zone: 'Test/One' },
			],
		);
		expect(text).toBe('Test/One|0,0,GMT|0||-\nTest/Other=Test/One\n');
	});
});

describe('the writer of the table module', () => {
	it('refuses a table that holds a back quote', () => {
		expect(() => tableModule('2026c', 'Test/One|`|0||-\n')).toThrow(
			/back quote/,
		);
	});

	it('refuses a table that holds a back slash', () => {
		expect(() => tableModule('2026c', 'Test/One|\\|0||-\n')).toThrow(
			/back slash/,
		);
	});

	it('refuses a table that holds the start of a substitution', () => {
		expect(() => tableModule('2026c', 'Test/One|${x}|0||-\n')).toThrow(
			/substitution/,
		);
	});

	it('refuses a release that does not read as a release', () => {
		expect(() => tableModule('twenty', 'Test/One|0,0,GMT|0||-\n')).toThrow(
			/does not read as a release/,
		);
	});

	it('states the release in the module that it writes', () => {
		expect(tableModule('2026c', 'Test/One|0,0,GMT|0||-\n')).toContain(
			"TIMEZONE_TABLE_RELEASE = '2026c'",
		);
	});
});
