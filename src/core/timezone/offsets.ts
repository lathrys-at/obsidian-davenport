/**
 * The offset lookup over the bundled timezone table.
 *
 * Every computation whose result can reach the bytes of a record reads
 * this module. The module never asks the device for its timezone rules,
 * because two devices can hold different rules and would then write
 * different bytes for one event.
 *
 * The module states two directions. One direction takes an instant and
 * gives the state of the clock at that instant. The other direction takes
 * a wall time and gives the instant that it names.
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
 * The largest step that any offset of the table can make from universal
 * time. The offsets of the release run from twelve hours behind to
 * fourteen hours ahead, and a seasonal offset adds to that. The search
 * for a wall time steps this far to each side, so the step only has to
 * pass every offset that the table holds.
 */
const OFFSET_BOUND = 26 * 3600;

/**
 * The state of the clock of one zone at one instant.
 *
 * The table holds the changes from the start of 1970. For an instant
 * before that the function gives the state at the start of 1970, which is
 * the oldest state that the table states.
 */
export function stateAt(rules: TimezoneRules, instant: number): TimezoneState {
	if (instant < 0) {
		return rules.initial;
	}
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

/** The offset from universal time of one zone at one instant, in seconds. */
export function offsetAt(rules: TimezoneRules, instant: number): number {
	return stateAt(rules, instant).offset;
}

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

/**
 * The instant that a wall time names in one zone.
 *
 * The caller states the wall time as the count of seconds from the start
 * of 1970 to that time, read as if the wall clock were the universal
 * clock.
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
 */
export function instantOfWall(rules: TimezoneRules, wall: number): WallInstant {
	const early = offsetAt(rules, wall - OFFSET_BOUND);
	const late = offsetAt(rules, wall + OFFSET_BOUND);
	const candidates = early === late ? [early] : [early, late];
	const found: number[] = [];
	for (const offset of candidates) {
		const instant = wall - offset;
		if (offsetAt(rules, instant) === offset) {
			found.push(instant);
		}
	}
	if (found.length === 1) {
		const instant = found[0] ?? 0;
		return {
			instant,
			state: stateAt(rules, instant),
			resolution: 'single',
		};
	}
	if (found.length > 1) {
		// The overlap takes the later instant.
		const instant = Math.max(...found);
		return {
			instant,
			state: stateAt(rules, instant),
			resolution: 'overlap',
		};
	}
	// The gap takes the earlier instant. The wall time steps back by the
	// size of the gap, so the result stands before the change.
	const instant = Math.min(...candidates.map((offset) => wall - offset));
	return { instant, state: stateAt(rules, instant), resolution: 'gap' };
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
export function terminalChangesOfYear(
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
