import ICAL from 'ical.js';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
	JCalComponent,
	JCalParameters,
	JCalProperty,
	JCalRecur,
	JCalValue,
} from './jcal';
import { jcalListLength, jcalValues, readJCalComponent } from './jcal';

const TEXT = [
	'BEGIN:VCALENDAR',
	'VERSION:2.0',
	'PRODID:-//Davenport//parse boundary//EN',
	'BEGIN:VEVENT',
	'UID:jcal-test',
	'DTSTART;TZID=Europe/Paris:20260101T090000',
	'GEO:46.181;6.156',
	'RRULE:FREQ=WEEKLY;BYDAY=MO,TU',
	'ATTENDEE;MEMBER="a","b":mailto:someone@example.test',
	'END:VEVENT',
	'END:VCALENDAR',
	'',
].join('\r\n');

function parsed(): unknown {
	return ICAL.parse(TEXT);
}

function acceptedComponent(): JCalComponent {
	const reading = readJCalComponent(parsed());
	if (!reading.ok) {
		throw new Error(`the read refused a real parse: ${reading.problem}`);
	}
	return reading.component;
}

describe('the read of a jCal component', () => {
	it('accepts what the library produces', () => {
		const component = acceptedComponent();
		expect(component[0]).toBe('vcalendar');
		expect(component[2][0]?.[0]).toBe('vevent');
	});

	it('gives back the structure that it received', () => {
		expect(acceptedComponent()).toEqual(parsed());
	});

	it('accepts a parameter that carries a list of values', () => {
		const event = acceptedComponent()[2][0];
		const attendee = event?.[1].find(
			(property) => property[0] === 'attendee',
		);
		expect(attendee?.[1].member).toEqual(['a', 'b']);
	});

	it('accepts a structured value and a repeat rule', () => {
		const event = acceptedComponent()[2][0];
		const names = event?.[1].map((property) => property[0]);
		expect(names).toContain('geo');
		expect(names).toContain('rrule');
	});
});

// Every row is a structure that jCal does not use. The read names the
// part that disagrees. Each row therefore carries the words that the
// message of that row must hold.
const MALFORMED: [string, unknown, string][] = [
	['a string', 'BEGIN:VCALENDAR', 'not an array'],
	['a number', 7, 'not an array'],
	['null', null, 'not an array'],
	['an object', { name: 'vcalendar' }, 'not an array'],
	['an array of two items', ['vcalendar', []], 'not three'],
	['an array of four items', ['vcalendar', [], [], []], 'not three'],
	['a name that is not a string', [1, [], []], 'the name of'],
	[
		'properties that are not an array',
		['vcalendar', {}, []],
		'the properties of',
	],
	[
		'components that are not an array',
		['vcalendar', [], {}],
		'the components of',
	],
	[
		'a property that is not an array',
		['vcalendar', ['version'], []],
		'is not an array',
	],
	[
		'a property of two items',
		['vcalendar', [['version', {}]], []],
		'fewer than three items',
	],
	[
		'a property name that is not a string',
		['vcalendar', [[1, {}, 'text', '2.0']], []],
		'the name of',
	],
	[
		'a value type that is not a string',
		['vcalendar', [['version', {}, 2, '2.0']], []],
		'the value type of',
	],
	[
		'parameters that are not an object',
		['vcalendar', [['version', [], 'text', '2.0']], []],
		'the parameters of',
	],
	[
		'a parameter that is a number',
		['vcalendar', [['version', { tzid: 5 }, 'text', '2.0']], []],
		'the parameter tzid of',
	],
	[
		'a parameter list that holds a number',
		['vcalendar', [['version', { member: ['a', 2] }, 'text', '2.0']], []],
		'the parameter member of',
	],
	[
		'a value that is null',
		['vcalendar', [['version', {}, 'text', null]], []],
		'a shape that jCal does not use',
	],
	[
		'a structured value that holds null',
		['vcalendar', [['geo', {}, 'float', [1, null]]], []],
		'a shape that jCal does not use',
	],
	[
		'a repeat rule with a part that is an object',
		['vcalendar', [['rrule', {}, 'recur', { freq: {} }]], []],
		'a shape that jCal does not use',
	],
	[
		'a component inside that is not an array',
		['vcalendar', [], ['vevent']],
		'component 1 of',
	],
	[
		'a property inside a component that is not an array',
		['vcalendar', [], [['vevent', ['uid'], []]]],
		'is not an array',
	],
];

