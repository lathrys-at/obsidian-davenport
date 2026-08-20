/**
 * The stamp that this build writes into one record, and the skew rule
 * that compares two stamps. The file normalization.ts states what a stamp
 * is, and what each component covers.
 *
 * A record carries the timezone component only when the record shows one
 * of the three reaches below. The list holds the reaches that are known,
 * and the list is not closed. A change that gives the bundled table a new
 * reach into the bytes of a record must add that reach to the list, in
 * the same change.
 *
 * 1. The record holds a timezone definition that the plugin wrote, and
 *    not one that the server sent.
 * 2. The record holds a repeating series whose end stands in universal
 *    time, under a time that names a timezone and that governs the
 *    series. The time that governs the series is the start of the
 *    component, or the due date where the component states no start.
 *    That time states a date and a time of day, and so does the end of
 *    the series. The format states such a series end in universal time,
 *    so an edit of that end converts a local time through the bundled
 *    table. A series that states its end as a date reaches no such
 *    conversion, and a series whose governing time states a date reaches
 *    none either.
 * 3. The record holds the date of an instance that the plugin computed in
 *    the zone of the event.
 *
 * This module reads reach 2 out of the calendar of the record. The caller
 * states reach 1 and reach 3, because the calendar holds neither of them.
 *
 * - Reach 1 comes from the caller, which names each timezone whose
 *   definition the plugin wrote into the record. A definition that the
 *   plugin wrote and a definition that the server sent look the same in
 *   the bytes. A rule that reads the bytes alone cannot tell the two
 *   apart. The synthesiser writes a definition from the bundled table,
 *   and the code that puts such a definition into a record names the zone
 *   of that definition here. The reach reads the record as well as the
 *   caller: a name that no definition of the record carries reaches no
 *   byte of that record, and the reach passes over such a name.
 * - Reaches 2 and 3 read the shape of the record, and they do not ask
 *   which device computed a value. A device computes the end of a series
 *   and sends that end to the server. The server sends the same end back,
 *   and the record then holds the copy of the server. A rule that asked
 *   which device computed the value would give one record two answers.
 *   The bytes of a record must not depend on the device that wrote them.
 * - Reach 3 reads the materialization map of the record. No code fills
 *   that map yet, so the map holds no date today.
 *
 * The skew rule compares each component on its own. It compares only the
 * components that the record carries. A device rewrites the record one
 * time and wins when both of these conditions hold together. First, no
 * compared component of the device is older than the same component of
 * the record. Second, at least one compared component of the device is
 * newer. In every other condition the device treats the difference as
 * bytes only, and the device writes nothing. Without this rule, two
 * devices at different versions rewrite the record in turn and never
 * stop.
 */

import type {
	NormalizationStamp,
	NormalizationVersions,
} from '../model/normalization';
import type {
	JCalComponent,
	JCalProperty,
	JCalRecur,
	JCalRecurPart,
} from './jcal';
import { jcalValues } from './jcal';

/**
 * The value of the core component that this build writes. Raise this
 * number in the change that alters the bytes of the canonical text or the
 * bytes of the frontmatter. The golden corpus holds the bytes for each
 * value of this number, and a test compares the two.
 */
export const CORE_NORMALIZATION_VERSION = 1;

/**
 * The value of the timezone component that this build writes. Raise this
 * number in the change that alters the bundled timezone table or the code
 * that writes a timezone definition from it.
 */
export const TIMEZONE_NORMALIZATION_VERSION = 1;

/** The values of this build. */
export const NORMALIZATION_VERSIONS: NormalizationVersions = {
	core: CORE_NORMALIZATION_VERSION,
	timezone: TIMEZONE_NORMALIZATION_VERSION,
};

/** What the carriage rule reads out of one record. */
export interface StampSubject {
	/** The calendar that the base ICS of the record holds. */
	readonly calendar: JCalComponent;
	/**
	 * The name of each timezone whose definition the plugin wrote into
	 * this record. The code that writes a definition from the bundled
	 * table states these names, and every other caller states none.
	 */
	readonly writtenZoneIds: readonly string[];
	/** The dates that the materialization map of the record holds. */
	readonly instanceDates: readonly string[];
}

/** Which reaches of the bundled table one record shows. */
export interface TimezoneReaches {
	/** The record holds a timezone definition that the plugin wrote. */
	readonly writtenZone: boolean;
	/** The record holds a universal-time value from the bundled table. */
	readonly universalTime: boolean;
	/** The record holds the date of an instance in the zone of the event. */
	readonly instanceDate: boolean;
}

/** The reaches of the bundled table that the record shows. */
export function timezoneReaches(subject: StampSubject): TimezoneReaches {
	return {
		writtenZone: writtenZonesInRecord(subject).length > 0,
		universalTime: holdsSeriesEndInAZone(subject.calendar),
		instanceDate: subject.instanceDates.length > 0,
	};
}

/**
 * The names that the caller states and the record carries a definition
 * for. The first reach reads the record, so a name that no definition of
 * the record carries reaches no byte of it.
 */
export function writtenZonesInRecord(subject: StampSubject): readonly string[] {
	const carried = definedZoneIds(subject.calendar);
	return subject.writtenZoneIds.filter((name) => carried.has(name));
}

