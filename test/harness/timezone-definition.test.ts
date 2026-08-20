import { describe, expect, it } from 'vitest';
import type { JCalComponent } from '../../src/core/ics/jcal';
import { serializeCalendar } from '../../src/core/ics/serializer';
import {
	definitionChanges,
	definitionOffset,
	textInComponentOrder,
	valueOf,
} from './timezone-definition';

const OBSERVANCE: JCalComponent = [
	'standard',
	[
		['dtstart', {}, 'date-time', '1970-01-01T00:00:00'],
		['tzname', {}, 'text', 'AAA'],
		['tzoffsetfrom', {}, 'utc-offset', '+00:00'],
		['tzoffsetto', {}, 'utc-offset', '+00:00'],
	],
	[],
];

/** One zone that steps forward every March and back every October. */
const DEFINITION: JCalComponent = [
	'vtimezone',
	[['tzid', {}, 'text', 'Test/Zone']],
	[
		[
			'daylight',
			[
				['dtstart', {}, 'date-time', '2020-03-29T01:00:00'],
				[
					'rrule',
					{},
					'recur',
					{ freq: 'YEARLY', byday: '-1SU', bymonth: 3 },
				],
				['tzname', {}, 'text', 'BBB'],
				['tzoffsetfrom', {}, 'utc-offset', '+00:00'],
				['tzoffsetto', {}, 'utc-offset', '+01:00'],
			],
			[],
		],
		OBSERVANCE,
		[
			'standard',
			[
				['dtstart', {}, 'date-time', '2020-10-25T02:00:00'],
				[
					'rrule',
					{},
					'recur',
					{ freq: 'YEARLY', byday: '-1SU', bymonth: 10 },
				],
				['tzname', {}, 'text', 'AAA'],
				['tzoffsetfrom', {}, 'utc-offset', '+01:00'],
				['tzoffsetto', {}, 'utc-offset', '+00:00'],
			],
			[],
		],
	],
];

describe('the text of a component in its own order', () => {
	it('agrees with the canonical text where the component is canonical', () => {
		expect(textInComponentOrder(DEFINITION)).toBe(
			serializeCalendar(DEFINITION),
		);
	});

	it('differs from the canonical text where the component is not', () => {
		const moved: JCalComponent = [
			'vtimezone',
			DEFINITION[1],
			[...DEFINITION[2]].reverse(),
		];
		expect(textInComponentOrder(moved)).not.toBe(serializeCalendar(moved));
	});
});

describe('the changes that a definition states', () => {
	const read = definitionChanges(DEFINITION, 2022);

	it('reads the offset before the first change', () => {
		expect(read.initial).toBe(0);
	});

	it('expands the repeat rule of each observance up to the given year', () => {
		expect(read.changes.map((change) => change.at)).toEqual([
			Date.UTC(1970, 0, 1) / 1000,
			Date.UTC(2020, 2, 29, 1) / 1000,
			Date.UTC(2020, 9, 25, 1) / 1000,
			Date.UTC(2021, 2, 28, 1) / 1000,
			Date.UTC(2021, 9, 31, 1) / 1000,
			Date.UTC(2022, 2, 27, 1) / 1000,
			Date.UTC(2022, 9, 30, 1) / 1000,
		]);
	});

	it('gives the offset that stands at one instant', () => {
		expect(definitionOffset(read, Date.UTC(2021, 5, 1) / 1000)).toBe(3600);
		expect(definitionOffset(read, Date.UTC(2021, 11, 1) / 1000)).toBe(0);
		expect(definitionOffset(read, -1)).toBe(0);
	});
});

describe('the value of one property', () => {
	it('gives the value as a string', () => {
		expect(valueOf(OBSERVANCE[1], 'tzname')).toBe('AAA');
	});

	it('refuses a property that the observance does not hold', () => {
		expect(() => valueOf(OBSERVANCE[1], 'rrule')).toThrow(
			'the observance holds no rrule',
		);
	});
});
