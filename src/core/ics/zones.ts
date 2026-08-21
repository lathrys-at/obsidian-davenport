/**
 * The timezone names that one calendar states, and the removal of a
 * definition from a calendar.
 *
 * A calendar states a name in three places. A value that stands in a zone
 * carries the name in its `TZID` parameter. A definition states the name
 * in its own `TZID` property. Two properties carry a name as their value.
 * This module reads all three places, and it reads every component of the
 * calendar.
 *
 * The first two places are structure, so the module finds a name there
 * with no help. The third place is text, and no rule of the format
 * separates the name of a zone from other text. A caller that wants the
 * names of that third place therefore gives a test, and the test decides
 * which values are names. The module reads the value of two properties
 * only, and the list below names those two properties.
 *
 * The functions hold no rule about what a record does with a definition.
 * The caller holds those rules.
 */

import type { JCalComponent, JCalParameterValue } from './jcal';
import { jcalValues } from './jcal';

const TIMEZONE_COMPONENT = 'vtimezone';
const TIMEZONE_NAME = 'tzid';

/**
 * The two properties whose value states the name of a zone. A calendar
 * states its home zone in `X-WR-TIMEZONE`. One vendor states the zone of
 * a definition in `X-LIC-LOCATION`.
 *
 * The value of every other property is text, and the value of every other
 * property is not a reference. The bundled table holds names that ordinary
 * text spells: of its 598 names, 45 hold no slash, and 21 of those 45 are
 * four characters long or shorter. `LOCATION:Iceland` and
 * `CATEGORIES:Japan` therefore read as zone names to a wider scan. Such a
 * scan finds a reference to a zone that the event does not use, and a
 * record then drops a definition that nothing refers to.
 *
 * A change of this list moves the base snapshot of a record with no change
 * on the server. A test reads the list and holds the scan to these two
 * properties.
 */
export const REFERENCE_PROPERTIES: readonly string[] = [
	'x-wr-timezone',
	'x-lic-location',
];

/**
 * Every timezone name that the calendar states, in the order of the first
 * mention. A name that stands in more than one place appears one time.
 */
export function namedZones(calendar: JCalComponent): readonly string[] {
	const names: string[] = [];
	collectNames(calendar, names);
	return names;
}

/**
 * Every timezone name that a reference of the calendar states and the
 * test accepts, in the order of the first mention.
 *
 * A reference stands in the `TZID` parameter of a property. A reference
 * also stands in the value of one of the two properties above. The scan
 * reads no property of a definition and no property inside one. A
 * definition states the rules of one zone, and it refers to no zone: its
 * own `TZID` names it, and the abbreviation of an offset can spell the
 * name of another zone. A definition that nothing outside it names
 * therefore has no reference.
 *
 * The test decides which of those values are names.
 */
export function referencedZones(
	calendar: JCalComponent,
	holds: (name: string) => boolean,
): readonly string[] {
	const names: string[] = [];
	collectReferences(calendar, holds, names);
	return names;
}

/**
 * Every timezone name that a definition of the calendar states, in the
 * order of the first mention.
 */
export function definedZones(calendar: JCalComponent): readonly string[] {
	const names: string[] = [];
	collectDefinitions(calendar, (component) => {
		for (const name of definitionNames(component)) {
			addName(names, name);
		}
	});
	return names;
}

/**
 * Every definition of the calendar that states the given name, in the
 * order of the first mention. A calendar holds more than one definition
 * under one name where a merge put them there.
 */
export function definitionsOf(
	calendar: JCalComponent,
	name: string,
): readonly JCalComponent[] {
	const found: JCalComponent[] = [];
	collectDefinitions(calendar, (component) => {
		if (definitionNames(component).includes(name)) {
			found.push(component);
		}
	});
	return found;
}

/** True when the component is a definition that states one of the names. */
export function isDefinitionOf(
	component: JCalComponent,
	holds: (name: string) => boolean,
): boolean {
	return (
		component[0].toLowerCase() === TIMEZONE_COMPONENT &&
		definitionNames(component).some(holds)
	);
}

/**
 * The calendar with every definition removed whose name the test accepts.
 * The function goes down into every component, and it changes nothing
 * else.
 */
export function withoutDefinitions(
	component: JCalComponent,
	holds: (name: string) => boolean,
): JCalComponent {
	const kept = component[2]
		.filter((inside) => !isDefinitionOf(inside, holds))
		.map((inside) => withoutDefinitions(inside, holds));
	return [component[0], component[1], kept];
}

function collectNames(component: JCalComponent, names: string[]): void {
	const isDefinition = component[0].toLowerCase() === TIMEZONE_COMPONENT;
	for (const property of component[1]) {
		if (isDefinition && property[0].toLowerCase() === TIMEZONE_NAME) {
			addValue(names, property[3]);
		}
		const parameter = property[1][TIMEZONE_NAME];
		if (parameter !== undefined) {
			addParameter(names, parameter, EVERY_NAME);
		}
	}
	for (const inside of component[2]) {
		collectNames(inside, names);
	}
}

/** The test that takes every name, for a caller that filters nothing. */
const EVERY_NAME = (): boolean => true;

function collectReferences(
	component: JCalComponent,
	holds: (name: string) => boolean,
	names: string[],
): void {
	if (component[0].toLowerCase() === TIMEZONE_COMPONENT) {
		return;
	}
	for (const property of component[1]) {
		const parameter = property[1][TIMEZONE_NAME];
		if (parameter !== undefined) {
			addParameter(names, parameter, holds);
		}
		if (!REFERENCE_PROPERTIES.includes(property[0].toLowerCase())) {
			continue;
		}
		for (const value of jcalValues(property)) {
			if (typeof value === 'string' && holds(value)) {
				addName(names, value);
			}
		}
	}
	for (const inside of component[2]) {
		collectReferences(inside, holds, names);
	}
}

function collectDefinitions(
	component: JCalComponent,
	visit: (component: JCalComponent) => void,
): void {
	if (component[0].toLowerCase() === TIMEZONE_COMPONENT) {
		visit(component);
	}
	for (const inside of component[2]) {
		collectDefinitions(inside, visit);
	}
}

function definitionNames(component: JCalComponent): readonly string[] {
	const names: string[] = [];
	for (const property of component[1]) {
		if (property[0].toLowerCase() === TIMEZONE_NAME) {
			addValue(names, property[3]);
		}
	}
	return names;
}

function addValue(names: string[], value: unknown): void {
	if (typeof value === 'string') {
		addName(names, value);
	}
}

function addParameter(
	names: string[],
	parameter: JCalParameterValue,
	holds: (name: string) => boolean,
): void {
	if (typeof parameter === 'string') {
		if (holds(parameter)) {
			addName(names, parameter);
		}
		return;
	}
	for (const value of parameter) {
		if (holds(value)) {
			addName(names, value);
		}
	}
}

function addName(names: string[], name: string): void {
	if (name.length > 0 && !names.includes(name)) {
		names.push(name);
	}
}