describe('the read of a structure that jCal does not use', () => {
	it.each(MALFORMED)('refuses %s', (_name, value, hint) => {
		const reading = readJCalComponent(value);
		expect(reading.ok).toBe(false);
		if (reading.ok) {
			return;
		}
		expect(reading.problem).toContain(hint);
	});
});

describe('the length of a list of components', () => {
	it('gives null for one component', () => {
		expect(jcalListLength(parsed())).toBeNull();
	});

	it('gives the count for a list of components', () => {
		const two: unknown = ICAL.parse(TEXT + TEXT);
		expect(jcalListLength(two)).toBe(2);
	});

	it('gives zero for a text that holds no calendar', () => {
		expect(jcalListLength(ICAL.parse(''))).toBe(0);
	});

	it('gives null for a value that is not an array', () => {
		expect(jcalListLength('BEGIN:VCALENDAR')).toBeNull();
		expect(jcalListLength(null)).toBeNull();
		expect(jcalListLength({ length: 2 })).toBeNull();
	});
});

describe('the values of a property', () => {
	it('leaves out the name, the parameters and the value type', () => {
		const property: JCalProperty = ['categories', {}, 'text', 'a', 'b'];
		expect(jcalValues(property)).toEqual(['a', 'b']);
	});

	it('gives an empty list for a property that carries no value', () => {
		const property: JCalProperty = ['x-empty', {}, 'text'];
		expect(jcalValues(property)).toEqual([]);
	});
});

describe('the types that the engine owns for jCal', () => {
	it('states the shape of a component and of a property', () => {
		expectTypeOf<JCalComponent>().toEqualTypeOf<
			readonly [
				name: string,
				properties: readonly JCalProperty[],
				components: readonly JCalComponent[],
			]
		>();
		expectTypeOf(jcalValues).returns.toEqualTypeOf<readonly JCalValue[]>();
	});

	it('refuses a component that holds the wrong count of items', () => {
		expectTypeOf<
			readonly [string, readonly JCalProperty[]]
		>().not.toExtend<JCalComponent>();
		expectTypeOf<
			readonly [
				string,
				readonly JCalProperty[],
				readonly JCalComponent[],
				string,
			]
		>().not.toExtend<JCalComponent>();
	});

	it('refuses a component whose parts hold the wrong types', () => {
		expectTypeOf<
			readonly [number, readonly JCalProperty[], readonly JCalComponent[]]
		>().not.toExtend<JCalComponent>();
		expectTypeOf<
			readonly [string, readonly string[], readonly JCalComponent[]]
		>().not.toExtend<JCalComponent>();
	});

	it('refuses a property that holds fewer than three items', () => {
		expectTypeOf<
			readonly [string, JCalParameters]
		>().not.toExtend<JCalProperty>();
		expectTypeOf<
			readonly [string, JCalParameters, number, string]
		>().not.toExtend<JCalProperty>();
	});

	it('refuses a value and a parameter of a shape that jCal does not use', () => {
		expectTypeOf<null>().not.toExtend<JCalValue>();
		expectTypeOf<undefined>().not.toExtend<JCalValue>();
		expectTypeOf<() => void>().not.toExtend<JCalValue>();
		expectTypeOf<readonly [null]>().not.toExtend<JCalValue>();
		expectTypeOf<
			Readonly<Record<string, number>>
		>().not.toExtend<JCalParameters>();
		expectTypeOf<
			Readonly<Record<string, boolean>>
		>().not.toExtend<JCalRecur>();
	});

	it('accepts the values that jCal uses', () => {
		expectTypeOf<string>().toExtend<JCalValue>();
		expectTypeOf<number>().toExtend<JCalValue>();
		expectTypeOf<boolean>().toExtend<JCalValue>();
		expectTypeOf<readonly JCalValue[]>().toExtend<JCalValue>();
		expectTypeOf<JCalRecur>().toExtend<JCalValue>();
	});
});
