/**
 * The terminal rule of a zone, and the truncation that it pays for.
 *
 * A zone whose last line names a rule set with one pair of changes that
 * repeats every year with no last year needs no change written out for
 * the years that the pair covers. The pair states them. This module finds
 * that pair, states the changes that it gives for one year, and removes
 * the tail of changes that the pair already states.
 */

import {
	civilSeconds,
	dayOfMonth,
	yearOf,
} from '../../src/core/timezone/calendar.ts';
import type { SourceRule, SourceZone, TimezoneSource } from './source.ts';
import { LAST_YEAR } from './source.ts';
import type {
	TerminalChange,
	TerminalRule,
	ZoneChange,
	ZoneType,
} from './zone.ts';
import { ruleSet, sameType, zoneType } from './zone.ts';

/**
 * The terminal rule of a zone, where the last line of the zone names a
 * rule set that holds one pair of changes with no last year.
 */
export function terminalRuleOf(
	zone: SourceZone,
	source: TimezoneSource,
): TerminalRule | undefined {
	const line = zone.lines[zone.lines.length - 1];
	if (line?.rules.kind !== 'named') {
		return undefined;
	}
	const set = ruleSet(source, line.rules.name, zone.name);
	const perpetual = set.filter((rule) => rule.lastYear === LAST_YEAR);
	if (perpetual.length !== 2) {
		return undefined;
	}
	const standardRule = perpetual.find((rule) => rule.save === 0);
	const daylightRule = perpetual.find((rule) => rule.save !== 0);
	if (standardRule === undefined || daylightRule === undefined) {
		return undefined;
	}
	const standardOffset = line.standardOffset;
	const typeOf = (rule: SourceRule): ZoneType =>
		zoneType(
			standardOffset,
			rule.save,
			rule.letters,
			line.format,
			zone.name,
		);
	return {
		standard: typeOf(standardRule),
		daylight: typeOf(daylightRule),
		start: terminalChange(daylightRule, standardOffset, standardRule.save),
		end: terminalChange(standardRule, standardOffset, daylightRule.save),
	};
}

/**
 * One change of a terminal rule, with its time stated on the wall clock
 * that runs before the change.
 */
function terminalChange(
	rule: SourceRule,
	standardOffset: number,
	saveBefore: number,
): TerminalChange {
	const shift =
		rule.at.base === 'universal'
			? standardOffset + saveBefore
			: rule.at.base === 'standard'
				? saveBefore
				: 0;
	return {
		month: rule.month,
		day: rule.day,
		wallSeconds: rule.at.seconds + shift,
	};
}

/**
 * The changes with the tail that the terminal rule states removed. The
 * function drops a change only where the terminal rule states that one
 * change, and no other change, over the span from the change before it.
 * The two forms therefore always state one history.
 *
 * The span matters. A zone can leave its seasonal rules for some years
 * and then take them up again. Over those years the rules state changes
 * that the zone did not make. A test that reads one change alone would
 * drop the change that ends such a span, and the reader would then apply
 * the terminal rule over the whole span.
 */
export function truncate(
	changes: readonly ZoneChange[],
	terminal: TerminalRule | undefined,
): readonly ZoneChange[] {
	if (terminal === undefined) {
		return changes;
	}
	let count = changes.length;
	while (count > 1) {
		const change = changes[count - 1];
		const before = changes[count - 2];
		if (change === undefined || before === undefined) {
			break;
		}
		if (!Number.isFinite(change.at) || !Number.isFinite(before.at)) {
			break;
		}
		if (!statesOnly(terminal, before.at, change)) {
			break;
		}
		count -= 1;
	}
	return changes.slice(0, count);
}

/**
 * True when the terminal rule states the given change, and states no
 * other change, over the span that follows the given instant.
 */
function statesOnly(
	terminal: TerminalRule,
	after: number,
	change: ZoneChange,
): boolean {
	const generated: ZoneChange[] = [];
	for (
		let year = yearOf(after) - 1;
		year <= yearOf(change.at) + 1;
		year += 1
	) {
		for (const candidate of terminalChanges(terminal, year)) {
			if (candidate.at > after && candidate.at <= change.at) {
				generated.push(candidate);
			}
		}
	}
	const only = generated[0];
	if (only === undefined) {
		return false;
	}
	return (
		generated.length === 1 &&
		only.at === change.at &&
		sameType(only.type, change.type)
	);
}

/** The two changes that a terminal rule states for one year. */
export function terminalChanges(
	terminal: TerminalRule,
	year: number,
): readonly ZoneChange[] {
	const start = {
		at: terminalInstant(terminal.start, year, terminal.standard.offset),
		type: terminal.daylight,
	};
	const end = {
		at: terminalInstant(terminal.end, year, terminal.daylight.offset),
		type: terminal.standard,
	};
	return [start, end].sort((left, right) => left.at - right.at);
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
