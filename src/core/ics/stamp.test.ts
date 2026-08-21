import { describe, expect, it } from 'vitest';
import { icsCorpus } from '../../../test/harness/fixtures/ics-corpus';
import type { NormalizationStamp } from '../model/normalization';
import type { JCalComponent } from './jcal';
import { parseIcs } from './parse';
import type { StampSubject } from './stamp';
import {
	CORE_NORMALIZATION_VERSION,
	NORMALIZATION_VERSIONS,
	TIMEZONE_NORMALIZATION_VERSION,
	carriesTimezoneComponent,
	normalizationStamp,
	skewDecision,
	timezoneReaches,
	zonesInRecord,
} from './stamp';

const HEAD = [
	'BEGIN:VCALENDAR',
	'VERSION:2.0',
	'PRODID:-//Davenport//normalization stamp//EN',
];

function calendarOf(...lines: string[]): JCalComponent {
	const text = [...HEAD, ...lines, 'END:VCALENDAR', ''].join('\r\n');
	const parsed = parseIcs(text);
	if (!parsed.ok) {
		throw new Error(
			`the boundary refused the text: ${parsed.failure.message}`,
		);
	}
	return parsed.calendar;
}

function subject(
	calendar: JCalComponent,
	instanceDates: readonly string[] = [],
): StampSubject {
	return { calendar, instanceDates };
}

const SERIES_IN_A_ZONE = calendarOf(
	'BEGIN:VTIMEZONE',
	'TZID:America/New_York',
	'BEGIN:STANDARD',
	'DTSTART:20071104T020000',
	'TZNAME:EST',
	'TZOFFSETFROM:-0400',
	'TZOFFSETTO:-0500',
	'END:STANDARD',
	'END:VTIMEZONE',
	'BEGIN:VEVENT',
	'UID:stamp',
	'DTSTART;TZID=America/New_York:20260302T090000',
	'RRULE:FREQ=WEEKLY;UNTIL=20260601T130000Z',
	'END:VEVENT',
);

const SERIES_WITHOUT_AN_END = calendarOf(
	'BEGIN:VEVENT',
	'UID:stamp',
	'DTSTART;TZID=America/New_York:20260302T090000',
	'RRULE:FREQ=WEEKLY;COUNT=12',
	'END:VEVENT',
);

const SERIES_IN_UNIVERSAL_TIME = calendarOf(
	'BEGIN:VEVENT',
	'UID:stamp',
	'DTSTART:20260302T140000Z',
	'RRULE:FREQ=WEEKLY;UNTIL=20260601T130000Z',
	'END:VEVENT',
);

const TASK_SERIES_IN_A_ZONE = calendarOf(
	'BEGIN:VTODO',
	'UID:stamp',
	'DUE;TZID=America/New_York:20260302T090000',
	'RRULE:FREQ=WEEKLY;UNTIL=20260601T130000Z',
	'END:VTODO',
);

const TASK_WITHOUT_A_SERIES = calendarOf(
	'BEGIN:VTODO',
	'UID:stamp',
	'DUE;TZID=America/New_York:20260302T090000',
	'END:VTODO',
);

const TASK_SERIES_WITHOUT_AN_END = calendarOf(
	'BEGIN:VTODO',
	'UID:stamp',
	'DUE;TZID=America/New_York:20260302T090000',
	'RRULE:FREQ=WEEKLY;COUNT=12',
	'END:VTODO',
);

const TASK_WITH_A_UNIVERSAL_START = calendarOf(
	'BEGIN:VTODO',
	'UID:stamp',
	'DTSTART:20260302T140000Z',
	'DUE;TZID=America/New_York:20260302T170000',
	'RRULE:FREQ=WEEKLY;UNTIL=20260601T130000Z',
	'END:VTODO',
);

const SERIES_THAT_ENDS_ON_A_DATE = calendarOf(
	'BEGIN:VEVENT',
	'UID:stamp',
	'DTSTART;TZID=America/New_York:20260302T090000',
	'RRULE:FREQ=WEEKLY;UNTIL=20260601',
	'END:VEVENT',
);

