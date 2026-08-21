/**
 * The base snapshot that a record carries, and the rule that decides what
 * a record does with a timezone definition.
 *
 * A record states a time in a named zone. The format states no rules for
 * a name, so something must give the rules. There are three answers, and
 * two questions decide which one applies. The first question asks whether
 * the bundled table holds the name. The second asks whether a value of
 * the calendar refers to the name.
 *
 * - The bundled table holds the name, and a value of the calendar refers
 *   to it. The record then carries the name alone, and it carries no
 *   definition. A device that needs the rules writes them from the
 *   bundled table with the synthesiser. The bytes of that definition
 *   follow from the name and the table alone, so every device at one
 *   table release writes the same bytes. The timezone component of the
 *   normalization stamp names the release and the synthesiser, and the
 *   record carries that component. A definition that the server sent
 *   under such a name leaves the record. The next push writes the
 *   definition of the table in its place, and a change that moves only
 *   such a definition on the server therefore changes no byte of the
 *   record.
 * - The bundled table does not hold the name. No device can write the
 *   rules, so the record keeps the definition that the server sent. The
 *   definition stands in the canonical order that the serializer gives,
 *   as every other part of the base snapshot does. "Keeps" means that the
 *   plugin computes no replacement for it. It does not mean that the
 *   octets of the server survive the canonical form.
 * - No value of the calendar refers to the name. The record then keeps
 *   the definition, whether or not the table holds the name. Nothing in
 *   the record states why such a definition stands there, and a push
 *   writes back only what the record holds. A record that dropped such a
 *   definition would therefore take it off the server on the next push,
 *   and no reference would bring it back.
 *
 * A reference stands in the `TZID` parameter of a value. A reference also
 * stands in the value of one of two properties. A calendar states its home
 * zone in `X-WR-TIMEZONE`, and one vendor states the zone of a definition
 * in `X-LIC-LOCATION`. A client that reads such a value needs the
 * definition of that zone.
 *
 * The value of every other property is not a reference. The bundled table
 * holds names that ordinary text spells, such as `Iceland` and `Japan`. A
 * `LOCATION` or a `CATEGORIES` value that spells such a name would
 * otherwise refer to a zone that the event does not use. The record would
 * then drop a definition that nothing refers to, which is the loss that
 * the third case above stops.
 *
 * The result below names every zone that the record refers to and the
 * table holds. Each definition that this module removes stands under one
 * of those names, so a device can write back every definition that the
 * record dropped.
 *
 * The measure behind the first case: a definition for New York runs to
 * about 8 kilobytes, and a calendar of two thousand events would repeat
 * those bytes into about 17 megabytes of vault text. A name and a version
 * number cost tens of bytes. The record therefore no longer holds the
 * rule history of its zones, and a device rebuilds that history from the
 * plugin.
 *
 * The duty of the writer follows from the three cases: carry the name and
 * the stamp for a name that the table holds and a value refers to, and
 * carry the definition in every other case. A calendar can also state a
 * name that the table does not hold and carry no definition for it. No
 * device can resolve such a name. The result below names each of these,
 * so the caller can surface them, and the writer drops nothing without a
 * word.
 */

import type { JCalComponent } from '../ics/jcal';
import {
	definedZones,
	namedZones,
	referencedZones,
	withoutDefinitions,
} from '../ics/zones';
import { isTimezoneName } from '../timezone/table';

/** What the base snapshot of a record holds, and which zones it names. */
export interface BaseCalendar {
	/**
	 * The calendar with no definition for a name that the table holds and
	 * a value of the calendar refers to.
	 */
	readonly calendar: JCalComponent;
	/**
	 * The names that a value of the calendar refers to and the table
	 * holds. The record carries a reference to each of these, and a device
	 * writes the definition from the table.
	 */
	readonly referencedZones: readonly string[];
	/** The names that the calendar carries a definition for. */
	readonly embeddedZones: readonly string[];
	/**
	 * The names that the calendar states, that the table does not hold,
	 * and that the calendar carries no definition for. No device can
	 * write the rules of such a name.
	 */
	readonly unresolvableZones: readonly string[];
}

/**
 * The base snapshot for the given calendar. The function removes every
 * definition under a name that the bundled table holds and a value of the
 * calendar refers to. It keeps every other definition.
 */
export function baseCalendar(calendar: JCalComponent): BaseCalendar {
	const referenced = referencedZones(calendar, isTimezoneName);
	const stripped = withoutDefinitions(calendar, (name) =>
		referenced.includes(name),
	);
	const embedded = definedZones(stripped);
	const unresolvable = namedZones(stripped).filter(
		(name) => !isTimezoneName(name) && !embedded.includes(name),
	);
	return {
		calendar: stripped,
		referencedZones: referenced,
		embeddedZones: embedded,
		unresolvableZones: unresolvable,
	};
}
