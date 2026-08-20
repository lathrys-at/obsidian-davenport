/**
 * The base snapshot that a record carries, and the rule that decides what
 * a record does with a timezone definition.
 *
 * A record states a time in a named zone. The format states no rules for
 * a name, so something must give the rules. There are two answers, and
 * the name decides which one applies.
 *
 * - The bundled table holds the name. The record then carries the name
 *   alone, and it carries no definition. A device that needs the rules
 *   writes them from the bundled table with the synthesiser. The bytes of
 *   that definition follow from the name and the table alone, so every
 *   device at one table release writes the same bytes. The timezone
 *   component of the normalization stamp names the release and the
 *   synthesiser, and the record carries that component. A definition that
 *   the server sent under such a name leaves the record. The next push
 *   writes the definition of the table in its place, and a change that
 *   moves only such a definition on the server therefore changes no byte
 *   of the record.
 * - The bundled table does not hold the name. No device can write the
 *   rules, so the record keeps the definition that the server sent. The
 *   definition stands in the canonical order that the serializer gives,
 *   as every other part of the base snapshot does. "Keeps" means that the
 *   plugin computes no replacement for it. It does not mean that the
 *   octets of the server survive the canonical form.
 *
 * The measure behind the first case: a definition for New York runs to
 * about 8 kilobytes, and a calendar of two thousand events would repeat
 * those bytes into about 17 megabytes of vault text. A name and a version
 * number cost tens of bytes. The record therefore no longer holds the
 * rule history of its zones, and a device rebuilds that history from the
 * plugin.
 *
 * The duty of the writer follows from the two cases: carry the name and
 * the stamp for a name that the table holds, and carry the definition for
 * a name that the table does not hold. A calendar can also state a name
 * that the table does not hold and carry no definition for it. No device
 * can resolve such a name. The result below names each of these, so the
 * caller can surface them, and the writer drops nothing without a word.
 */

import type { JCalComponent } from '../ics/jcal';
import { definedZones, namedZones, withoutDefinitions } from '../ics/zones';
import { isTimezoneName } from '../timezone/table';

/** What the base snapshot of a record holds, and which zones it names. */
export interface BaseCalendar {
	/** The calendar with no definition for a name that the table holds. */
	readonly calendar: JCalComponent;
	/**
	 * The names that the calendar states and the table holds. The record
	 * carries a reference to each of these, and a device writes the
	 * definition from the table.
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
 * definition under a name that the bundled table holds, and it keeps
 * every other definition.
 */
export function baseCalendar(calendar: JCalComponent): BaseCalendar {
	const stripped = withoutDefinitions(calendar, isTimezoneName);
	const embedded = definedZones(stripped);
	const referenced: string[] = [];
	const unresolvable: string[] = [];
	for (const name of namedZones(stripped)) {
		if (isTimezoneName(name)) {
			referenced.push(name);
		} else if (!embedded.includes(name)) {
			unresolvable.push(name);
		}
	}
	return {
		calendar: stripped,
		referencedZones: referenced,
		embeddedZones: embedded,
		unresolvableZones: unresolvable,
	};
}