const SERIES_OF_WHOLE_DAYS = calendarOf(
	'BEGIN:VEVENT',
	'UID:stamp',
	'DTSTART;TZID=America/New_York;VALUE=DATE:20260302',
	'RRULE:FREQ=WEEKLY;UNTIL=20260601T130000Z',
	'END:VEVENT',
);

const EVENT_WITH_A_DEFINITION = calendarOf(
	'BEGIN:VTIMEZONE',
	'TZID:America/New_York',
	'BEGIN:STANDARD',
	'DTSTART:20071104T020000',
	'TZNAME:EST',
	'TZOFFSETFROM:-0400',
	'TZOFFSETTO:-0500',
	'END:STANDARD',
	'END:VTIMEZONE',
	'BEGIN:VEVENT',
	'UID:stamp',
	'DTSTART;TZID=America/New_York:20260302T090000',
	'END:VEVENT',
);

const EVENT_IN_A_ZONE = calendarOf(
	'BEGIN:VEVENT',
	'UID:stamp',
	'DTSTART;TZID=America/New_York:20260302T090000',
	'END:VEVENT',
);

const EVENT_IN_A_STRANGE_ZONE = calendarOf(
	'BEGIN:VTIMEZONE',
	'TZID:Mars/Olympus',
	'BEGIN:STANDARD',
	'DTSTART:19700101T000000',
	'TZOFFSETFROM:+0000',
	'TZOFFSETTO:+0000',
	'END:STANDARD',
	'END:VTIMEZONE',
	'BEGIN:VEVENT',
	'UID:stamp',
	'DTSTART;TZID=Mars/Olympus:20260302T090000',
	'END:VEVENT',
);

const EVENT_IN_TWO_ZONES = calendarOf(
	'BEGIN:VEVENT',
	'UID:stamp',
	'DTSTART;TZID=America/New_York:20260302T090000',
	'DTEND;TZID=Europe/London:20260302T150000',
	'DUE;TZID=Mars/Olympus:20260302T160000',
	'END:VEVENT',
);

const EVENT_WITH_A_HOME_ZONE = calendarOf(
	'X-WR-TIMEZONE:America/New_York',
	'BEGIN:VEVENT',
	'UID:stamp',
	'DTSTART:20260302T140000Z',
	'END:VEVENT',
);

const EVENT_WITH_A_STRANGE_VALUE = calendarOf(
	'X-WR-TIMEZONE:Mars/Olympus',
	'BEGIN:VEVENT',
	'UID:stamp',
	'SUMMARY:America/New York is not a name',
	'DTSTART:20260302T140000Z',
	'END:VEVENT',
);

const ONE_EVENT = calendarOf(
	'BEGIN:VEVENT',
	'UID:stamp',
	'DTSTART:20260302T140000Z',
	'END:VEVENT',
);

describe('the components of the stamp', () => {
	it('states one whole number for each component', () => {
		expect(Number.isInteger(CORE_NORMALIZATION_VERSION)).toBe(true);
		expect(Number.isInteger(TIMEZONE_NORMALIZATION_VERSION)).toBe(true);
	});

	it('states the values of this build', () => {
		expect(NORMALIZATION_VERSIONS).toEqual({
			core: CORE_NORMALIZATION_VERSION,
			timezone: TIMEZONE_NORMALIZATION_VERSION,
		});
	});
});

