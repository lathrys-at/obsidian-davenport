/**
 * The jCal structure, and the types that this engine owns for it.
 *
 * jCal is the JSON form of iCalendar. A component is an array of three
 * items: the name, the properties, and the components inside it. A
 * property is an array of the name, the parameters, the name of the value
 * type, and then the values.
 *
 * The parse library gives this structure back with no type. This file is
 * the one place that reads the untyped form. The functions here examine
 * every part of the structure and then give it the types below. A part
 * that disagrees with those types stops the read. Every other file of the
 * engine receives only the typed form.
 *
 * The types keep the array shape of jCal, because the serializer of the
 * library accepts the same shape. This file is also the one place that
 * hands the typed form back to the library, so the copy that the library
 * requires stands here one time and not at each call.
 */

import ICAL from 'ical.js';

/**
 * The value of a parameter. A parameter that carries more than one value
 * holds the list of its values.
 */
export type JCalParameterValue = string | readonly string[];

/** The parameters of a property, by name. The parser writes the names in lower case. */
export type JCalParameters = Readonly<Record<string, JCalParameterValue>>;

/** One part of a repeat rule. */
export type JCalRecurPart = string | number | readonly (string | number)[];

/** A repeat rule. The keys are the names of the parts, in lower case. */
export type JCalRecur = Readonly<Record<string, JCalRecurPart>>;

/**
 * One value of a property. A structured value is an array that holds the
 * parts of that value. A repeat rule is an object that holds its parts.
 */
export type JCalValue =
	string | number | boolean | JCalRecur | readonly JCalValue[];

/**
 * One property: the name, the parameters, the name of the value type, and
 * then the values. A property that carries no value holds nothing after
 * the name of the value type.
 */
export type JCalProperty = readonly [
	name: string,
	parameters: JCalParameters,
	type: string,
	...values: JCalValue[],
];

/** One component: the name, the properties, and the components inside it. */
export type JCalComponent = readonly [
	name: string,
	properties: readonly JCalProperty[],
	components: readonly JCalComponent[],
];

/**
 * How the library divides the text of the value of one property. The
 * design set of the library holds these two characters for each property
 * that carries more than one value or that carries a structured value.
 */
export interface JCalDividers {
	/**
	 * The character that stands between two values of the property, or
	 * null where the property carries one value.
	 */
	readonly between: string | null;
	/**
	 * The character that stands between two parts of one value, or null
	 * where a value of the property holds no parts.
	 */
	readonly inside: string | null;
}

const NO_DIVIDERS: JCalDividers = { between: null, inside: null };

/** What a read of an untyped structure gives back. */
export type JCalReading =
	| { readonly ok: true; readonly component: JCalComponent }
	| { readonly ok: false; readonly problem: string };

/**
 * Reads one component out of an untyped structure. The read examines the
 * name, the parameters, the value type and the values of every property,
 * and it goes down into every component. It refuses a structure that
 * disagrees with the types of this file, and it names the part that
 * disagrees.
 */
export function readJCalComponent(value: unknown): JCalReading {
	const problem = componentProblem(value, 'the calendar');
	if (problem !== null) {
		return { ok: false, problem };
	}
	return { ok: true, component: value as JCalComponent };
}

/**
 * The number of components in a list of components. The function gives
 * null back when the value is not a list of components. The parser gives
 * a list back when the text holds more than one calendar, and an empty
 * list when the text holds no calendar.
 */
export function jcalListLength(value: unknown): number | null {
	if (!isArray(value)) {
		return null;
	}
	if (value.length === 0) {
		return 0;
	}
	return isArray(value[0]) ? value.length : null;
}

/** The values of a property, without the name, the parameters and the value type. */
export function jcalValues(property: JCalProperty): readonly JCalValue[] {
	const [, , , ...values] = property;
	return values;
}

/**
 * The dividers that the design set of the library states for the property
 * with this name. A name that the design set does not hold carries one
 * value and no parts. The library reads a name in lower case, and this
 * function reads the name in the same way.
 */
export function jcalDividers(name: string): JCalDividers {
	const properties = ICAL.design.icalendar.property as Readonly<
		Record<string, unknown>
	>;
	const details = properties[name.toLowerCase()];
	if (!isRecord(details)) {
		return NO_DIVIDERS;
	}
	return {
		between: oneCharacter(details['multiValue']),
		inside: oneCharacter(details['structuredValue']),
	};
}

