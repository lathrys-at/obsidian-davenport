/**
 * The timezone names that one calendar states, and the removal of a
 * definition from a calendar.
 *
 * A calendar states a name in two places. A value that stands in a zone
 * carries the name in its `TZID` parameter. A definition states the name
 * in its own `TZID` property. This module reads both places, and it reads
 * every component of the calendar.
 *
 * The functions read the structure alone. They ask no table which names
 * are known, and they hold no rule about what a record does with a
 * definition. The caller holds those rules.
 */

import type { JCalComponent, JCalParameterValue } from './jcal';

const TIMEZONE_COMPONENT = 'vtimezone';
const TIMEZONE_NAME = 'tzid';

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
			addParameter(names, parameter);
		}
	}
	for (const inside of component[2]) {
		collectNames(inside, names);
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

function addParameter(names: string[], parameter: JCalParameterValue): void {
	if (typeof parameter === 'string') {
		addName(names, parameter);
		return;
	}
	for (const value of parameter) {
		addName(names, value);
	}
}

function addName(names: string[], name: string): void {
	if (name.length > 0 && !names.includes(name)) {
		names.push(name);
	}
}
