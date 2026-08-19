/**
 * The canonical serializer of the engine: a pure function from iCalendar
 * text to iCalendar text.
 *
 * Two devices that hold the same server state must hold record files with
 * the same bytes. A provider can serialize the same event differently at
 * each fetch, so the text that arrives is not a stable form. This module
 * makes the stable form. The record stores the output of this module, and
 * that output is the base for the comparison of three versions and the
 * material for a round-trip patch.
 *
 * The serializer refuses every text that the parse boundary refuses. The
 * serializer never repairs a text.
 *
 * The work divides between the parse library and this module.
 *
 * - The library writes the case of a name. The library writes the escapes
 *   of a text value and of a parameter value. The library writes the
 *   quotation marks of a parameter value. The library writes the form of
 *   a number, of a date and of a time. The library drops a value type
 *   that is the default type of its property.
 * - This module decides the order of the properties of a component. It
 *   decides the order of the parameters of a property, the order of the
 *   components inside a component, and the order of the parts of a repeat
 *   rule. It also decides the width of a fold and the line break at the
 *   end of a line.
 *
 * The rules of the order:
 *
 * - The parameters of a property take the order of their names.
 * - The properties of a component take the order of their names. Two
 *   properties with the same name take the order of their two lines.
 * - The components inside a component take a fixed rank. A timezone
 *   definition comes first. Then come the components that hold an event,
 *   a task or a journal entry and that state no recurrence id. Then come
 *   the same kinds of component that state a recurrence id, in the order
 *   of those ids. Then come the alarms. Then come all the other
 *   components, in the order of their names. Two components of one rank
 *   and one name take the order of their two texts.
 * - The parts of a repeat rule take a fixed rank. The frequency comes
 *   first, except where the name of a part reads as a whole number. The
 *   other parts follow in the order that the format lists them. A part
 *   that no standard names comes after all of them, in the order of the
 *   names of those parts. The comment above `orderedParameters` states
 *   what a name that reads as a whole number does.
 * - A comparison of two names, or of two texts, reads the code units of
 *   the two strings. The comparison stops at the first code unit that
 *   differs. The order is therefore not the order of the code points: a
 *   character above U+FFFF stands below some characters below U+FFFF,
 *   because the first code unit of such a character is a surrogate. Every
 *   device applies the same rule, so the bytes stay the same on every
 *   device. No comparison asks the device for its language settings,
 *   because the answer differs from device to device.
 *
 * The serializer leaves four equivalences alone. Each item below names
 * two texts that hold one meaning and that keep different bytes.
 *
 * - The order of the values inside one property. `CATEGORIES:b,a` keeps
 *   the order that the server sent, because the other clients of the user
 *   show that order.
 * - One property that holds two values, beside two properties that hold
 *   one value each. `EXDATE:a,b` and `EXDATE:a` with `EXDATE:b` stay
 *   apart, because a merge discards the structure that the server sent.
 * - The case of the value of a parameter. `PARTSTAT=accepted` keeps its
 *   letters.
 * - An end that a time states, beside an end that a length of time
 *   states. `DTEND` and `DURATION` state one end in two forms. The choice
 *   between the two forms belongs to the model of an event, and not to
 *   this module.
 *
 * The serializer reads no clock, and the serializer reads no other value
 * from outside its own input. The same text always gives the same bytes.
 */

import { foldedIcsText } from './fold';
import type {
	JCalComponent,
	JCalParameters,
	JCalProperty,
	JCalRecur,
	JCalValue,
} from './jcal';
import { jcalProperty, jcalValues, stringifyJCalProperty } from './jcal';
import type { IcsParseFailure } from './parse';
import { parseIcs } from './parse';

/** What a canonical serialization gives back. */
export type IcsSerializeResult =
	| { readonly ok: true; readonly text: string }
	| { readonly ok: false; readonly failure: IcsParseFailure };

/**
 * The canonical text for the given iCalendar text, or the refusal of the
 * parse boundary.
 */
export function serializeIcs(text: string): IcsSerializeResult {
	const parsed = parseIcs(text);
	return parsed.ok
		? { ok: true, text: serializeCalendar(parsed.calendar) }
		: { ok: false, failure: parsed.failure };
}

/** The canonical text for a calendar that the boundary already read. */
export function serializeCalendar(calendar: JCalComponent): string {
	return foldedIcsText(orderedComponent(calendar).lines);
}

/**
 * The rank of the parts of a repeat rule, in the order that the format
 * lists them. The parser writes the name of a part in lower case.
 */
const RECUR_PART_RANK: readonly string[] = [
	'freq',
	'until',
	'count',
	'interval',
	'bysecond',
	'byminute',
	'byhour',
	'byday',
	'bymonthday',
	'byyearday',
	'byweekno',
	'bymonth',
	'bysetpos',
	'wkst',
];

/**
 * The components that can state a recurrence id. A component of one of
 * these kinds is a master when it states no recurrence id, and an
 * override when it states one.
 */
const OCCURRENCE_COMPONENTS: readonly string[] = [
	'vevent',
	'vtodo',
	'vjournal',
];

