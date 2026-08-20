/**
 * The synthesiser of a timezone definition.
 *
 * A record that states a time in a named zone must carry the definition of
 * that zone. The format states no zone rules of its own. Where the server
 * sent a definition, the record keeps the definition of the server.
 * Where the server sent none, this module writes one from the bundled
 * table. This module is the single origin of a definition that the plugin
 * writes.
 *
 * The definition covers the whole period that the table covers. It states
 * one observance for the state of the clock at the start of 1970. It
 * states one observance for each change of the clock after that instant.
 * It also states one observance for each month that a repeating change
 * reaches. An observance of a repeating change carries a repeat rule. The
 * definition therefore states every change after the last explicit one,
 * and it states no end date.
 *
 * The bytes of a definition follow from the name and from the table alone.
 * No property of an event reaches them, no clock reaches them, and no
 * device reaches them. Two records that name one zone therefore carry the
 * same bytes for that zone, and one record keeps those bytes while the
 * event changes.
 *
 * The definition takes the name that the caller wrote. The table gives
 * more than one name to one zone, and one of those names holds the rules
 * that the other names read. A definition under a name that points at
 * another name therefore holds the rules of that other name, under the
 * name that the caller wrote.
 *
 * The component stands in the order that the canonical serializer gives:
 * the observances that give a daylight state first, then the observances
 * that give a standard state, and each group in the order of its onsets.
 * The properties of an observance stand in the order of their names. The
 * serializer therefore writes this component with no change, and a test
 * holds every zone of the table to that.
 *
 * The onset of an observance reads the clock that runs before the change,
 * which is the rule that the format states for such a date.
 */

import type { JCalComponent, JCalProperty } from '../ics/jcal';
import { civilDateTime, yearOf } from './calendar';
import { stateAt, terminalInstant } from './offsets';
import type { RepeatPattern } from './repeat';
import { repeatOnset, repeatPatterns, repeatRule } from './repeat';
import type { TerminalChange, TimezoneRules, TimezoneState } from './table';
import { timezoneRules } from './table';

/** Why the synthesiser writes no definition. */
export type TimezoneDefinitionFailure = 'unknown';

/** The definition of one zone, or the refusal of a name the table does not hold. */
export type TimezoneDefinitionResult =
	| { readonly ok: true; readonly component: JCalComponent }
	| { readonly ok: false; readonly failure: TimezoneDefinitionFailure };

/**
 * The definition of one zone of the bundled table, under the name that the
 * caller wrote.
 */
export function synthesiseTimezone(name: string): TimezoneDefinitionResult {
	const rules = timezoneRules(name);
	return rules === undefined
		? { ok: false, failure: 'unknown' }
		: { ok: true, component: timezoneDefinition(rules) };
}

/** The definition of one zone, from the rules of that zone. */
export function timezoneDefinition(rules: TimezoneRules): JCalComponent {
	const properties: readonly JCalProperty[] = [
		['tzid', {}, 'text', rules.name],
	];
	return [
		'vtimezone',
		properties,
		orderedObservances(rules).map(observanceComponent),
	];
}

/**
 * The onset of the first observance, on the wall clock of the zone. The
 * table starts at the start of 1970, and the first observance holds the
 * state of the clock from there to the first change. Every explicit change
 * of the release stands later than this date on the wall clock of its zone.
 * A test holds the table to that.
 */
const FIRST_ONSET = 0;

/**
 * The largest number of years that the search for the start of a repeat
 * rule reads. A rule that covers part of a window names no day in some
 * years, and the search steps over such a year. The weekdays of a date
 * repeat every 28 years, so a rule that names a day in any year names one
 * inside this bound.
 */
const REPEAT_SEARCH_YEARS = 40;

/** One observance of a definition. */
interface Observance {
	/** True where the state that the change gives is a daylight state. */
	readonly daylight: boolean;
	/**
	 * The onset, in seconds from the start of 1970 on the wall clock that
	 * runs before the change.
	 */
	readonly onset: number;
	/** The offset from universal time before the change, in seconds. */
	readonly from: number;
	/** The offset from universal time after the change, in seconds. */
	readonly to: number;
	readonly abbreviation: string;
	/** The pattern that this observance repeats, where it repeats one. */
	readonly repeat: RepeatPattern | undefined;
}

/** The observances of one zone, in the order that the serializer gives. */
function orderedObservances(rules: TimezoneRules): readonly Observance[] {
	const all = observances(rules);
	const byOnset = (left: Observance, right: Observance): number =>
		left.onset - right.onset;
	return [
		...all.filter((one) => one.daylight).sort(byOnset),
		...all.filter((one) => !one.daylight).sort(byOnset),
	];
}

