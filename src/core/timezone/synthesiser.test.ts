import { describe, expect, it } from 'vitest';
import {
	definitionChanges,
	definitionOffset,
	textInComponentOrder,
	valueOf,
} from '../../../test/harness/timezone-definition';
import type { JCalComponent } from '../ics/jcal';
import { serializeCalendar } from '../ics/serializer';
import {
	TIMEZONE_NORMALIZATION_VERSION,
	normalizationStamp,
	timezoneReaches,
} from '../ics/stamp';
import { parseIcs } from '../ics/parse';
import { offsetAt, terminalInstant } from './offsets';
import { repeatPatterns, repeatPatternsOfYear } from './repeat';
import type { RepeatPattern } from './repeat';
import { readTimezoneTable, timezoneNames, timezoneRules } from './table';
import { synthesiseTimezone, timezoneDefinition } from './synthesiser';

/** The last year that the tests read a repeat rule up to. */
const UNTIL_YEAR = 2100;

/** A leap year. February holds one more day in such a year. */
const LEAP_YEAR = 2000;

/**
 * The number of zones that one test of the whole table reads.
 *
 * Two checks below read every zone. Each one takes most of a second over
 * the whole table on a fast host, and the host that runs the build is
 * several times slower than that. One test that held the whole table
 * would stand close to the limit that the runner gives a test. The two
 * checks therefore run in batches, and each batch states the first and
 * the last zone that it holds.
 */
const ZONES_IN_A_BATCH = 25;

/** One batch of zones, with the first name and the last name in it. */
interface ZoneBatch {
	readonly first: string;
	readonly last: string;
	readonly names: readonly string[];
}

/** The names of the table, in batches. */
function zoneBatches(names: readonly string[]): readonly ZoneBatch[] {
	const batches: ZoneBatch[] = [];
	for (let start = 0; start < names.length; start += ZONES_IN_A_BATCH) {
		const batch = names.slice(start, start + ZONES_IN_A_BATCH);
		batches.push({
			first: batch[0] ?? '',
			last: batch[batch.length - 1] ?? '',
			names: batch,
		});
	}
	return batches;
}

/** The patterns of one change, as one text. */
function patternText(patterns: readonly RepeatPattern[]): string {
	return patterns
		.map(
			(one) =>
				`${String(one.month)}:${one.days?.join(',') ?? '-'}:${one.byday ?? '-'}`,
		)
		.join(' ');
}

function definitionOf(name: string): JCalComponent {
	const result = synthesiseTimezone(name);
	if (!result.ok) {
		throw new Error(`the bundled table holds no zone named ${name}`);
	}
	return result.component;
}

function observancesOf(component: JCalComponent): readonly JCalComponent[] {
	return component[2];
}

/** The value, or an error that names what the test looked for. */
function required<Value>(value: Value | undefined, what: string): Value {
	if (value === undefined) {
		throw new Error(`the test found no ${what}`);
	}
	return value;
}

/** The observances of one component, as one text line each. */
function summaryOf(component: JCalComponent): readonly string[] {
	return observancesOf(component).map((observance) =>
		[
			observance[0],
			valueOf(observance[1], 'dtstart'),
			valueOf(observance[1], 'tzoffsetfrom'),
			valueOf(observance[1], 'tzoffsetto'),
			valueOf(observance[1], 'tzname'),
		].join(' '),
	);
}

function rulesOf(component: JCalComponent): readonly string[] {
	return observancesOf(component)
		.filter((observance) =>
			observance[1].some((property) => property[0] === 'rrule'),
		)
		.map((observance) =>
			[observance[0], valueOf(observance[1], 'dtstart')].join(' '),
		);
}

