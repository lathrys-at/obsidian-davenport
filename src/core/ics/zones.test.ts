import { describe, expect, it } from 'vitest';
import type { JCalComponent } from './jcal';
import { parseIcs } from './parse';
import {
	definedZones,
	isDefinitionOf,
	namedZones,
	withoutDefinitions,
} from './zones';

function calendarOf(...lines: string[]): JCalComponent {
	const parsed = parseIcs(
		[
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//Davenport//zones//EN',
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

const always = (): boolean => true;
const never = (): boolean => false;

describe('the timezone names that a calendar states', () => {
	it('reads a name out of the parameter of a value', () => {
		expect(
			namedZones(
				calendarOf(
					'BEGIN:VEVENT',
					'UID:one',
					'DTSTART;TZID=Europe/London:20260302T090000',
					'END:VEVENT',
				),
			),
		).toEqual(['Europe/London']);
	});

	it('reads a name out of a definition', () => {
		expect(
			namedZones(
				calendarOf(
					'BEGIN:VTIMEZONE',
					'TZID:Europe/London',
					'BEGIN:STANDARD',
					'DTSTART:19700101T000000',
					'TZOFFSETFROM:+0000',
					'TZOFFSETTO:+0000',
					'END:STANDARD',
					'END:VTIMEZONE',
				),
			),
		).toEqual(['Europe/London']);
	});

	it('reads no name out of a property named TZID outside a definition', () => {
		expect(
			namedZones(
				calendarOf(
					'BEGIN:VEVENT',
					'UID:one',
					'TZID:Europe/London',
					'END:VEVENT',
				),
			),
		).toEqual([]);
	});

	it('names a zone one time however many values state it', () => {
		expect(
			namedZones(
				calendarOf(
					'BEGIN:VEVENT',
					'UID:one',
					'DTSTART;TZID=Europe/London:20260302T090000',
					'DTEND;TZID=Europe/London:20260302T100000',
					'END:VEVENT',
				),
			),
		).toEqual(['Europe/London']);
	});

	it('names the zones in the order of the first mention', () => {
		expect(
			namedZones(
				calendarOf(
					'BEGIN:VEVENT',
					'UID:one',
					'DTSTART;TZID=Europe/London:20260302T090000',
					'DTEND;TZID=Asia/Tokyo:20260302T100000',
					'END:VEVENT',
				),
			),
		).toEqual(['Europe/London', 'Asia/Tokyo']);
	});

	it('reads every name of a parameter that holds a list', () => {
		const calendar: JCalComponent = [
			'vcalendar',
			[
				[
					'dtstart',
					{ tzid: ['Europe/London', 'Asia/Tokyo'] },
					'date-time',
				],
			],
			[],
		];
		expect(namedZones(calendar)).toEqual(['Europe/London', 'Asia/Tokyo']);
	});

	it('reads no name from a value that is not a text', () => {
		const calendar: JCalComponent = [
			'vcalendar',
			[],
			[['vtimezone', [['tzid', {}, 'integer', 4]], []]],
		];
		expect(namedZones(calendar)).toEqual([]);
	});

	it('reads no empty name', () => {
		const calendar: JCalComponent = [
			'vcalendar',
			[],
			[['vtimezone', [['tzid', {}, 'text', '']], []]],
		];
		expect(namedZones(calendar)).toEqual([]);
		expect(definedZones(calendar)).toEqual([]);
	});
});

describe('the definitions that a calendar carries', () => {
	const CALENDAR = calendarOf(
		'BEGIN:VTIMEZONE',
		'TZID:Europe/London',
		'BEGIN:STANDARD',
		'DTSTART:19700101T000000',
		'TZOFFSETFROM:+0000',
		'TZOFFSETTO:+0000',
		'END:STANDARD',
		'END:VTIMEZONE',
		'BEGIN:VEVENT',
		'UID:one',
		'DTSTART;TZID=Asia/Tokyo:20260302T090000',
		'END:VEVENT',
	);

	it('names the zone of each definition and no other zone', () => {
		expect(definedZones(CALENDAR)).toEqual(['Europe/London']);
	});

	it('says that a definition of a named zone is one', () => {
		const definition = CALENDAR[2][0];
		expect(definition).toBeDefined();
		if (definition !== undefined) {
			expect(isDefinitionOf(definition, always)).toBe(true);
			expect(isDefinitionOf(definition, never)).toBe(false);
		}
	});

	it('says that a component that is not a definition is not one', () => {
		const event = CALENDAR[2][1];
		expect(event).toBeDefined();
		if (event !== undefined) {
			expect(isDefinitionOf(event, always)).toBe(false);
		}
	});

	it('removes the definitions that the test accepts', () => {
		expect(withoutDefinitions(CALENDAR, always)[2]).toHaveLength(1);
	});

	it('keeps the definitions that the test refuses', () => {
		expect(withoutDefinitions(CALENDAR, never)[2]).toHaveLength(2);
	});

	it('keeps the properties of the component that holds the definitions', () => {
		expect(withoutDefinitions(CALENDAR, always)[1]).toEqual(CALENDAR[1]);
	});
});
