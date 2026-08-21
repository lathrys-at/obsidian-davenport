/**
 * Generators of iCalendar structures for the property tests.
 *
 * A property test needs many inputs, and it needs each input to be legal.
 * An illegal input makes the parse boundary refuse, and a refusal proves
 * nothing about a round trip. This module therefore draws only structures
 * that the parse boundary accepts.
 *
 * The engine holds a calendar as a jCal structure: a component is the name,
 * the properties, and the components inside it. A property is the name, the
 * parameters, the name of the value type, and then the values. The
 * generators below build that structure directly, so a test can start from
 * a model and go to text, and not only the other way.
 *
 * The generators keep to the forms that the parse boundary produces. The
 * type of a jCal structure is wider than those forms, and a structure
 * outside them is not a calendar that a server ever sent. Three limits
 * follow from that, and each one has a reason:
 *
 * - A property name and a parameter name are in lower case. The parser
 *   writes both names in lower case, so a name in another case never
 *   reaches the engine.
 * - Only a property that the format lists as a list of values takes more
 *   than one value. For every other name the library writes the first value
 *   and drops the rest.
 * - Only a parameter that the format lists as a list of values takes an
 *   array. For every other name the library expects one string, and it
 *   throws on an array.
 *
 * The values carry the details that make a reader or a writer of the format
 * fail. The text values hold the characters that need an escape, the
 * characters that need more than one octet, and runs that are long enough
 * to make the writer fold a line. The `foldEdgeText` generator walks a hard
 * character past the fold boundary one position at a time, so a fold falls
 * inside an escape sequence and inside a character of several octets.
 *
 * Some forms stay out of the values. The first two leave for a reason that
 * belongs to the format and not to this engine:
 *
 * - A carriage return in a text value. The library writes no escape for it,
 *   so the character ends the line and the text stops being one property.
 * - A backslash in a parameter value. The library reads a backslash and the
 *   letter n in a parameter value as a line break. The value that comes
 *   back then differs from the value that went in, and the difference
 *   belongs to the library.
 *
 * The rest leave because the boundary reads them wrongly today. Each one
 * has a case in `test/properties/ics/known-defects.test.ts`, and the
 * comment at the generator names the case. A backslash at the end of one
 * value of a property that carries several is one of them, and a colon or a
 * quotation mark in a parameter that carries a list of values is another.
 */

import fc from 'fast-check';
import type {
	JCalComponent,
	JCalParameters,
	JCalProperty,
	JCalRecur,
	JCalValue,
} from '../../../src/core/ics/jcal';
import { timezoneNames } from '../../../src/core/timezone/table';

/** How many values a property carries. */
export type ValueCount = 'one' | 'many' | 'structured';

/** One kind of property that the generators draw. */
export interface IcsPropertyShape {
	/** The name of the property, in lower case. */
	readonly name: string;
	/** The name of the value type, as the parser reports it. */
	readonly type: string;
	readonly count: ValueCount;
}

/**
 * The characters that make a value hard to write and hard to read again.
 * Each one either needs an escape, or needs more than one octet, or sits at
 * the edge of what the format permits.
 */
const HARD_CHARACTERS: readonly string[] = [
	',',
	';',
	'\\',
	'\n',
	'"',
	'^',
	'\t',
	':',
	'=',
	'é',
	'☃',
	'😀',
	'👩‍👩‍👦',
	'\uFEFF',
	'\uD800',
];

/**
 * The characters that a value holds beside the hard ones. A short list
 * keeps the drawn values readable in a failure report.
 */
const PLAIN_CHARACTERS: readonly string[] = [
	'a',
	'b',
	'Z',
	'0',
	'9',
	' ',
	'-',
	'/',
	'@',
];

/** The names of the properties that the format states as a list of values. */
const LIST_PROPERTIES: readonly string[] = [
	'categories',
	'resources',
	'exdate',
	'rdate',
	'freebusy',
];

/** The parameters that the format states as a list of values. */
const LIST_PARAMETERS: readonly string[] = [
	'member',
	'delegated-from',
	'delegated-to',
];

/** The parameters that carry one value each. */
const PLAIN_PARAMETERS: readonly string[] = [
	'cutype',
	'encoding',
	'fbtype',
	'partstat',
	'range',
	'related',
	'reltype',
	'role',
	'rsvp',
	'sent-by',
	'x-vendor',
	'x-1',
	'x-long-parameter-name',
];