function oneCharacter(value: unknown): string | null {
	return typeof value === 'string' && value.length === 1 ? value : null;
}

/** One property, from its name, its parameters, its value type and its values. */
export function jcalProperty(
	name: string,
	parameters: JCalParameters,
	type: string,
	values: readonly JCalValue[],
): JCalProperty {
	return [name, parameters, type, ...values];
}

/**
 * The text that the library writes for one component and everything
 * inside it. The library folds this text with its own rule, and the fold
 * of the library reaches one octet past the limit of the format. The
 * canonical serializer therefore does not build its text this way. This
 * function serves the caller that wants the text of the library itself.
 *
 * The copy of the component is necessary, because the library declares an
 * array that it can write to, and the engine holds the structure as a
 * readonly tuple. The copy is one level deep, and the library reads the
 * levels below it and writes to none of them.
 */
export function stringifyJCalComponent(component: JCalComponent): string {
	return ICAL.stringify([...component]);
}

/**
 * The text that the library writes for one property, as one line that the
 * library does not fold. The canonical serializer folds the line itself.
 *
 * The design set states how the library writes each value type and each
 * parameter. The library takes the set from the name of the root
 * component and gives the same set to every component below the root. The
 * boundary accepts VCALENDAR as the root and refuses every other name, so
 * the set of iCalendar is the set of every property that reaches here.
 */
export function stringifyJCalProperty(property: JCalProperty): string {
	return ICAL.stringify.property([...property], ICAL.design.icalendar, true);
}

function componentProblem(value: unknown, path: string): string | null {
	if (!isArray(value)) {
		return `${path} is not an array`;
	}
	if (value.length !== 3) {
		return `${path} holds ${String(value.length)} items and not three`;
	}
	const [name, properties, components] = value;
	if (typeof name !== 'string') {
		return `the name of ${path} is not a string`;
	}
	if (!isArray(properties)) {
		return `the properties of ${path} are not an array`;
	}
	if (!isArray(components)) {
		return `the components of ${path} are not an array`;
	}
	for (const [index, property] of properties.entries()) {
		const problem = propertyProblem(
			property,
			`property ${String(index + 1)} of ${path}`,
		);
		if (problem !== null) {
			return problem;
		}
	}
	for (const [index, component] of components.entries()) {
		const problem = componentProblem(
			component,
			`component ${String(index + 1)} of ${path}`,
		);
		if (problem !== null) {
			return problem;
		}
	}
	return null;
}

function propertyProblem(value: unknown, path: string): string | null {
	if (!isArray(value)) {
		return `${path} is not an array`;
	}
	if (value.length < 3) {
		return `${path} holds fewer than three items`;
	}
	const [name, parameters, type, ...values] = value;
	if (typeof name !== 'string') {
		return `the name of ${path} is not a string`;
	}
	if (typeof type !== 'string') {
		return `the value type of ${path} is not a string`;
	}
	const problem = parametersProblem(parameters, path);
	if (problem !== null) {
		return problem;
	}
	for (const [index, item] of values.entries()) {
		if (!isJCalValue(item)) {
			return `value ${String(index + 1)} of ${path} has a shape that jCal does not use`;
		}
	}
	return null;
}

function parametersProblem(value: unknown, path: string): string | null {
	if (!isRecord(value)) {
		return `the parameters of ${path} are not an object`;
	}
	for (const [name, parameter] of Object.entries(value)) {
		if (typeof parameter === 'string') {
			continue;
		}
		if (isArray(parameter) && parameter.every(isString)) {
			continue;
		}
		return `the parameter ${name} of ${path} is neither a string nor a list of strings`;
	}
	return null;
}

function isJCalValue(value: unknown): boolean {
	if (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	) {
		return true;
	}
	if (isArray(value)) {
		return value.every(isJCalValue);
	}
	if (isRecord(value)) {
		return Object.values(value).every(isRecurPart);
	}
	return false;
}

function isRecurPart(value: unknown): boolean {
	if (typeof value === 'string' || typeof value === 'number') {
		return true;
	}
	return (
		isArray(value) &&
		value.every(
			(part) => typeof part === 'string' || typeof part === 'number',
		)
	);
}

function isString(value: unknown): boolean {
	return typeof value === 'string';
}

// Array.isArray gives the type any[] to its argument, and every read of
// an item then has the type any. This guard states the element type as
// unknown, so the reads below keep their types.
function isArray(value: unknown): value is readonly unknown[] {
	return Array.isArray(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !isArray(value);
}