describe('the carriage of the timezone component', () => {
	it('carries no timezone component for a record that shows no reach', () => {
		expect(normalizationStamp(subject(ONE_EVENT))).toEqual({
			core: CORE_NORMALIZATION_VERSION,
		});
	});

	it('carries the timezone component for a series that ends in a named zone', () => {
		expect(normalizationStamp(subject(SERIES_IN_A_ZONE))).toEqual({
			core: CORE_NORMALIZATION_VERSION,
			timezone: TIMEZONE_NORMALIZATION_VERSION,
		});
	});

	it('carries the timezone component for a task series that ends under a due date in a named zone', () => {
		expect(normalizationStamp(subject(TASK_SERIES_IN_A_ZONE))).toEqual({
			core: CORE_NORMALIZATION_VERSION,
			timezone: TIMEZONE_NORMALIZATION_VERSION,
		});
	});

	it('reads no universal-time reach in a task that states no repeat rule', () => {
		expect(
			timezoneReaches(subject(TASK_WITHOUT_A_SERIES)).universalTime,
		).toBe(false);
	});

	it('reads no universal-time reach in a task series that states no end', () => {
		expect(
			timezoneReaches(subject(TASK_SERIES_WITHOUT_AN_END)).universalTime,
		).toBe(false);
	});

	it('reads no universal-time reach in a series that states no end', () => {
		expect(
			timezoneReaches(subject(SERIES_WITHOUT_AN_END)).universalTime,
		).toBe(false);
	});

	it('reads no universal-time reach in a series that starts in universal time', () => {
		expect(
			timezoneReaches(subject(SERIES_IN_UNIVERSAL_TIME)).universalTime,
		).toBe(false);
	});

	it('reads no universal-time reach in a task whose start governs the series and states no zone', () => {
		// The due date names a zone, and the start governs the series. The
		// conversion of the series end therefore reads no zone of the table.
		expect(
			timezoneReaches(subject(TASK_WITH_A_UNIVERSAL_START)).universalTime,
		).toBe(false);
	});

	it('reads no universal-time reach in a series that ends on a date', () => {
		expect(
			timezoneReaches(subject(SERIES_THAT_ENDS_ON_A_DATE)).universalTime,
		).toBe(false);
	});

	it('reads no universal-time reach in a series of whole days', () => {
		expect(
			timezoneReaches(subject(SERIES_OF_WHOLE_DAYS)).universalTime,
		).toBe(false);
	});

	it('reads a reach in a record that holds the date of an instance', () => {
		expect(
			timezoneReaches(subject(ONE_EVENT, ['2026-03-02'])).instanceDate,
		).toBe(true);
		expect(
			carriesTimezoneComponent(subject(ONE_EVENT, ['2026-03-02'])),
		).toBe(true);
	});

	it('reads a zone from the name of a definition that the record carries', () => {
		expect(zonesInRecord(EVENT_WITH_A_DEFINITION)).toEqual([
			'America/New_York',
		]);
	});

	it('reads a zone in a record that names one', () => {
		const named = subject(EVENT_IN_A_ZONE);
		expect(timezoneReaches(named).namedZone).toBe(true);
		expect(carriesTimezoneComponent(named)).toBe(true);
		expect(normalizationStamp(named)).toEqual({
			core: CORE_NORMALIZATION_VERSION,
			timezone: TIMEZONE_NORMALIZATION_VERSION,
		});
	});

	it('reads a zone in a record that names one the table does not hold', () => {
		// The table decided that this definition stays in the record, so the
		// bytes of the record answer to the table here too.
		const named = subject(EVENT_IN_A_STRANGE_ZONE);
		expect(timezoneReaches(named).namedZone).toBe(true);
		expect(carriesTimezoneComponent(named)).toBe(true);
	});

	it('reads a zone that stands in the value of a property', () => {
		const named = subject(EVENT_WITH_A_HOME_ZONE);
		expect(zonesInRecord(EVENT_WITH_A_HOME_ZONE)).toEqual([
			'America/New_York',
		]);
		expect(carriesTimezoneComponent(named)).toBe(true);
	});

	it('reads no zone from a value that the table does not hold', () => {
		expect(zonesInRecord(EVENT_WITH_A_STRANGE_VALUE)).toEqual([]);
		expect(
			carriesTimezoneComponent(subject(EVENT_WITH_A_STRANGE_VALUE)),
		).toBe(false);
	});

	it('reads no zone in a record that names no zone at all', () => {
		expect(timezoneReaches(subject(ONE_EVENT)).namedZone).toBe(false);
	});

	it('names every zone of the record, in the order of the first mention', () => {
		expect(zonesInRecord(EVENT_IN_TWO_ZONES)).toEqual([
			'America/New_York',
			'Europe/London',
			'Mars/Olympus',
		]);
	});

	it('reads the name past the other properties of a definition', () => {
		const calendar = calendarOf(
			'BEGIN:VTIMEZONE',
			'TZURL:http://tzurl.org/zoneinfo/America/New_York',
			'TZID:America/New_York',
			'BEGIN:STANDARD',
			'DTSTART:20071104T020000',
			'TZNAME:EST',
			'TZOFFSETFROM:-0400',
			'TZOFFSETTO:-0500',
			'END:STANDARD',
			'END:VTIMEZONE',
			'BEGIN:VEVENT',
			'UID:stamp',
			'DTSTART;TZID=America/New_York:20260302T090000',
			'END:VEVENT',
		);
		expect(zonesInRecord(calendar)).toEqual(['America/New_York']);
	});

	it('reads no name from a definition whose name carries no value', () => {
		// No text form makes this shape: the parse boundary gives an empty
		// string for a value-less property. The record writer composes jCal
		// directly, so the shape can still reach this read, and the read must
		// meet it without a name and without a throw.
		const calendar: JCalComponent = [
			'vcalendar',
			[],
			[['vtimezone', [['tzid', {}, 'text']], []]],
		];
		expect(zonesInRecord(calendar)).toEqual([]);
		expect(carriesTimezoneComponent(subject(calendar))).toBe(false);
	});

	it('carries the timezone component for the corpus files that name a zone of the table', () => {
		const carried: string[] = [];
		for (const fixture of icsCorpus()) {
			const parsed = parseIcs(fixture.content);
			expect(parsed.ok).toBe(true);
			if (
				parsed.ok &&
				carriesTimezoneComponent(subject(parsed.calendar))
			) {
				carried.push(fixture.id);
			}
		}
		expect(carried.sort()).toEqual(CORPUS_WITH_A_TIMEZONE_REACH);
	});
});