describe('the definition of a zone with no change of the clock', () => {
	it('holds one observance for the state at the start of 1970', () => {
		expect(summaryOf(definitionOf('UTC'))).toEqual([
			'standard 1970-01-01T00:00:00 +00:00 +00:00 UTC',
		]);
	});

	it('writes the minutes of an offset that is not a whole hour', () => {
		expect(summaryOf(definitionOf('Asia/Kolkata'))).toEqual([
			'standard 1970-01-01T00:00:00 +05:30 +05:30 IST',
		]);
	});

	it('writes the seconds of an offset that is not a whole minute', () => {
		expect(summaryOf(definitionOf('Africa/Monrovia'))[0]).toBe(
			'standard 1970-01-01T00:00:00 -00:44:30 -00:44:30 MMT',
		);
	});
});

describe('the name of a definition', () => {
	it('takes the name that the caller wrote', () => {
		// The table holds the rules of this zone under Asia/Calcutta, and it
		// points Asia/Kolkata at that name.
		expect(valueOf(definitionOf('Asia/Kolkata')[1], 'tzid')).toBe(
			'Asia/Kolkata',
		);
		expect(valueOf(definitionOf('Asia/Calcutta')[1], 'tzid')).toBe(
			'Asia/Calcutta',
		);
	});

	it('takes the rules of the name that the table points at', () => {
		expect(summaryOf(definitionOf('Asia/Kolkata'))).toEqual(
			summaryOf(definitionOf('Asia/Calcutta')),
		);
	});

	it('refuses a name that the table does not hold', () => {
		expect(synthesiseTimezone('Mars/Olympus_Mons')).toEqual({
			ok: false,
			failure: 'unknown',
		});
	});
});

describe('the onset of an observance', () => {
	// One zone, one state of no offset, and one state of one hour ahead.
	// The change stands one day after the start of 1970.
	const table = readTimezoneTable('Test/One|0,0,A;3600,1,B|0|140,1|-\n');

	it('reads the clock that runs before the change', () => {
		const rules = required(table.rules('Test/One'), 'rules for Test/One');
		expect(summaryOf(timezoneDefinition(rules))).toEqual([
			'daylight 1970-01-02T00:00:00 +00:00 +01:00 B',
			'standard 1970-01-01T00:00:00 +00:00 +00:00 A',
		]);
	});
});

describe('the order of the observances', () => {
	it('writes the daylight observances before the standard observances', () => {
		const kinds = observancesOf(definitionOf('Antarctica/Troll')).map(
			(observance) => observance[0],
		);
		expect(kinds).toEqual(['daylight', 'standard', 'standard', 'standard']);
	});

	it('writes a daylight observance first where the clock starts in a daylight state', () => {
		expect(observancesOf(definitionOf('Pacific/Easter'))[0]?.[0]).toBe(
			'daylight',
		);
	});

	it('follows the state and not the season', () => {
		// The standard state of Dublin is its summer state, and its winter
		// state carries the daylight mark.
		const winter = required(
			observancesOf(definitionOf('Europe/Dublin')).find(
				(observance) => observance[0] === 'daylight',
			),
			'daylight observance of Europe/Dublin',
		);
		expect(valueOf(winter[1], 'tzname')).toBe('GMT');
		expect(valueOf(winter[1], 'tzoffsetto')).toBe('+00:00');
	});
});

