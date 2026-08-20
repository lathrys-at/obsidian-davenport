/**
 * The offset lookup over the bundled timezone table.
 *
 * Every computation whose result can reach the bytes of a record reads
 * this module. The module never asks the device for its timezone rules.
 * Two devices can hold different rules, and the two would then write
 * different bytes for one event.
 *
 * The module states two directions. One direction takes an instant and
 * gives the state of the clock at that instant. The other direction takes
 * a wall time and gives the instant that it names.
 *
 * The table covers the period from the start of 1970. Every function here
 * refuses an instant before that period, and the refusal is the contract.
 *
 * The oldest state that the table holds is the state at the start of 1970.
 * The table does not say how far back that state reaches. To give that
 * state for an earlier instant is a guess. The guess is wrong for a zone
 * that changed its clock in the years before 1970.
 *
 * The device holds a timezone database that reaches further back. No
 * result from that database may reach the bytes of a record.
 *
 * A caller that meets a refusal states the limit to the user. It does not
 * fall back to the database of the device.
 *
 * The module reads no clock: the caller states every instant.
 */

import { civilSeconds, dayOfMonth, yearOf } from './calendar';
import type {
	TerminalChange,
	TerminalRule,
	TimezoneRules,
	TimezoneState,
} from './table';

/**
 * The first instant that the table covers: the start of 1970, in seconds.
 */
export const TIMEZONE_TABLE_START = 0;

/**
 * The largest step that any offset of the table can make from universal
 * time. The offsets of the release run from twelve hours behind to
 * fourteen hours ahead, and a seasonal offset adds to that. The search for
 * a wall time steps this far to each side, so the step only has to pass
 * every offset that the table holds.
 */
const OFFSET_BOUND = 26 * 3600;

/** Why the table cannot answer. */
export type TimezoneRangeFailure = 'beforeTable';

/** The state of the clock, or the refusal of an instant out of range. */
export type TimezoneStateResult =
	| { readonly ok: true; readonly state: TimezoneState }
	| { readonly ok: false; readonly failure: TimezoneRangeFailure };

/** The offset, or the refusal of an instant out of range. */
export type TimezoneOffsetResult =
	| { readonly ok: true; readonly offset: number }
	| { readonly ok: false; readonly failure: TimezoneRangeFailure };

/** How a wall time stands against the changes of the clock. */
export type WallResolution = 'single' | 'gap' | 'overlap';

/** The instant that one wall time names. */
export interface WallInstant {
	/** The instant, in seconds from the start of 1970. */
	readonly instant: number;
	/** The state of the clock at that instant. */
	readonly state: TimezoneState;
	readonly resolution: WallResolution;
}

/** The instant of a wall time, or the refusal of a time out of range. */
export type WallInstantResult =
	| ({ readonly ok: true } & WallInstant)
	| { readonly ok: false; readonly failure: TimezoneRangeFailure };

/**
 * The state of the clock of one zone at one instant.
 *
 * The function refuses an instant before the start of 1970, which is where
 * the table starts.
 */
export function stateAt(
	rules: TimezoneRules,
	instant: number,
): TimezoneStateResult {
	if (instant < TIMEZONE_TABLE_START) {
		return { ok: false, failure: 'beforeTable' };
	}
	return { ok: true, state: stateWithin(rules, instant) };
}

/**
 * The offset from universal time of one zone at one instant, in seconds.
 *
 * The function refuses an instant before the start of 1970, which is where
 * the table starts.
 */
export function offsetAt(
	rules: TimezoneRules,
	instant: number,
): TimezoneOffsetResult {
	const found = stateAt(rules, instant);
	return found.ok
		? { ok: true, offset: found.state.offset }
		: { ok: false, failure: found.failure };
}

/**
 * The instant that a wall time names in one zone.
 *
 * The caller states the wall time as a count of seconds. The count runs
 * from the start of 1970 to that time, and it reads the wall clock as if
 * the wall clock were the universal clock. The function refuses a wall
 * time that names an instant before the start of 1970.
 *
 * A change of the clock makes two wall times that need a rule.
 *
 * - A wall time in a gap names no instant. The clock steps forward over
 *   it, so it never happens. Such a wall time resolves to the earlier
 *   instant: the instant that the wall time names under the offset that
 *   follows the change.
 * - A wall time in an overlap names two instants. The clock steps back
 *   over it, so it happens two times. Such a wall time resolves to the
 *   later instant: the second of the two.
 *
 * The search reads the offset at each end of a window of 52 hours around
 * the wall time, and it reads no instant inside that window. The answer is
 * therefore right while no zone changes its offset two times inside 52
 * hours. No zone of the release does, and a test holds the table to that.
 */