/**
 * The files of the corpus that reach the bundled table. Each of these
 * files names a zone, so the table decides whether a record of that file
 * carries a reference or the definition of the server. A file that names
 * no zone at all reaches no byte of the table. The last file of the list
 * names its zone in the value of a vendor property and in no other place.
 */
const CORPUS_WITH_A_TIMEZONE_REACH: readonly string[] = [
	'exdate-multiple-forms',
	'vtimezone-dateline-apia',
	'vtimezone-half-hour-lord-howe',
	'vtimezone-pre-1970-amsterdam',
	'vtimezone-rdate-only-troll',
	'x-props-vendor-names',
];

/**
 * One shape of the time that can govern a repeating series. The flag
 * states the first leg of the second carriage condition: the time that
 * governs the series names a timezone and states a time of day. A
 * component that states a start is governed by that start.
 */
interface AnchorShape {
	readonly name: string;
	readonly lines: readonly string[];
	readonly zonedTimeGoverns: boolean;
}

const ANCHOR_SHAPES: readonly AnchorShape[] = [
	{ name: 'no time at all', lines: [], zonedTimeGoverns: false },
	{
		name: 'a start in universal time',
		lines: ['DTSTART:20260302T140000Z'],
		zonedTimeGoverns: false,
	},
	{
		name: 'a start with no zone',
		lines: ['DTSTART:20260302T090000'],
		zonedTimeGoverns: false,
	},
	{
		name: 'a start in a named zone',
		lines: ['DTSTART;TZID=Europe/London:20260302T090000'],
		zonedTimeGoverns: true,
	},
	{
		name: 'a start that states a date in a named zone',
		lines: ['DTSTART;TZID=Europe/London;VALUE=DATE:20260302'],
		zonedTimeGoverns: false,
	},
	{
		name: 'a start that states a date with no zone',
		lines: ['DTSTART;VALUE=DATE:20260302'],
		zonedTimeGoverns: false,
	},
	{
		name: 'a due date in a named zone',
		lines: ['DUE;TZID=Europe/London:20260302T170000'],
		zonedTimeGoverns: true,
	},
	{
		name: 'a due date in universal time',
		lines: ['DUE:20260302T170000Z'],
		zonedTimeGoverns: false,
	},
	{
		name: 'a due date with no zone',
		lines: ['DUE:20260302T170000'],
		zonedTimeGoverns: false,
	},
	{
		name: 'a start in universal time and a due date in a named zone',
		lines: [
			'DTSTART:20260302T140000Z',
			'DUE;TZID=Europe/London:20260302T170000',
		],
		zonedTimeGoverns: false,
	},
	{
		name: 'a start in a named zone and a due date in universal time',
		lines: [
			'DTSTART;TZID=Europe/London:20260302T090000',
			'DUE:20260302T170000Z',
		],
		zonedTimeGoverns: true,
	},
	{
		name: 'a start that states a date in a named zone, and a due date in a named zone',
		lines: [
			'DTSTART;TZID=Europe/London;VALUE=DATE:20260302',
			'DUE;TZID=Europe/London:20260302T170000',
		],
		zonedTimeGoverns: false,
	},
];