describe('the repeating pair of a definition', () => {
	it('writes one rule for each direction of the pair', () => {
		expect(rulesOf(definitionOf('Antarctica/Troll'))).toEqual([
			'daylight 2005-03-27T01:00:00',
			'standard 2005-10-30T03:00:00',
		]);
	});

	it('writes one rule for each month that an onset reaches', () => {
		expect(rulesOf(definitionOf('Africa/Cairo'))).toEqual([
			'daylight 2024-04-26T00:00:00',
			'standard 2023-10-27T00:00:00',
			'standard 2024-11-01T00:00:00',
		]);
	});

	it('writes an occurrence on its own where the offset before it differs', () => {
		// The zone changed its standard offset in the same step that started
		// its first repeating change. The offset before that step is
		// therefore not the offset that the pair states.
		const alone = required(
			observancesOf(definitionOf('America/Scoresbysund')).find(
				(observance) =>
					valueOf(observance[1], 'dtstart') === '2024-03-31T00:00:00',
			),
			'observance of America/Scoresbysund at the start of 2024',
		);
		expect(alone[1].some((property) => property[0] === 'rrule')).toBe(
			false,
		);
		expect(valueOf(alone[1], 'tzoffsetfrom')).toBe('-01:00');
		expect(rulesOf(definitionOf('America/Scoresbysund'))).toEqual([
			'daylight 2025-03-29T23:00:00',
			'standard 2024-10-27T00:00:00',
		]);
	});

	it('states no rule for a zone that keeps no seasonal rules', () => {
		expect(rulesOf(definitionOf('Pacific/Apia'))).toEqual([]);
	});

	it('starts each rule of one change in the first year that the rule reaches', () => {
		// The change ends the daylight offset at the end of the last
		// Thursday of October, so the onset falls on the Friday after that
		// Thursday. That Friday falls in November only in a year in which
		// October ends on a Thursday, and the first such year after 1970 is
		// 1974. The rule of October therefore starts in 1970 and the rule of
		// November starts in 1974.
		const table = readTimezoneTable(
			'Test/Cross|7200,0,EET;10800,1,EEST|0||0,1,4:l5:0,10:l4:86400\n',
		);
		const rules = required(
			table.rules('Test/Cross'),
			'rules for Test/Cross',
		);
		expect(rulesOf(timezoneDefinition(rules))).toEqual([
			'daylight 1970-04-24T00:00:00',
			'standard 1970-10-30T00:00:00',
			'standard 1974-11-01T00:00:00',
		]);
	});
});

describe('every definition of the bundled table', () => {
	const names = timezoneNames();

	it('covers every name that the table holds', () => {
		expect(names.length).toBeGreaterThan(0);
		for (const name of names) {
			expect(synthesiseTimezone(name).ok).toBe(true);
		}
	});

	it.each(zoneBatches(names))(
		'stands in the order that the canonical serializer gives, from $first to $last',
		(batch) => {
			const moved: string[] = [];
			for (const name of batch.names) {
				const component = definitionOf(name);
				if (
					serializeCalendar(component) !==
					textInComponentOrder(component)
				) {
					moved.push(name);
				}
			}
			expect(
				moved,
				'the synthesiser writes a component that the canonical serializer must not move. The order rules of the serializer and the order that the synthesiser writes are one rule, and this test holds them together.',
			).toEqual([]);
		},
	);

	it('starts before every change of its zone', () => {
		const early: string[] = [];
		for (const name of names) {
			const rules = timezoneRules(name);
			if (rules === undefined) {
				continue;
			}
			let before = rules.initial.offset;
			for (const change of rules.changes) {
				if (change.at + before <= 0) {
					early.push(name);
				}
				before = change.state.offset;
			}
		}
		expect(
			early,
			'the first observance of a definition stands at the start of 1970 on the wall clock of the zone. A change that stands earlier on that clock would take the place of the first observance.',
		).toEqual([]);
	});

	it('names one set of days for a leap year and for every other year', () => {
		const different: string[] = [];
		for (const name of names) {
			const terminal = timezoneRules(name)?.terminal;
			if (terminal === undefined) {
				continue;
			}
			for (const change of [terminal.start, terminal.end]) {
				if (
					patternText(repeatPatternsOfYear(change, LEAP_YEAR)) !==
					patternText(repeatPatterns(change))
				) {
					different.push(name);
				}
			}
		}
		expect(
			different,
			'a rule of the format names one set of days for every year. February holds one more day in a leap year, so a pattern that names a day at the end of February names a different set in such a year. The synthesiser reads one year, and no pattern of the release may depend on which year that is.',
		).toEqual([]);
	});

	it.each(zoneBatches(names))(
		'gives the offset that the table gives at every change, from $first to $last',
		(batch) => {
			const wrong: string[] = [];
			for (const name of batch.names) {
				const rules = timezoneRules(name);
				if (rules === undefined) {
					continue;
				}
				const definition = definitionChanges(
					timezoneDefinition(rules),
					UNTIL_YEAR,
				);
				for (const instant of probeInstants(rules)) {
					const table = offsetAt(rules, instant);
					if (!table.ok) {
						continue;
					}
					if (
						definitionOffset(definition, instant) !== table.offset
					) {
						wrong.push(`${name} at ${String(instant)}`);
						break;
					}
				}
			}
			expect(wrong).toEqual([]);
		},
	);
});

