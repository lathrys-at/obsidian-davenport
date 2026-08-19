/**
 * The values that state one expanded zone, and the helpers that build
 * them.
 *
 * The expansion of a zone gives a list of changes of the clock. Each
 * change names a state: the offset from universal time, whether that
 * offset is a daylight offset, and the abbreviation. This module holds
 * those values and the code that makes a state from one line of the
 * release.
 */

import type { RuleDay } from '../../src/core/timezone/calendar.ts';
import type { SourceRule, TimezoneSource } from './source.ts';

/** One state of the clock of a zone. */
export interface ZoneType {
	/** The offset from universal time, in seconds. */
	readonly offset: number;
	readonly isDaylight: boolean;
	readonly abbreviation: string;
}

/** One change of the clock of a zone. */
export interface ZoneChange {
	/** The instant of the change, in seconds from the start of 1970. */
	readonly at: number;
	readonly type: ZoneType;
}

/** One of the two changes of a terminal rule. */
export interface TerminalChange {
	/** The month, from 1 for January through 12 for December. */
	readonly month: number;
	readonly day: RuleDay;
	/**
	 * The time of the change, in seconds from the start of the local day.
	 * The local day reads the clock that runs before the change. The value
	 * can reach one day, because a change can fall at the end of a day.
	 */
	readonly wallSeconds: number;
}

/** The pair of seasonal changes that a zone repeats every year. */
export interface TerminalRule {
	readonly standard: ZoneType;
	readonly daylight: ZoneType;
	/** The change that starts the daylight offset. */
	readonly start: TerminalChange;
	/** The change that ends the daylight offset. */
	readonly end: TerminalChange;
}

/** One zone as the table holds it. */
export interface ExpandedZone {
	readonly name: string;
	/** The state of the clock at the start of 1970. */
	readonly initial: ZoneType;
	/** The changes after the start of 1970, in order. */
	readonly changes: readonly ZoneChange[];
	/** Absent where the zone ends in no repeating pair. */
	readonly terminal: TerminalRule | undefined;
}

/** The rules of one set, refused where the release states no such set. */
export function ruleSet(
	source: TimezoneSource,
	name: string,
	zoneName: string,
): readonly SourceRule[] {
	const set = source.rules.get(name);
	if (set === undefined) {
		throw new Error(
			`the zone ${zoneName} names the rule set ${name}, and the release states no such set`,
		);
	}
	return set;
}

/** The type that a zone line gives for one seasonal offset. */
export function zoneType(
	standardOffset: number,
	save: number,
	letters: string,
	format: string,
	zoneName: string,
): ZoneType {
	const offset = standardOffset + save;
	return {
		offset,
		isDaylight: save !== 0,
		abbreviation: abbreviationOf(format, offset, save, letters, zoneName),
	};
}

/**
 * The abbreviation of one state of the clock. A format states the
 * abbreviation in one of four ways: two names apart, a mark that the
 * letters of the rule replace, a mark that asks for the offset in
 * digits, or the name itself.
 */
function abbreviationOf(
	format: string,
	offset: number,
	save: number,
	letters: string,
	zoneName: string,
): string {
	if (format.includes('%z')) {
		if (format !== '%z') {
			throw new Error(
				`the zone ${zoneName} states the format ${format}, and the mark for the offset stands for a whole format`,
			);
		}
		return offsetAbbreviation(offset);
	}
	const slash = format.indexOf('/');
	if (slash !== -1) {
		return save === 0 ? format.slice(0, slash) : format.slice(slash + 1);
	}
	if (format.includes('%s')) {
		return format.replace('%s', letters);
	}
	return format;
}

/**
 * The abbreviation that states an offset in digits. The form gives the
 * hours always, the minutes where the offset holds minutes or seconds,
 * and the seconds where the offset holds seconds.
 */
function offsetAbbreviation(offset: number): string {
	const sign = offset < 0 ? '-' : '+';
	const size = Math.abs(offset);
	const hours = Math.floor(size / 3600);
	const minutes = Math.floor((size % 3600) / 60);
	const seconds = size % 60;
	const two = (value: number): string => String(value).padStart(2, '0');
	if (seconds !== 0) {
		return `${sign}${two(hours)}${two(minutes)}${two(seconds)}`;
	}
	if (minutes !== 0) {
		return `${sign}${two(hours)}${two(minutes)}`;
	}
	return `${sign}${two(hours)}`;
}

/** True when two states of the clock agree in every part. */
export function sameType(left: ZoneType, right: ZoneType): boolean {
	return (
		left.offset === right.offset &&
		left.isDaylight === right.isDaylight &&
		left.abbreviation === right.abbreviation
	);
}