/**
 * One shape of a repeating series. The flag states the second leg of the
 * second carriage condition: the end of the series stands in universal
 * time.
 */
interface RecurrenceShape {
	readonly name: string;
	readonly lines: readonly string[];
	readonly endsInUniversalTime: boolean;
}

const RECURRENCE_SHAPES: readonly RecurrenceShape[] = [
	{ name: 'no repeat rule', lines: [], endsInUniversalTime: false },
	{
		name: 'a repeat rule with no end',
		lines: ['RRULE:FREQ=WEEKLY'],
		endsInUniversalTime: false,
	},
	{
		name: 'a repeat rule that states a count',
		lines: ['RRULE:FREQ=WEEKLY;COUNT=12'],
		endsInUniversalTime: false,
	},
	{
		name: 'a repeat rule that ends in universal time',
		lines: ['RRULE:FREQ=WEEKLY;UNTIL=20260601T080000Z'],
		endsInUniversalTime: true,
	},
	{
		name: 'a repeat rule that ends with no zone',
		lines: ['RRULE:FREQ=WEEKLY;UNTIL=20260601T080000'],
		endsInUniversalTime: false,
	},
	{
		name: 'a repeat rule that ends on a date',
		lines: ['RRULE:FREQ=WEEKLY;UNTIL=20260601'],
		endsInUniversalTime: false,
	},
	{
		name: 'dates of the series and no repeat rule',
		lines: ['RDATE:20260309T090000Z'],
		endsInUniversalTime: false,
	},
];

const COMPONENT_KINDS: readonly string[] = ['VEVENT', 'VTODO'];

describe('the second carriage condition over every shape', () => {
	for (const kind of COMPONENT_KINDS) {
		for (const anchor of ANCHOR_SHAPES) {
			for (const recurrence of RECURRENCE_SHAPES) {
				const expected =
					anchor.zonedTimeGoverns && recurrence.endsInUniversalTime;
				it(`reads ${String(expected)} for a ${kind} with ${anchor.name} and ${recurrence.name}`, () => {
					const calendar = calendarOf(
						`BEGIN:${kind}`,
						'UID:stamp',
						...anchor.lines,
						...recurrence.lines,
						`END:${kind}`,
					);
					expect(
						timezoneReaches(subject(calendar)).universalTime,
					).toBe(expected);
				});
			}
		}
	}
});

const SKEW: readonly [string, NormalizationStamp, number, number, string][] = [
	['the same core component', { core: 3 }, 3, 1, 'suppress'],
	['a newer core component on the device', { core: 2 }, 3, 1, 'rewrite'],
	['an older core component on the device', { core: 4 }, 3, 1, 'suppress'],
	['both components the same', { core: 3, timezone: 2 }, 3, 2, 'suppress'],
	[
		'a newer timezone component on the device',
		{ core: 3, timezone: 1 },
		3,
		2,
		'rewrite',
	],
	[
		'an older core component and a newer timezone component on the device',
		{ core: 4, timezone: 1 },
		3,
		2,
		'suppress',
	],
	[
		'a newer core component and an older timezone component on the device',
		{ core: 2, timezone: 3 },
		3,
		2,
		'suppress',
	],
	[
		'a record that carries no timezone component, and a device that is older on that component',
		{ core: 2 },
		3,
		1,
		'rewrite',
	],
];

describe('the skew rule', () => {
	it.each(SKEW)('answers %s', (_name, record, core, timezone, decision) => {
		expect(skewDecision({ core, timezone }, record)).toBe(decision);
	});
});