/**
 * Every kind of property that the generators draw. The list covers each
 * value type that the parse boundary states a lexical rule for, and it
 * covers the three counts of values.
 */
export const PROPERTY_SHAPES: readonly IcsPropertyShape[] = [
	{ name: 'summary', type: 'text', count: 'one' },
	{ name: 'description', type: 'text', count: 'one' },
	{ name: 'location', type: 'text', count: 'one' },
	{ name: 'comment', type: 'text', count: 'one' },
	{ name: 'uid', type: 'text', count: 'one' },
	{ name: 'categories', type: 'text', count: 'many' },
	{ name: 'resources', type: 'text', count: 'many' },
	{ name: 'request-status', type: 'text', count: 'structured' },
	{ name: 'x-vendor-thing', type: 'unknown', count: 'one' },
	{ name: 'x-1-digit-start', type: 'unknown', count: 'one' },
	{ name: 'x-vendor-text', type: 'text', count: 'one' },
	{ name: 'dtstart', type: 'date-time', count: 'one' },
	{ name: 'dtend', type: 'date-time', count: 'one' },
	{ name: 'x-day', type: 'date', count: 'one' },
	{ name: 'exdate', type: 'date-time', count: 'many' },
	{ name: 'duration', type: 'duration', count: 'one' },
	{ name: 'trigger', type: 'duration', count: 'one' },
	{ name: 'freebusy', type: 'period', count: 'many' },
	{ name: 'tzoffsetfrom', type: 'utc-offset', count: 'one' },
	{ name: 'tzoffsetto', type: 'utc-offset', count: 'one' },
	{ name: 'x-clock', type: 'time', count: 'one' },
	{ name: 'priority', type: 'integer', count: 'one' },
	{ name: 'sequence', type: 'integer', count: 'one' },
	{ name: 'geo', type: 'float', count: 'structured' },
	{ name: 'x-measure', type: 'float', count: 'one' },
	{ name: 'x-flag', type: 'boolean', count: 'one' },
	{ name: 'attach', type: 'uri', count: 'one' },
	{ name: 'organizer', type: 'cal-address', count: 'one' },
	{ name: 'rrule', type: 'recur', count: 'one' },
];

/** The components that a calendar holds, and the components inside them. */
const INNER_COMPONENTS: readonly string[] = [
	'vevent',
	'vtodo',
	'vjournal',
	'valarm',
	'vtimezone',
	'x-vendor-component',
];

/** The components that stand inside another component. */
const NESTED_COMPONENTS: readonly string[] = [
	'valarm',
	'standard',
	'daylight',
	'x-vendor-inner',
];

/** A run of plain characters, from nothing up to the given length. */
function plainRun(maxLength: number): fc.Arbitrary<string> {
	return fc
		.array(fc.constantFrom(...PLAIN_CHARACTERS), { maxLength })
		.map((parts) => parts.join(''));
}

/**
 * A text value that puts one hard character at a chosen distance from the
 * start of the line. The writer folds a line past the octet limit, and the
 * distance therefore walks the hard character across the place of a fold.
 * The padding character decides how many octets each step adds, so the walk
 * meets the boundary at every alignment.
 */
export function foldEdgeText(): fc.Arbitrary<string> {
	return fc
		.tuple(
			fc.nat({ max: 160 }),
			fc.constantFrom('a', 'é', '☃', '😀'),
			fc.constantFrom(...HARD_CHARACTERS),
			fc.nat({ max: 6 }),
		)
		.map(
			([before, padding, hard, after]) =>
				padding.repeat(before) + hard + padding.repeat(after),
		);
}

/** A text value, as a property of the type `text` carries it. */
export function icsTextValue(): fc.Arbitrary<string> {
	return fc.oneof(
		{ arbitrary: freeText(), weight: 3 },
		{ arbitrary: foldEdgeText(), weight: 2 },
		{ arbitrary: fc.constant(''), weight: 1 },
	);
}

function freeText(): fc.Arbitrary<string> {
	return fc
		.array(
			fc.oneof(
				{
					arbitrary: fc.constantFrom(...PLAIN_CHARACTERS),
					weight: 3,
				},
				{ arbitrary: fc.constantFrom(...HARD_CHARACTERS), weight: 2 },
			),
			{ maxLength: 40 },
		)
		.map((parts) => parts.join(''));
}