export function instantOfWall(
	rules: TimezoneRules,
	wall: number,
): WallInstantResult {
	const early = probe(rules, wall - OFFSET_BOUND);
	const late = probe(rules, wall + OFFSET_BOUND);
	const candidates = early === late ? [early] : [early, late];
	const found: number[] = [];
	for (const offset of candidates) {
		const instant = wall - offset;
		if (
			instant >= TIMEZONE_TABLE_START &&
			probe(rules, instant) === offset
		) {
			found.push(instant);
		}
	}
	if (found.length === 1) {
		return answer(rules, found[0] ?? 0, 'single');
	}
	if (found.length > 1) {
		// The overlap takes the later instant.
		return answer(rules, Math.max(...found), 'overlap');
	}
	// The gap takes the earlier instant. The wall time steps back by the
	// size of the gap, so the result stands before the change.
	const instant = Math.min(...candidates.map((offset) => wall - offset));
	return answer(rules, instant, 'gap');
}

function answer(
	rules: TimezoneRules,
	instant: number,
	resolution: WallResolution,
): WallInstantResult {
	if (instant < TIMEZONE_TABLE_START) {
		return { ok: false, failure: 'beforeTable' };
	}
	return {
		ok: true,
		instant,
		state: stateWithin(rules, instant),
		resolution,
	};
}

/**
 * The offset that the search for a wall time reads. The search steps to
 * each side of the wall time, and a step can pass the start of the table.
 * Such a step reads the oldest state instead, because the search only has
 * to name the offsets that can hold at the answer. The answer itself is
 * refused where it stands before the start of the table.
 */
function probe(rules: TimezoneRules, instant: number): number {
	return stateWithin(rules, Math.max(instant, TIMEZONE_TABLE_START)).offset;
}

/** The state at an instant that stands inside the period of the table. */
function stateWithin(rules: TimezoneRules, instant: number): TimezoneState {
	const changes = rules.changes;
	const last = changes[changes.length - 1];
	if (last !== undefined && instant < last.at) {
		return beforeLastChange(rules, instant);
	}
	const state = last?.state ?? rules.initial;
	return rules.terminal === undefined
		? state
		: afterLastChange(rules.terminal, last?.at ?? 0, state, instant);
}

/** The state at an instant that stands before the last change. */
function beforeLastChange(
	rules: TimezoneRules,
	instant: number,
): TimezoneState {
	const changes = rules.changes;
	let low = 0;
	let high = changes.length - 1;
	let found = -1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		const change = changes[middle];
		if (change === undefined) {
			break;
		}
		if (change.at <= instant) {
			found = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	return found === -1
		? rules.initial
		: (changes[found]?.state ?? rules.initial);
}

/**
 * The state at an instant that stands at or after the last change. The
 * repeating pair states every change from there on.
 */
function afterLastChange(
	terminal: TerminalRule,
	lastAt: number,
	lastState: TimezoneState,
	instant: number,
): TimezoneState {
	let state = lastState;
	const year = yearOf(instant);
	for (const candidate of [
		...terminalChangesOfYear(terminal, year - 1),
		...terminalChangesOfYear(terminal, year),
	]) {
		if (candidate.at > lastAt && candidate.at <= instant) {
			state = candidate.state;
		}
	}
	return state;
}

/** The two changes that the repeating pair states for one year, in order. */
function terminalChangesOfYear(
	terminal: TerminalRule,
	year: number,
): readonly { readonly at: number; readonly state: TimezoneState }[] {
	const start = {
		at: terminalInstant(terminal.start, year, terminal.standard.offset),
		state: terminal.daylight,
	};
	const end = {
		at: terminalInstant(terminal.end, year, terminal.daylight.offset),
		state: terminal.standard,
	};
	return start.at <= end.at ? [start, end] : [end, start];
}

function terminalInstant(
	change: TerminalChange,
	year: number,
	offsetBefore: number,
): number {
	const day = dayOfMonth(year, change.month, change.day);
	return (
		civilSeconds(year, change.month, day) +
		change.wallSeconds -
		offsetBefore
	);
}
