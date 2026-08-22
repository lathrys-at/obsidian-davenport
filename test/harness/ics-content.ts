/**
 * The content of a calendar, as a text that a comparison can read.
 *
 * Two calendars hold the same content when they hold the same names, the
 * same parameters and the same values. The serializer owns the order of the
 * properties of a component, the order of the components inside a
 * component, and the order of the parameters of a property. A comparison of
 * content must therefore read none of those orders.
 *
 * The functions here make one text for a calendar. Two calendars with the
 * same text hold the same content. A property test compares a model against
 * the model that came back from a trip through the text, and the fuzzing
 * lane compares a calendar against the calendar that came back from a trip
 * through the canonical text.
 */

import type { JCalComponent } from '../../src/core/ics/jcal';

/**
 * The text of a value, with the keys of every object in order. Two objects
 * that hold the same entries in another order give the same text.
 */
export function stableJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableJson).join(',')}]`;
	}
	if (typeof value === 'object' && value !== null) {
		const entries = Object.entries(value)
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
			.sort();
		return `{${entries.join(',')}}`;
	}
	return JSON.stringify(value);
}

/**
 * The content of a component, without the order of its properties and
 * without the order of the components inside it. The name of a component
 * reads in lower case, because the parser writes that name in upper case
 * and a model holds it in lower case.
 */
export function contentOf(component: JCalComponent): string {
	const [name, properties, components] = component;
	const propertyTexts = properties.map(stableJson).sort();
	const componentTexts = components.map(contentOf).sort();
	return stableJson([name.toLowerCase(), propertyTexts, componentTexts]);
}
