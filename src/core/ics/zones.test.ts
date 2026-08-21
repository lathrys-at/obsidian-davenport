import { describe, expect, it } from 'vitest';
import type { JCalComponent } from './jcal';
import { parseIcs } from './parse';
import {
	definedZones,
	definitionsOf,
	isDefinitionOf,
	namedZones,
	referencedZones,
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

describe('the timezone names that a reference of a calendar states', () => {
	const holdsNewYork = (name: string): boolean => name === 'America/New_York';

	it('reads a name out of the parameter of a value', () => {
		expect(
			referencedZones(
				calendarOf(
					'BEGIN:VEVENT',
					'UID:one',
					'DTSTART;TZID=America/New_York:20260302T090000',
					'END:VEVENT',
				),
				holdsNewYork,
			),
		).toEqual(['America/New_York']);
	});

	it('reads a name out of the value of a property', () => {
		expect(
			referencedZones(
				calendarOf(
					'X-WR-TIMEZONE:America/New_York',
					'BEGIN:VEVENT',
					'UID:one',
					'DTSTART:20260302T140000Z',
					'END:VEVENT',
				),
				holdsNewYork,
			),
		).toEqual(['America/New_York']);
	});

	it('reads no name that the test refuses', () => {
		expect(
			referencedZones(
				calendarOf(
					'X-WR-TIMEZONE:Mars/Olympus',
					'BEGIN:VEVENT',
					'UID:one',
					'SUMMARY:America/New_York',
					'DTSTART:20260302T140000Z',
					'END:VEVENT',
				),
				never,
			),
		).toEqual([]);
	});

	it('reads no name out of a definition', () => {
		// The name of a definition is not a reference to that definition,
		// and the abbreviation of an offset can spell another name.
		expect(
			referencedZones(
				calendarOf(
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
					'UID:one',
					'DTSTART:20260302T140000Z',
					'END:VEVENT',
				),
				holdsNewYork,
			),
		).toEqual([]);
	});

	it('names a zone one time however many places state it', () => {
		expect(
			referencedZones(
				calendarOf(
					'X-WR-TIMEZONE:America/New_York',
					'BEGIN:VEVENT',
					'UID:one',
					'DTSTART;TZID=America/New_York:20260302T090000',
					'END:VEVENT',
				),
				holdsNewYork,
			),
		).toEqual(['America/New_York']);
	});

	it('reads every name of a parameter that carries more than one value', () => {
		const calendar: JCalComponent = [
			'vcalendar',
			[],
			[
				[
					'vevent',
					[
						[
							'dtstart',
							{ tzid: ['America/New_York', 'Europe/London'] },
							'date-time',
							'2026-03-02T09:00:00',
						],
					],
					[],
				],
			],
		];
		expect(
			referencedZones(calendar, (name) =>
				['America/New_York', 'Europe/London'].includes(name),
			),
		).toEqual(['America/New_York', 'Europe/London']);
	});

	it('reads no name of such a parameter that the test refuses', () => {
		const calendar: JCalComponent = [
			'vcalendar',
			[],
			[
				[
					'vevent',
					[
						[
							'dtstart',
							{ tzid: ['America/New_York', 'Mars/Olympus'] },
							'date-time',
							'2026-03-02T09:00:00',
						],
					],
					[],
				],
			],
		];
		expect(referencedZones(calendar, holdsNewYork)).toEqual([
			'America/New_York',
		]);
	});
});

describe('the definitions that one name states', () => {
	const DEFINED = calendarOf(
		'BEGIN:VTIMEZONE',
		'TZID:America/New_York',
		'BEGIN:STANDARD',
		'DTSTART:20071104T020000',
		'TZOFFSETFROM:-0400',
		'TZOFFSETTO:-0500',
		'END:STANDARD',
		'END:VTIMEZONE',
		'BEGIN:VEVENT',
		'UID:one',
		'DTSTART;TZID=America/New_York:20260302T090000',
		'END:VEVENT',
	);

	it('gives back the definition of that name', () => {
		const found = definitionsOf(DEFINED, 'America/New_York');
		expect(found).toHaveLength(1);
		expect(found[0]?.[0]).toBe('vtimezone');
	});

	it('gives back nothing for a name that no definition states', () => {
		expect(definitionsOf(DEFINED, 'Mars/Olympus')).toEqual([]);
	});
});
