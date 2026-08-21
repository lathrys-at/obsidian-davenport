/**
 * A property test says nothing when its generator draws nothing hard. A
 * generator that only ever drew the letter a would make every round-trip
 * rule pass, and the suite would report success over an empty search.
 *
 * These cases read a sample of the generators and ask what the sample
 * covers. They also hold the three limits that the generators state at
 * their head: a name in lower case, a list of values only where the format
 * states a list, and a parameter value without the characters that the
 * boundary reads wrongly today.
 */

import { describe, expect, it } from 'vitest';
import { ICS_FOLD_OCTET_LIMIT } from '../../../src/core/ics/fold';
import { octetLength } from '../ics-octets';
import {
	PROPERTY_SHAPES,
	foldEdgeText,
	icsCalendar,
	icsListParameterValue,
	icsParameters,
	icsProperty,
	icsRecur,
	icsTextValue,
	listParameterNames,
	listPropertyNames,
} from './ics-model';
import { samples } from './seed';

const SAMPLE = 600;

/** The characters that a text value must reach over a sample. */
const REACHED_CHARACTERS: readonly string[] = [
	',',
	';',
	'\\',
	'\n',
	'"',
	'^',
	'\t',
	':',
	'é',
	'☃',
	'😀',
	'\uFEFF',
	'\uD800',
];

describe('the text values of a calendar', () => {
	const drawn = samples(icsTextValue(), SAMPLE);

	it.each(REACHED_CHARACTERS)('reaches the character %j', (character) => {
		expect(drawn.some((value) => value.includes(character))).toBe(true);
	});

	it('reaches a value that needs no fold and one that needs a fold', () => {
		const widths = drawn.map(octetLength);
		expect(widths.some((width) => width < ICS_FOLD_OCTET_LIMIT)).toBe(true);
		expect(widths.some((width) => width > ICS_FOLD_OCTET_LIMIT)).toBe(true);
	});

	it('reaches an empty value', () => {
		expect(drawn).toContain('');
	});
});

describe('the value that walks the place of a fold', () => {
	const drawn = samples(foldEdgeText(), SAMPLE);

	it('puts a hard character on each side of the octet limit', () => {
		const before = drawn.filter(
			(value) => octetLength(value) < ICS_FOLD_OCTET_LIMIT,
		);
		const after = drawn.filter(
			(value) => octetLength(value) > ICS_FOLD_OCTET_LIMIT * 2,
		);
		expect(before.length).toBeGreaterThan(0);
		expect(after.length).toBeGreaterThan(0);
	});

	it('pads with characters of one octet and of more than one', () => {
		expect(drawn.some((value) => value.includes('a'))).toBe(true);
		expect(
			drawn.some(
				(value) =>
					value.includes('😀') ||
					value.includes('☃') ||
					value.includes('é'),
			),
		).toBe(true);
	});
});

describe('the properties of a calendar', () => {
	const drawn = samples(icsProperty(), SAMPLE);

	it('draws every shape that the list holds', () => {
		const seen = new Set(drawn.map((property) => property[0]));
		for (const shape of PROPERTY_SHAPES) {
			expect(seen.has(shape.name)).toBe(true);
		}
	});

	it('writes every name in lower case', () => {
		for (const property of drawn) {
			expect(property[0]).toBe(property[0].toLowerCase());
		}
	});

	it('gives every property the value type of its shape', () => {
		const types = new Map(
			PROPERTY_SHAPES.map((shape) => [shape.name, shape.type]),
		);
		for (const property of drawn) {
			expect(property[2]).toBe(types.get(property[0]));
		}
	});

	it('gives more than one value only to a property of a list', () => {
		for (const property of drawn) {
			if (property.length > 4) {
				expect(listPropertyNames()).toContain(property[0]);
			}
		}
	});

	it('reaches a property that carries more than one value', () => {
		expect(drawn.some((property) => property.length > 4)).toBe(true);
	});
});

describe('the parameters of a property', () => {
	const drawn = samples(icsParameters(), SAMPLE);
	const entries = drawn.flatMap((parameters) => Object.entries(parameters));

	it('gives a list of values only to a parameter of a list', () => {
		for (const [name, value] of entries) {
			if (Array.isArray(value)) {
				expect(listParameterNames()).toContain(name);
				expect(value.length).toBeGreaterThan(1);
			}
		}
	});

	it('reaches a parameter that carries a list of values', () => {
		expect(entries.some(([, value]) => Array.isArray(value))).toBe(true);
	});

	it('reaches a zone of the bundled table', () => {
		expect(entries.some(([name]) => name === 'tzid')).toBe(true);
	});

	it('never names the parameter that states the value type', () => {
		expect(entries.some(([name]) => name === 'value')).toBe(false);
	});
});

describe('the value of a parameter that carries a list', () => {
	const drawn = samples(icsListParameterValue(), SAMPLE);

	it('holds no colon and no quotation mark', () => {
		for (const value of drawn) {
			expect(value.includes(':')).toBe(false);
			expect(value.includes('"')).toBe(false);
		}
	});

	it('still reaches a comma and a semicolon', () => {
		expect(drawn.some((value) => value.includes(','))).toBe(true);
		expect(drawn.some((value) => value.includes(';'))).toBe(true);
	});
});

describe('the parts of a repeat rule', () => {
	const drawn = samples(icsRecur(), SAMPLE);

	it('always states the frequency', () => {
		for (const recur of drawn) {
			expect(typeof recur.freq).toBe('string');
		}
	});

	it('reaches a part that holds one value and a part that holds a list', () => {
		const positions = drawn.map((recur) => recur.bysetpos);
		expect(positions.some((value) => typeof value === 'number')).toBe(true);
		expect(
			positions.some((value) => Array.isArray(value) && value.length > 1),
		).toBe(true);
	});

	it('reaches a part that no standard names', () => {
		expect(drawn.some((recur) => 'x-vendor-part' in recur)).toBe(true);
	});
});

describe('a whole calendar', () => {
	const drawn = samples(icsCalendar(), 200);

	it('always names the calendar and states its version', () => {
		for (const calendar of drawn) {
			expect(calendar[0]).toBe('vcalendar');
			expect(calendar[1][0]).toEqual(['version', {}, 'text', '2.0']);
		}
	});

	it('reaches a calendar that holds a component inside a component', () => {
		expect(
			drawn.some((calendar) =>
				calendar[2].some((child) => child[2].length > 0),
			),
		).toBe(true);
	});

	it('reaches a calendar that holds no component at all', () => {
		expect(drawn.some((calendar) => calendar[2].length === 0)).toBe(true);
	});
});