/** Every instant at which a definition and the table must agree. */
function probeInstants(
	rules: NonNullable<ReturnType<typeof timezoneRules>>,
): readonly number[] {
	const instants: number[] = [0, 86400];
	for (const change of rules.changes) {
		instants.push(change.at - 1, change.at, change.at + 1);
	}
	const terminal = rules.terminal;
	if (terminal !== undefined) {
		for (let year = 2018; year <= UNTIL_YEAR; year += 1) {
			for (const [change, offsetBefore] of [
				[terminal.start, terminal.standard.offset],
				[terminal.end, terminal.daylight.offset],
			] as const) {
				const at = terminalInstant(change, year, offsetBefore);
				instants.push(at - 1, at, at + 1);
			}
		}
	}
	return instants.filter((instant) => instant >= 0);
}

describe('the definition inside a record', () => {
	it('passes the parse boundary', () => {
		const text = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//Davenport//synthesiser//EN',
			serializeCalendar(definitionOf('America/New_York')).trimEnd(),
			'BEGIN:VEVENT',
			'UID:one',
			'DTSTART;TZID=America/New_York:20260302T090000',
			'END:VEVENT',
			'END:VCALENDAR',
			'',
		].join('\r\n');
		const parsed = parseIcs(text);
		expect(parsed.ok).toBe(true);
	});

	it('writes a definition for every name that a record can reference', () => {
		const parsed = parseIcs(
			[
				'BEGIN:VCALENDAR',
				'VERSION:2.0',
				'PRODID:-//Davenport//synthesiser//EN',
				'BEGIN:VEVENT',
				'UID:one',
				'DTSTART;TZID=America/New_York:20260302T090000',
				'END:VEVENT',
				'END:VCALENDAR',
				'',
			].join('\r\n'),
		);
		if (!parsed.ok) {
			throw new Error('the boundary refused the calendar');
		}
		const subject = { calendar: parsed.calendar, instanceDates: [] };
		expect(timezoneReaches(subject)).toEqual({
			knownZone: true,
			universalTime: false,
			instanceDate: false,
		});
		expect(normalizationStamp(subject).timezone).toBe(
			TIMEZONE_NORMALIZATION_VERSION,
		);
		expect(synthesiseTimezone('America/New_York').ok).toBe(true);
	});

	it('refuses a name that the table does not hold, and such a record carries no timezone component', () => {
		const parsed = parseIcs(
			[
				'BEGIN:VCALENDAR',
				'VERSION:2.0',
				'PRODID:-//Davenport//synthesiser//EN',
				'BEGIN:VTIMEZONE',
				'TZID:Mars/Olympus',
				'BEGIN:STANDARD',
				'DTSTART:19700101T000000',
				'TZOFFSETFROM:+0000',
				'TZOFFSETTO:+0000',
				'END:STANDARD',
				'END:VTIMEZONE',
				'BEGIN:VEVENT',
				'UID:one',
				'DTSTART;TZID=Mars/Olympus:20260302T090000',
				'END:VEVENT',
				'END:VCALENDAR',
				'',
			].join('\r\n'),
		);
		if (!parsed.ok) {
			throw new Error('the boundary refused the calendar');
		}
		const subject = { calendar: parsed.calendar, instanceDates: [] };
		expect(normalizationStamp(subject).timezone).toBeUndefined();
		expect(synthesiseTimezone('Mars/Olympus').ok).toBe(false);
	});
});