/**
 * A value that the library writes without an escape. The value therefore
 * holds no line break and no other control character, because such a
 * character would end the line.
 */
export function icsPlainValue(): fc.Arbitrary<string> {
	return fc
		.array(
			fc.constantFrom(
				...PLAIN_CHARACTERS,
				...HARD_CHARACTERS.filter(
					(character) => character !== '\n' && character !== '\t',
				),
			),
			{ maxLength: 40 },
		)
		.map((parts) => parts.join(''));
}

/** A parameter value. A backslash stays out, for the reason at the head. */
export function icsParameterValue(): fc.Arbitrary<string> {
	return parameterCharacters(
		HARD_CHARACTERS.filter((character) => character !== '\\'),
	);
}

/**
 * One value of a parameter that carries a list of values. Two characters
 * stay out of these values, and the file `known-defects.test.ts` holds a
 * case for each one. A colon in the last value of such a list makes the
 * parse boundary read the wrong value for the whole property. A quotation
 * mark beside a comma makes the boundary report parameter values that the
 * text does not state.
 */
export function icsListParameterValue(): fc.Arbitrary<string> {
	return parameterCharacters(
		HARD_CHARACTERS.filter(
			(character) =>
				character !== '\\' && character !== ':' && character !== '"',
		),
	);
}

function parameterCharacters(hard: readonly string[]): fc.Arbitrary<string> {
	return fc
		.array(fc.constantFrom(...PLAIN_CHARACTERS, ...hard), { maxLength: 24 })
		.map((parts) => parts.join(''));
}

function twoDigits(value: number): string {
	return String(value).padStart(2, '0');
}

/** A civil date, in the form that the parser reports. */
export function icsDate(): fc.Arbitrary<string> {
	return fc
		.tuple(
			fc.integer({ min: 1900, max: 2099 }),
			fc.integer({ min: 1, max: 12 }),
			fc.integer({ min: 1, max: 28 }),
		)
		.map(
			([year, month, day]) =>
				`${String(year)}-${twoDigits(month)}-${twoDigits(day)}`,
		);
}

/** A date and a time of day, in the form that the parser reports. */
export function icsDateTime(): fc.Arbitrary<string> {
	return fc
		.tuple(icsDate(), icsTime(), fc.boolean())
		.map(([date, time, utc]) => `${date}T${time}${utc ? 'Z' : ''}`);
}

/** A time of day, without the mark of universal time. */
export function icsTime(): fc.Arbitrary<string> {
	return fc
		.tuple(
			fc.integer({ min: 0, max: 23 }),
			fc.integer({ min: 0, max: 59 }),
			fc.integer({ min: 0, max: 59 }),
		)
		.map(
			([hour, minute, second]) =>
				`${twoDigits(hour)}:${twoDigits(minute)}:${twoDigits(second)}`,
		);
}

/** A length of time, in the form that the format states. */
export function icsDuration(): fc.Arbitrary<string> {
	const count = fc.integer({ min: 1, max: 999 });
	const clock = fc
		.tuple(fc.option(count), fc.option(count), fc.option(count))
		.filter(([hours, minutes, seconds]) =>
			[hours, minutes, seconds].some((part) => part !== null),
		)
		.map(([hours, minutes, seconds]) => {
			// The format states the parts in one order, and it permits a
			// part to stand only when every part above it stands.
			if (hours !== null) {
				const rest =
					minutes === null
						? ''
						: `${String(minutes)}M${seconds === null ? '' : `${String(seconds)}S`}`;
				return `${String(hours)}H${rest}`;
			}
			if (minutes !== null) {
				return `${String(minutes)}M${seconds === null ? '' : `${String(seconds)}S`}`;
			}
			return `${String(seconds ?? 1)}S`;
		});
	const body = fc.oneof(
		count.map((weeks) => `${String(weeks)}W`),
		fc
			.tuple(count, fc.option(clock))
			.map(
				([days, time]) =>
					`${String(days)}D${time === null ? '' : `T${time}`}`,
			),
		clock.map((time) => `T${time}`),
	);
	return fc
		.tuple(fc.constantFrom('', '-', '+'), body)
		.map(([sign, text]) => `${sign}P${text}`);
}

