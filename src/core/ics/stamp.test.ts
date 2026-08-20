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
	writtenZoneIds: readonly string[] = [],
): StampSubject {
	return { calendar, writtenZoneIds, instanceDates };
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

	it('reads a reach in a record that holds the date of an instance', () => {
		expect(
			timezoneReaches(subject(ONE_EVENT, ['2026-03-02'])).instanceDate,
		).toBe(true);
		expect(
			carriesTimezoneComponent(subject(ONE_EVENT, ['2026-03-02'])),
		).toBe(true);
	});

	it('reads no written zone when the caller names none', () => {
		expect(timezoneReaches(subject(SERIES_IN_A_ZONE)).writtenZone).toBe(
			false,
		);
	});

	it('reads a written zone when the caller names one', () => {
		const written = subject(ONE_EVENT, [], ['America/New_York']);
		expect(timezoneReaches(written).writtenZone).toBe(true);
		expect(carriesTimezoneComponent(written)).toBe(true);
		expect(normalizationStamp(written)).toEqual({
			core: CORE_NORMALIZATION_VERSION,
			timezone: TIMEZONE_NORMALIZATION_VERSION,
		});
	});

	it('carries no timezone component for any file of the corpus', () => {
		for (const fixture of icsCorpus()) {
			const parsed = parseIcs(fixture.content);
			expect(parsed.ok).toBe(true);
			if (parsed.ok) {
				expect(carriesTimezoneComponent(subject(parsed.calendar))).toBe(
					false,
				);
			}
		}
	});
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