/** Every observance of one zone. */
function observances(rules: TimezoneRules): readonly Observance[] {
	const list: Observance[] = [
		{
			daylight: rules.initial.isDaylight,
			onset: FIRST_ONSET,
			from: rules.initial.offset,
			to: rules.initial.offset,
			abbreviation: rules.initial.abbreviation,
			repeat: undefined,
		},
	];
	let before = rules.initial;
	for (const change of rules.changes) {
		list.push({
			daylight: change.state.isDaylight,
			onset: change.at + before.offset,
			from: before.offset,
			to: change.state.offset,
			abbreviation: change.state.abbreviation,
			repeat: undefined,
		});
		before = change.state;
	}
	const terminal = rules.terminal;
	if (terminal !== undefined) {
		const last = rules.changes[rules.changes.length - 1]?.at ?? 0;
		list.push(
			...repeatingObservances(
				rules,
				terminal.start,
				terminal.standard,
				terminal.daylight,
				last,
			),
			...repeatingObservances(
				rules,
				terminal.end,
				terminal.daylight,
				terminal.standard,
				last,
			),
		);
	}
	return list;
}

/**
 * The observances of one repeating change: one observance for each month
 * that the onset reaches, and one observance for each occurrence that the
 * repeat rules cannot state.
 *
 * A repeat rule states the offset before the change one time, and the pair
 * gives that offset from its own second occurrence on. The first
 * occurrence can follow a different offset, because the zone changed its
 * standard offset in the same step. The definition states such an
 * occurrence on its own, with the offset that runs before it, and the rule
 * of that month starts after it.
 */
function repeatingObservances(
	rules: TimezoneRules,
	change: TerminalChange,
	before: TimezoneState,
	after: TimezoneState,
	lastChange: number,
): readonly Observance[] {
	const patterns = repeatPatterns(change);
	const list: Observance[] = [];
	const started = new Set<number>();
	const first = firstRepeatYear(change, before.offset, lastChange);
	for (
		let year = first;
		year < first + REPEAT_SEARCH_YEARS && started.size < patterns.length;
		year += 1
	) {
		const onset = repeatOnset(change, year);
		const pattern = patterns.find(
			(one) => one.month === civilDateTime(onset).month,
		);
		// The patterns cover every month that the window of the change
		// reaches. A year with no pattern therefore states a change that no
		// rule of the format can hold. The step over such a year keeps the
		// wrong rule out of the definition.
		if (pattern === undefined) {
			continue;
		}
		if (started.has(pattern.month)) {
			continue;
		}
		const offsetBefore = offsetAtEndOf(rules, onset - before.offset);
		if (offsetBefore !== before.offset) {
			list.push({
				daylight: after.isDaylight,
				onset: onset - before.offset + offsetBefore,
				from: offsetBefore,
				to: after.offset,
				abbreviation: after.abbreviation,
				repeat: undefined,
			});
			continue;
		}
		started.add(pattern.month);
		list.push({
			daylight: after.isDaylight,
			onset,
			from: before.offset,
			to: after.offset,
			abbreviation: after.abbreviation,
			repeat: pattern,
		});
	}
	return list;
}

/** The first year in which a repeating change stands after the given instant. */
function firstRepeatYear(
	change: TerminalChange,
	offsetBefore: number,
	lastChange: number,
): number {
	// The search starts one year early, because a change late in a year can
	// stand after an instant that falls in the year after it.
	let year = yearOf(lastChange) - 1;
	while (terminalInstant(change, year, offsetBefore) <= lastChange) {
		year += 1;
	}
	return year;
}

/** The offset that the table gives for the second before one instant. */
function offsetAtEndOf(rules: TimezoneRules, instant: number): number {
	const found = stateAt(rules, instant - 1);
	return found.ok ? found.state.offset : rules.initial.offset;
}

function observanceComponent(observance: Observance): JCalComponent {
	const head: JCalProperty[] = [
		['dtstart', {}, 'date-time', localDateTime(observance.onset)],
	];
	if (observance.repeat !== undefined) {
		head.push(['rrule', {}, 'recur', repeatRule(observance.repeat)]);
	}
	const properties: readonly JCalProperty[] = [
		...head,
		['tzname', {}, 'text', observance.abbreviation],
		['tzoffsetfrom', {}, 'utc-offset', utcOffset(observance.from)],
		['tzoffsetto', {}, 'utc-offset', utcOffset(observance.to)],
	];
	return [observance.daylight ? 'daylight' : 'standard', properties, []];
}

/** One date and time of the wall clock, in the form that jCal states. */
function localDateTime(seconds: number): string {
	const when = civilDateTime(seconds);
	const date = `${pad(when.year, 4)}-${pad(when.month, 2)}-${pad(when.day, 2)}`;
	const time = `${pad(when.hour, 2)}:${pad(when.minute, 2)}:${pad(when.second, 2)}`;
	return `${date}T${time}`;
}

/** One offset from universal time, in the form that jCal states. */
function utcOffset(seconds: number): string {
	const sign = seconds < 0 ? '-' : '+';
	const total = Math.abs(seconds);
	const hours = pad(Math.floor(total / 3600), 2);
	const minutes = pad(Math.floor(total / 60) % 60, 2);
	const rest = total % 60;
	return rest === 0
		? `${sign}${hours}:${minutes}`
		: `${sign}${hours}:${minutes}:${pad(rest, 2)}`;
}

function pad(value: number, width: number): string {
	return String(value).padStart(width, '0');
}