/** An offset from universal time, in the form that the parser reports. */
export function icsUtcOffset(): fc.Arbitrary<string> {
	return fc
		.tuple(
			fc.constantFrom('+', '-'),
			fc.integer({ min: 0, max: 14 }),
			fc.integer({ min: 0, max: 59 }),
			fc.option(fc.integer({ min: 1, max: 59 })),
		)
		.filter(
			([sign, hours, minutes, seconds]) =>
				sign === '+' || hours > 0 || minutes > 0 || seconds !== null,
		)
		.map(
			([sign, hours, minutes, seconds]) =>
				`${sign}${twoDigits(hours)}:${twoDigits(minutes)}${
					seconds === null ? '' : `:${twoDigits(seconds)}`
				}`,
		);
}

/**
 * A whole number that keeps its digits. The library holds a number in the
 * number type of the language, and that type writes a number of twenty-one
 * digits or more with an exponent. The parse boundary refuses such text.
 */
export function icsInteger(): fc.Arbitrary<number> {
	return fc.integer({ min: -1_000_000_000, max: 1_000_000_000 });
}

/**
 * A number with a decimal point that keeps its digits. The generator builds
 * the number from a whole number, so the text never carries an exponent.
 */
export function icsFloat(): fc.Arbitrary<number> {
	return fc
		.integer({ min: -1_000_000, max: 1_000_000 })
		.map((value) => value / 100);
}

/** A span of time, from a start to an end or to a length of time. */
export function icsPeriod(): fc.Arbitrary<readonly JCalValue[]> {
	const instant = fc
		.tuple(icsDate(), icsTime())
		.map(([date, time]) => `${date}T${time}Z`);
	return fc
		.tuple(instant, fc.oneof(instant, icsDuration()))
		.map(([start, end]) => [start, end]);
}

/**
 * A part of a repeat rule that takes a list. The library reports one value
 * as a value, and it reports two or more values as a list. It also joins
 * two equal values into one. A list of one value, and a list that repeats a
 * value, therefore never come out of a parse.
 */
function rulePartList<T>(item: fc.Arbitrary<T>): fc.Arbitrary<T | T[]> {
	return fc.oneof<fc.Arbitrary<T | T[]>[]>(
		item,
		fc.uniqueArray(item, { minLength: 2, maxLength: 3 }),
	);
}

/** A repeat rule, with the parts that the format states. */
export function icsRecur(): fc.Arbitrary<JCalRecur> {
	const weekday = fc.constantFrom('SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA');
	// A position of zero selects nothing, and the library cannot read it.
	const dayItem = fc
		.tuple(
			fc.option(
				fc
					.integer({ min: -53, max: 52 })
					.map((value) => (value < 0 ? value : value + 1)),
			),
			weekday,
		)
		.map(([position, day]) =>
			position === null ? day : `${String(position)}${day}`,
		);
	return fc
		.record(
			{
				freq: fc.constantFrom(
					'SECONDLY',
					'MINUTELY',
					'HOURLY',
					'DAILY',
					'WEEKLY',
					'MONTHLY',
					'YEARLY',
				),
				until: fc.oneof(icsDate(), icsDateTime()),
				count: fc.integer({ min: 1, max: 999 }),
				interval: fc.integer({ min: 1, max: 999 }),
				byday: rulePartList(dayItem),
				bymonth: rulePartList(fc.integer({ min: 1, max: 12 })),
				bysetpos: rulePartList(fc.integer({ min: -366, max: 366 })),
				// The library holds the start of the week as a number, and
				// the numbers run from one for Sunday to seven for Saturday.
				wkst: fc.integer({ min: 1, max: 7 }),
				// A rule part that no standard names keeps its text. The
				// value holds no separator of the format, because such a
				// character would end the part or the rule.
				'x-vendor-part': plainRun(8),
			},
			{
				requiredKeys: ['freq'],
			},
		)
		.map((recur) => recur as JCalRecur);
}

/**
 * A text value that stands beside another value of the same property. Such
 * a value never ends with a backslash. The library reads the escape of a
 * backslash at the end of a value together with the separator that follows
 * it, and it then reports one value where the text states two. The test
 * file `known-defects.test.ts` holds that case.
 */