const TIMEZONE_RANK = 0;
const MASTER_RANK = 1;
const OVERRIDE_RANK = 2;
const ALARM_RANK = 3;
const OTHER_RANK = 4;

/** One component of the output, with the keys that order it among its kin. */
interface OrderedComponent {
	readonly rank: number;
	/** The recurrence id of an override, and an empty text for every other rank. */
	readonly recurrenceId: string;
	readonly name: string;
	/** The lines of the component, from its BEGIN line to its END line. */
	readonly lines: readonly string[];
}

function orderedComponent(component: JCalComponent): OrderedComponent {
	const [rawName, properties, components] = component;
	const name = rawName.toUpperCase();
	const lines = [
		`BEGIN:${name}`,
		...orderedPropertyLines(properties),
		...orderedComponentLines(components),
		`END:${name}`,
	];
	return {
		rank: rankOf(rawName, properties),
		recurrenceId: recurrenceIdOf(properties),
		name: rawName.toLowerCase(),
		lines,
	};
}

function orderedPropertyLines(
	properties: readonly JCalProperty[],
): readonly string[] {
	return properties
		.map((property) => {
			const ordered = orderedProperty(property);
			return {
				name: ordered[0].toLowerCase(),
				line: stringifyJCalProperty(ordered),
			};
		})
		.sort(
			(left, right) =>
				compare(left.name, right.name) ||
				compare(left.line, right.line),
		)
		.map((property) => property.line);
}

function orderedComponentLines(
	components: readonly JCalComponent[],
): readonly string[] {
	return components
		.map(orderedComponent)
		.sort(
			(left, right) =>
				left.rank - right.rank ||
				compare(left.recurrenceId, right.recurrenceId) ||
				compare(left.name, right.name) ||
				compare(left.lines.join('\n'), right.lines.join('\n')),
		)
		.flatMap((ordered) => ordered.lines);
}

/** The property with its parameters and its rule parts in canonical order. */
function orderedProperty(property: JCalProperty): JCalProperty {
	const [name, parameters, type] = property;
	return jcalProperty(
		name,
		orderedParameters(parameters),
		type,
		jcalValues(property).map(orderedValue),
	);
}

// The library reads the names of the parameters out of an object, and
// JavaScript gives a name that reads as a whole number its own place at
// the head of such an object. A parameter with such a name keeps that
// place, whatever this function does. Every device holds the same rule,
// so the bytes stay the same on every device. The parts of a repeat rule
// below take the same exception.
function orderedParameters(parameters: JCalParameters): JCalParameters {
	return Object.fromEntries(
		Object.entries(parameters).sort(([left], [right]) =>
			compare(left, right),
		),
	);
}

function orderedValue(value: JCalValue): JCalValue {
	return isRecur(value) ? orderedRecur(value) : value;
}

function orderedRecur(recur: JCalRecur): JCalRecur {
	return Object.fromEntries(
		Object.entries(recur).sort(([left], [right]) =>
			compareRecurParts(left, right),
		),
	);
}

function compareRecurParts(left: string, right: string): number {
	const leftRank = recurPartRank(left);
	const rightRank = recurPartRank(right);
	return leftRank - rightRank || compare(left, right);
}

function recurPartRank(name: string): number {
	const rank = RECUR_PART_RANK.indexOf(name);
	return rank === -1 ? RECUR_PART_RANK.length : rank;
}

function rankOf(name: string, properties: readonly JCalProperty[]): number {
	const kind = name.toLowerCase();
	if (kind === 'vtimezone') {
		return TIMEZONE_RANK;
	}
	if (kind === 'valarm') {
		return ALARM_RANK;
	}
	if (!OCCURRENCE_COMPONENTS.includes(kind)) {
		return OTHER_RANK;
	}
	return recurrenceIdProperty(properties) === undefined
		? MASTER_RANK
		: OVERRIDE_RANK;
}

/**
 * The recurrence id of an override, as the serializer writes that value.
 * The text leaves out the parameters of the property, so that two
 * overrides with different parameters still take the order of their ids.
 */
function recurrenceIdOf(properties: readonly JCalProperty[]): string {
	const property = recurrenceIdProperty(properties);
	if (property === undefined) {
		return '';
	}
	const line = stringifyJCalProperty(
		jcalProperty(property[0], {}, property[2], jcalValues(property)),
	);
	// This slice needs the empty parameters above it, because a parameter
	// value can hold a colon. The name of the property holds no colon, and
	// the value type that the library can add holds none either. The first
	// colon is therefore the one that separates the name from the value.
	return line.slice(line.indexOf(':') + 1);
}

function recurrenceIdProperty(
	properties: readonly JCalProperty[],
): JCalProperty | undefined {
	return properties.find(
		(property) => property[0].toLowerCase() === 'recurrence-id',
	);
}

function isRecur(value: JCalValue): value is JCalRecur {
	return typeof value === 'object' && !Array.isArray(value);
}

function compare(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	return left > right ? 1 : 0;
}