/**
 * The names that the caller states and the record carries no definition
 * for. An empty list is the answer for every caller that states what it
 * wrote. A caller that reads a name here wrote no definition under that
 * name, and the caller refuses the record.
 *
 * The other direction of this check cannot read the bytes. A definition
 * that the plugin wrote and a definition that the server sent look the
 * same. A caller that writes a definition and states no name for it
 * therefore leaves no mark. The code that writes a definition states each
 * name, and that duty stays with the code.
 */
export function writtenZonesNotInRecord(
	subject: StampSubject,
): readonly string[] {
	const carried = definedZoneIds(subject.calendar);
	return subject.writtenZoneIds.filter((name) => !carried.has(name));
}

/** Every name that a timezone definition of the calendar states. */
function definedZoneIds(calendar: JCalComponent): ReadonlySet<string> {
	const names = new Set<string>();
	collectZoneIds(calendar, names);
	return names;
}

function collectZoneIds(component: JCalComponent, names: Set<string>): void {
	if (component[0].toLowerCase() === 'vtimezone') {
		for (const property of component[1]) {
			if (property[0].toLowerCase() === 'tzid') {
				const value = property[3];
				if (typeof value === 'string') {
					names.add(value);
				}
			}
		}
	}
	for (const inside of component[2]) {
		collectZoneIds(inside, names);
	}
}

/** True when the record carries the timezone component. */
export function carriesTimezoneComponent(subject: StampSubject): boolean {
	const reaches = timezoneReaches(subject);
	return reaches.writtenZone || reaches.universalTime || reaches.instanceDate;
}

/** The stamp that this build writes into the given record. */
export function normalizationStamp(subject: StampSubject): NormalizationStamp {
	return carriesTimezoneComponent(subject)
		? {
				core: CORE_NORMALIZATION_VERSION,
				timezone: TIMEZONE_NORMALIZATION_VERSION,
			}
		: { core: CORE_NORMALIZATION_VERSION };
}

/** What a device does with a record whose stamp differs from its own. */
export type SkewDecision = 'rewrite' | 'suppress';

/**
 * The decision of the skew rule. The device rewrites the record only when
 * every component that the record carries is at most as new as the same
 * component of the device, and one of them is older.
 */
export function skewDecision(
	device: NormalizationVersions,
	record: NormalizationStamp,
): SkewDecision {
	const pairs: readonly (readonly [number, number])[] =
		record.timezone === undefined
			? [[device.core, record.core]]
			: [
					[device.core, record.core],
					[device.timezone, record.timezone],
				];
	if (pairs.some(([mine, theirs]) => mine < theirs)) {
		return 'suppress';
	}
	return pairs.some(([mine, theirs]) => mine > theirs)
		? 'rewrite'
		: 'suppress';
}

/**
 * The properties that can govern a repeating series, in the order of their
 * rank. The start governs the series where the component states one. The
 * due date governs the series of a task that states no start.
 */
const ANCHOR_PROPERTIES: readonly string[] = ['dtstart', 'due'];

/** The name of the value type of a date with a time of day. */
const DATE_TIME_TYPE = 'date-time';

/**
 * True when the calendar states the end of a repeating series in universal
 * time, and states the time that governs that series in a named zone. The
 * format writes such a series end in universal time, so a device converts
 * a local time through the bundled table to write it.
 */
function holdsSeriesEndInAZone(calendar: JCalComponent): boolean {
	return someComponent(
		calendar,
		(component) =>
			holdsUniversalSeriesEnd(component[1]) &&
			governedByAZonedTime(component[1]),
	);
}

function holdsUniversalSeriesEnd(properties: readonly JCalProperty[]): boolean {
	return properties.some(
		(property) =>
			property[0].toLowerCase() === 'rrule' &&
			jcalValues(property).some(
				(value) => isRecur(value) && isUniversalTime(value.until),
			),
	);
}

/**
 * True when a series end states a date and a time of day in universal
 * time. The parse library writes such a value with the mark of universal
 * time at its end. A value that states a date alone carries no such mark,
 * and neither does a value that states a time of day with no zone.
 */
function isUniversalTime(value: JCalRecurPart | undefined): boolean {
	return typeof value === 'string' && value.endsWith('Z');
}

/**
 * True when the time that governs the series names a timezone and states a
 * time of day. A component that states a start is governed by that start,
 * whatever else the component states.
 */
function governedByAZonedTime(properties: readonly JCalProperty[]): boolean {
	const anchor = governingAnchor(properties);
	return (
		anchor !== undefined &&
		'tzid' in anchor[1] &&
		anchor[2].toLowerCase() === DATE_TIME_TYPE
	);
}

function governingAnchor(
	properties: readonly JCalProperty[],
): JCalProperty | undefined {
	for (const name of ANCHOR_PROPERTIES) {
		const found = properties.find(
			(property) => property[0].toLowerCase() === name,
		);
		if (found !== undefined) {
			return found;
		}
	}
	return undefined;
}

function someComponent(
	component: JCalComponent,
	holds: (component: JCalComponent) => boolean,
): boolean {
	return (
		holds(component) ||
		component[2].some((inside) => someComponent(inside, holds))
	);
}

function isRecur(value: unknown): value is JCalRecur {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