function neighbouringText(): fc.Arbitrary<string> {
	return icsTextValue().filter((value) => !value.endsWith('\\'));
}

/** The values of a property of this shape. */
function valuesOf(shape: IcsPropertyShape): fc.Arbitrary<readonly JCalValue[]> {
	if (shape.type === 'period') {
		return listOf(icsPeriod());
	}
	if (shape.count === 'structured') {
		return shape.type === 'float'
			? fc.tuple(icsFloat(), icsFloat()).map((pair) => [pair])
			: fc
					.array(neighbouringText(), { minLength: 2, maxLength: 3 })
					.map((parts) => [parts]);
	}
	if (shape.count === 'many') {
		return listOf(
			shape.type === 'text'
				? neighbouringText()
				: singleValue(shape.type),
		);
	}
	return singleValue(shape.type).map((value) => [value]);
}

/**
 * One value, or a list of values. A property that the format states as a
 * list still carries one value when the text writes one.
 */
function listOf(item: fc.Arbitrary<JCalValue>): fc.Arbitrary<JCalValue[]> {
	return fc.array(item, { minLength: 1, maxLength: 3 });
}

function singleValue(type: string): fc.Arbitrary<JCalValue> {
	switch (type) {
		case 'text':
			return icsTextValue();
		case 'date':
			return icsDate();
		case 'date-time':
			return icsDateTime();
		case 'time':
			return icsTime();
		case 'duration':
			return icsDuration();
		case 'utc-offset':
			return icsUtcOffset();
		case 'integer':
			return icsInteger();
		case 'float':
			return icsFloat();
		case 'boolean':
			return fc.boolean();
		case 'recur':
			return icsRecur();
		default:
			return icsPlainValue();
	}
}

/** The parameters of one property. */
export function icsParameters(): fc.Arbitrary<JCalParameters> {
	const plain = fc.tuple(
		fc.constantFrom(...PLAIN_PARAMETERS),
		icsParameterValue(),
	);
	const list = fc.tuple(
		fc.constantFrom(...LIST_PARAMETERS),
		fc.array(icsListParameterValue(), { minLength: 2, maxLength: 3 }),
	);
	const zone = fc
		.constantFrom(...timezoneNames())
		.map((name) => ['tzid', name] as const);
	return fc
		.array(fc.oneof(plain, list, zone), { maxLength: 3 })
		.map((entries) => Object.fromEntries(entries) as JCalParameters);
}

/** One property, with its parameters and its values. */
export function icsProperty(): fc.Arbitrary<JCalProperty> {
	return fc
		.constantFrom(...PROPERTY_SHAPES)
		.chain((shape) =>
			fc
				.tuple(icsParameters(), valuesOf(shape))
				.map(([parameters, values]): JCalProperty => [
					shape.name,
					parameters,
					shape.type,
					...values,
				]),
		);
}

function componentOf(
	name: string,
	children: readonly string[],
	depth: number,
): fc.Arbitrary<JCalComponent> {
	const inside =
		depth === 0
			? fc.constant<readonly JCalComponent[]>([])
			: fc.array(
					fc
						.constantFrom(...children)
						.chain((child) => componentOf(child, [], depth - 1)),
					{ maxLength: 2 },
				);
	return fc
		.tuple(fc.array(icsProperty(), { maxLength: 4 }), inside)
		.map(([properties, components]): JCalComponent => [
			name,
			properties,
			components,
		]);
}

/**
 * A whole calendar. The calendar always states its version, because a
 * server always states it and a reader of a failure expects it.
 */
export function icsCalendar(): fc.Arbitrary<JCalComponent> {
	return fc
		.tuple(
			fc.array(icsProperty(), { maxLength: 3 }),
			fc.array(
				fc
					.constantFrom(...INNER_COMPONENTS)
					.chain((name) => componentOf(name, NESTED_COMPONENTS, 1)),
				{ maxLength: 3 },
			),
		)
		.map(([properties, components]): JCalComponent => [
			'vcalendar',
			[['version', {}, 'text', '2.0'], ...properties],
			components,
		]);
}

/** The names of the properties that carry a list of values. */
export function listPropertyNames(): readonly string[] {
	return LIST_PROPERTIES;
}

/** The names of the parameters that carry a list of values. */
export function listParameterNames(): readonly string[] {
	return LIST_PARAMETERS;
}
