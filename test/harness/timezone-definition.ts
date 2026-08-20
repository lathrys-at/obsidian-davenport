/**
 * A reader of a timezone definition, for the tests of the synthesiser.
 *
 * The synthesiser writes a definition. A test must ask what that
 * definition says, and it must ask without reading the synthesiser again.
 * This file therefore reads a definition the way another client reads one.
 * It takes the observances. It expands the repeat rule of each one with the
 * parse library. It then states the offset of the zone at any instant.
 *
 * The library also states an offset of its own, through `ICAL.Timezone`.
 * That answer is an approximation near a change of the clock. The library
 * compares a universal time against a list of changes that it holds on the
 * local clock. The two disagree inside the window of a change. The reader
 * below compares instants only, so it gives an exact answer.
 *
 * The file also writes the text of a component in the order in which the
 * component holds its parts. The canonical serializer writes its own order,
 * so a comparison of the two texts states whether a component already
 * stands in the canonical order.
 */

import ICAL from 'ical.js';
import { foldedIcsText } from '../../src/core/ics/fold';
import type { JCalComponent, JCalProperty } from '../../src/core/ics/jcal';
import { stringifyJCalProperty } from '../../src/core/ics/jcal';

/** The largest number of occurrences that the reader takes from one rule. */
const OCCURRENCE_LIMIT = 400;

/** One change of the clock that a definition states. */
export interface DefinitionChange {
	/** The instant of the change, in seconds from the start of 1970. */
	readonly at: number;
	/** The offset from universal time after the change, in seconds. */
	readonly offset: number;
}

/** Every change that one definition states, with the offset before them. */
export interface DefinitionChanges {
	readonly changes: readonly DefinitionChange[];
	/** The offset from universal time before the first change, in seconds. */
	readonly initial: number;
}

/**
 * The text of one component in the order in which the component holds its
 * parts. The text folds with the rule of the engine, so it differs from the
 * canonical text in the order alone.
 */
export function textInComponentOrder(component: JCalComponent): string {
	return foldedIcsText(componentLines(component));
}

/**
 * Every change that one definition states, up to the end of the given year.
 * The reader expands the repeat rule of each observance with the parse
 * library.
 */
export function definitionChanges(
	component: JCalComponent,
	untilYear: number,
): DefinitionChanges {
	const changes: DefinitionChange[] = [];
	let initial = 0;
	let earliest = Number.POSITIVE_INFINITY;
	for (const observance of component[2]) {
		const properties = observance[1];
		const from = offsetSeconds(valueOf(properties, 'tzoffsetfrom'));
		const offset = offsetSeconds(valueOf(properties, 'tzoffsetto'));
		const start = valueOf(properties, 'dtstart');
		const at = wallSeconds(start) - from;
		if (at < earliest) {
			earliest = at;
			initial = from;
		}
		const rule = property(properties, 'rrule');
		if (rule === undefined) {
			changes.push({ at, offset });
			continue;
		}
		for (const occurrence of occurrences(rule, start, untilYear)) {
			changes.push({ at: occurrence - from, offset });
		}
	}
	changes.sort((left, right) => left.at - right.at);
	return { changes, initial };
}

/** The offset that one definition gives at one instant, in seconds. */
export function definitionOffset(
	definition: DefinitionChanges,
	instant: number,
): number {
	let offset = definition.initial;
	for (const change of definition.changes) {
		if (change.at > instant) {
			break;
		}
		offset = change.offset;
	}
	return offset;
}

/** The value of one property of a definition, as one string. */
export function valueOf(
	properties: readonly JCalProperty[],
	name: string,
): string {
	const found = property(properties, name);
	if (found === undefined) {
		throw new Error(`the observance holds no ${name}`);
	}
	const value = found[3];
	if (typeof value !== 'string') {
		throw new Error(`the value of ${name} is not one string`);
	}
	return value;
}

function property(
	properties: readonly JCalProperty[],
	name: string,
): JCalProperty | undefined {
	return properties.find((one) => one[0] === name);
}

function componentLines(component: JCalComponent): readonly string[] {
	const [name, properties, components] = component;
	return [
		`BEGIN:${name.toUpperCase()}`,
		...properties.map((one) => stringifyJCalProperty(one)),
		...components.flatMap(componentLines),
		`END:${name.toUpperCase()}`,
	];
}

/** Every occurrence of one repeat rule, as a count of wall seconds. */
function occurrences(
	rule: JCalProperty,
	start: string,
	untilYear: number,
): readonly number[] {
	const recur = ICAL.Recur.fromData(rule[3] as never);
	const iterator = recur.iterator(ICAL.Time.fromDateTimeString(start));
	const list: number[] = [];
	// A rule of a definition states no end, so the walk stops on the year
	// that the caller gives. The count is a guard against a rule that gives
	// one occurrence again and again.
	for (let step = 0; step < OCCURRENCE_LIMIT; step += 1) {
		const next = iterator.next();
		if (next.year > untilYear) {
			break;
		}
		list.push(
			Date.UTC(
				next.year,
				next.month - 1,
				next.day,
				next.hour,
				next.minute,
				next.second,
			) / 1000,
		);
	}
	return list;
}

/** The seconds that one date and time of the wall clock names. */
function wallSeconds(value: string): number {
	return (
		Date.UTC(
			Number(value.slice(0, 4)),
			Number(value.slice(5, 7)) - 1,
			Number(value.slice(8, 10)),
			Number(value.slice(11, 13)),
			Number(value.slice(14, 16)),
			Number(value.slice(17, 19)),
		) / 1000
	);
}

/** The seconds that one offset from universal time names. */
function offsetSeconds(value: string): number {
	const sign = value.startsWith('-') ? -1 : 1;
	const parts = value.slice(1).split(':').map(Number);
	return (
		sign * ((parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0))
	);
}
