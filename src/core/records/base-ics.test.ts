import { describe, expect, it } from 'vitest';
import type { JCalComponent } from '../ics/jcal';
import { parseIcs } from '../ics/parse';
import { serializeCalendar } from '../ics/serializer';
import { synthesiseTimezone } from '../timezone/synthesiser';
import { baseCalendar } from './base-ics';

function calendarOf(...lines: string[]): JCalComponent {
	const parsed = parseIcs(
		[
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//Davenport//base snapshot//EN',
			...lines,
			'END:VCALENDAR',
			'',
		].join('\r\n'),
	);
	if (!parsed.ok) {
		throw new Error(parsed.failure.message);
	}
	return parsed.calendar;
}

const NEW_YORK = [
	'BEGIN:VTIMEZONE',
	'TZID:America/New_York',
	'BEGIN:STANDARD',
	'DTSTART:20071104T020000',
	'TZNAME:EST',
	'TZOFFSETFROM:-0400',
	'TZOFFSETTO:-0500',
	'END:STANDARD',
	'END:VTIMEZONE',
];

const STRANGE = [
	'BEGIN:VTIMEZONE',
	'TZID:Factory/Line 3',
	'BEGIN:STANDARD',
	'DTSTART:19700101T000000',
	'TZOFFSETFROM:+0130',
	'TZOFFSETTO:+0130',
	'END:STANDARD',
	'END:VTIMEZONE',
];

const EVENT_IN_NEW_YORK = [
	'BEGIN:VEVENT',
	'UID:one',
	'DTSTART;TZID=America/New_York:20260302T090000',
	'END:VEVENT',
];

describe('a name that the bundled table holds', () => {
	it('drops the definition that the server sent', () => {
		const base = baseCalendar(
			calendarOf(...NEW_YORK, ...EVENT_IN_NEW_YORK),
		);
		expect(serializeCalendar(base.calendar)).not.toContain('VTIMEZONE');
	});

	it('keeps the name that the event states', () => {
		const base = baseCalendar(
			calendarOf(...NEW_YORK, ...EVENT_IN_NEW_YORK),
		);
		expect(serializeCalendar(base.calendar)).toContain(
			'DTSTART;TZID=America/New_York:20260302T090000',
		);
	});

	it('names the zone as one that the record references', () => {
		const base = baseCalendar(
			calendarOf(...NEW_YORK, ...EVENT_IN_NEW_YORK),
		);
		expect(base.referencedZones).toEqual(['America/New_York']);
		expect(base.embeddedZones).toEqual([]);
		expect(base.unresolvableZones).toEqual([]);
	});

	it('references the zone where the server sent no definition at all', () => {
		const base = baseCalendar(calendarOf(...EVENT_IN_NEW_YORK));
		expect(base.referencedZones).toEqual(['America/New_York']);
		expect(base.unresolvableZones).toEqual([]);
	});

	it('gives one snapshot for a definition-only difference on the server', () => {
		const withDefinition = baseCalendar(
			calendarOf(...NEW_YORK, ...EVENT_IN_NEW_YORK),
		);
		const withAnother = baseCalendar(
			calendarOf(
				'BEGIN:VTIMEZONE',
				'TZID:America/New_York',
				'BEGIN:DAYLIGHT',
				'DTSTART:20070311T020000',
				'TZNAME:EDT',
				'TZOFFSETFROM:-0500',
				'TZOFFSETTO:-0400',
				'END:DAYLIGHT',
				'END:VTIMEZONE',
				...EVENT_IN_NEW_YORK,
			),
		);
		const withNone = baseCalendar(calendarOf(...EVENT_IN_NEW_YORK));
		expect(serializeCalendar(withAnother.calendar)).toBe(
			serializeCalendar(withDefinition.calendar),
		);
		expect(serializeCalendar(withNone.calendar)).toBe(
			serializeCalendar(withDefinition.calendar),
		);
	});

	it('names a zone that the synthesiser can write', () => {
		const base = baseCalendar(calendarOf(...EVENT_IN_NEW_YORK));
		for (const name of base.referencedZones) {
			expect(synthesiseTimezone(name).ok).toBe(true);
		}
	});
});

describe('a name that the bundled table does not hold', () => {
	it('keeps the definition that the server sent', () => {
		const base = baseCalendar(
			calendarOf(
				...STRANGE,
				'BEGIN:VEVENT',
				'UID:one',
				'DTSTART;TZID=Factory/Line 3:20260302T090000',
				'END:VEVENT',
			),
		);
		expect(serializeCalendar(base.calendar)).toContain(
			'TZID:Factory/Line 3',
		);
		expect(base.embeddedZones).toEqual(['Factory/Line 3']);
		expect(base.referencedZones).toEqual([]);
		expect(base.unresolvableZones).toEqual([]);
	});

	it('names a zone that the calendar states and carries no definition for', () => {
		const base = baseCalendar(
			calendarOf(
				'BEGIN:VEVENT',
				'UID:one',
				'DTSTART;TZID=Factory/Line 3:20260302T090000',
				'END:VEVENT',
			),
		);
		expect(base.unresolvableZones).toEqual(['Factory/Line 3']);
		expect(synthesiseTimezone('Factory/Line 3').ok).toBe(false);
	});
});

describe('a calendar that names more than one zone', () => {
	it('sorts each name into its own answer', () => {
		const base = baseCalendar(
			calendarOf(
				...NEW_YORK,
				...STRANGE,
				'BEGIN:VEVENT',
				'UID:one',
				'DTSTART;TZID=America/New_York:20260302T090000',
				'DTEND;TZID=Factory/Line 3:20260302T100000',
				'DUE;TZID=Nowhere/Special:20260302T110000',
				'END:VEVENT',
			),
		);
		expect(base.referencedZones).toEqual(['America/New_York']);
		expect(base.embeddedZones).toEqual(['Factory/Line 3']);
		expect(base.unresolvableZones).toEqual(['Nowhere/Special']);
	});

	it('names a zone one time however many values state it', () => {
		const base = baseCalendar(
			calendarOf(
				'BEGIN:VEVENT',
				'UID:one',
				'DTSTART;TZID=America/New_York:20260302T090000',
				'DTEND;TZID=America/New_York:20260302T100000',
				'END:VEVENT',
			),
		);
		expect(base.referencedZones).toEqual(['America/New_York']);
	});

	it('reads a definition that stands inside another component', () => {
		const calendar: JCalComponent = [
			'vcalendar',
			[],
			[
				[
					'vevent',
					[['uid', {}, 'text', 'one']],
					[
						[
							'vtimezone',
							[['tzid', {}, 'text', 'America/New_York']],
							[],
						],
					],
				],
			],
		];
		const base = baseCalendar(calendar);
		expect(base.calendar[2][0]?.[2]).toEqual([]);
		expect(base.referencedZones).toEqual([]);
	});
});
