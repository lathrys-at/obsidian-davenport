/**
 * The expansion of the timezone source into clock changes.
 *
 * A zone in the source is a list of lines, and each line states a
 * standard offset, a set of seasonal rules, and the moment at which the
 * line stops. This module walks those lines in order and states the
 * result as a list of clock changes: at this instant, the offset from
 * universal time becomes this, and the abbreviation becomes this.
 *
 * The expansion keeps two things for each zone. The first is the list of
 * the changes from the start of 1970. The second is the terminal rule:
 * the pair of seasonal changes that repeats every year with no last
 * year. A zone that ends in such a pair needs no change written out for
 * the years that the pair covers, because the pair states them. A zone
 * that ends in no such pair keeps every change that its rules state, and
 * the last offset then holds for all the time after it.
 *
 * The expansion computes with whole seconds of universal time. It reads
 * no clock.
 */

import { civilSeconds, dayOfMonth } from '../../src/core/timezone/calendar.ts';
import type {
	SourceRule,
	SourceTime,
	SourceZone,
	TimezoneSource,
} from './source.ts';
import { LAST_YEAR } from './source.ts';
import { terminalRuleOf, truncate } from './terminal.ts';
import type { ExpandedZone, ZoneChange, ZoneType } from './zone.ts';
import { ruleSet, sameType, zoneType } from './zone.ts';

/**
 * The year through which the expansion writes changes out. A terminal
 * rule covers every year after the last change that the expansion writes,
 * so this value only has to pass the last explicit year of the release.
 *
 * The expansion refuses a rule whose last year reaches this one. Such a
 * rule would lose its later changes without a word, and the table would
 * then state a wrong offset for every instant after this year.
 */
const MATERIAL_YEAR = 2200;

/** Every zone of the release, expanded, in the order of their names. */
export function expandZones(source: TimezoneSource): readonly ExpandedZone[] {
	refuseDistantRules(source);
	return source.zones
		.map((zone) => expandZone(zone, source))
		.sort((left, right) => compareNames(left.name, right.name));
}

/**
 * Refuses a release that states a rule with an explicit last year at or
 * past the horizon of the expansion. A rule that repeats with no last year
 * carries the year that stands for that, and it passes.
 */
function refuseDistantRules(source: TimezoneSource): void {
	for (const [name, set] of source.rules) {
		for (const rule of set) {
			if (rule.lastYear !== LAST_YEAR && rule.lastYear >= MATERIAL_YEAR) {
				throw new Error(
					`the rule set ${name} states the year ${String(rule.lastYear)}, and the expansion writes changes out to ${String(MATERIAL_YEAR)}. Raise MATERIAL_YEAR in tools/timezone-table/expand.ts past that year.`,
				);
			}
		}
	}
}

/** One zone, expanded. */
export function expandZone(
	zone: SourceZone,
	source: TimezoneSource,
): ExpandedZone {
	const changes = allChanges(zone, source);
	const terminal = terminalRuleOf(zone, source);
	const kept = truncate(changes, terminal);
	let initial = kept.length > 0 ? kept[0]?.type : undefined;
	const after: ZoneChange[] = [];
	for (const change of kept) {
		if (change.at <= 0) {
			initial = change.type;
		} else {
			after.push(change);
		}
	}
	if (initial === undefined) {
		throw new Error(`the zone ${zone.name} states no offset`);
	}
	return { name: zone.name, initial, changes: after, terminal };
}

/**
 * Every change of the zone, from the first line to the last. The first
 * change carries the instant of the start of time, and the reader takes
 * its type as the state before every other change.
 *
 * A line of a zone starts at the instant at which the line before it
 * stops. A rule can state a change at that same instant, and then the
 * two are one change. The reader of a rule therefore asks which clock
 * runs at the instant of the change.
 *
 * A rule that runs at or before the start of a line reads the clock of
 * the line before it. The state that such a rule leaves becomes the state
 * at the start of the line. A rule that runs after the start of a line
 * reads the clock of the line itself, and it makes a change of its own.
 *
 * The compiler that the release ships states the same result, and the
 * tests of this module compare the two over every zone.
 */
function allChanges(
	zone: SourceZone,
	source: TimezoneSource,
): readonly ZoneChange[] {
	const raw: ZoneChange[] = [];
	let lineStart = Number.NEGATIVE_INFINITY;
	let beforeStandardOffset = zone.lines[0]?.standardOffset ?? 0;
	let beforeSave = 0;
	for (const line of zone.lines) {
		const standardOffset = line.standardOffset;
		const typeOf = (save: number, letters: string): ZoneType =>
			zoneType(standardOffset, save, letters, line.format, zone.name);
		let save = line.rules.kind === 'constant' ? line.rules.save : 0;
		let letters = '';
		let until = untilInstant(line.until, standardOffset, save);
		if (line.rules.kind === 'named') {
			const instances = orderedInstances(
				ruleSet(source, line.rules.name, zone.name),
				line.until?.year ?? MATERIAL_YEAR,
			);
			let next = 0;
			let folded = false;
			// The rules that run at or before the start of this line state
			// the offset that the line starts with. They make no change of
			// their own, because the start of the line is that change. Such
			// a rule reads the clock of the line before it, and that clock
			// holds the standard offset and the seasonal offset of that
			// line. A line can state a seasonal offset of its own, so
			// that offset comes from the line and never from the rules.
			while (next < instances.length) {
				const instance = instances[next];
				if (instance === undefined) {
					break;
				}
				const at = instanceInstant(
					instance.rule,
					instance.year,
					beforeStandardOffset,
					beforeSave,
				);
				if (at > lineStart) {
					break;
				}
				save = instance.rule.save;
				letters = instance.rule.letters;
				folded = true;
				next += 1;
			}
			if (!folded) {
				save = 0;
				letters = standardLetters(
					instances.slice(next),
					line.format,
					zone.name,
				);
			}
			raw.push({ at: lineStart, type: typeOf(save, letters) });
			for (const instance of instances.slice(next)) {
				const at = instanceInstant(
					instance.rule,
					instance.year,
					standardOffset,
					save,
				);
				until = untilInstant(line.until, standardOffset, save);
				if (at >= until) {
					break;
				}
				raw.push({
					at,
					type: typeOf(instance.rule.save, instance.rule.letters),
				});
				save = instance.rule.save;
				letters = instance.rule.letters;
			}
			until = untilInstant(line.until, standardOffset, save);
		} else {
			raw.push({ at: lineStart, type: typeOf(save, letters) });
		}
		lineStart = until;
		beforeStandardOffset = standardOffset;
		beforeSave = save;
	}
	return withoutRepeats(raw);
}

/** One rule of a set, with the year in which it runs. */
interface RuleInstance {
	readonly rule: SourceRule;
	readonly year: number;
}

/**
 * Every run of the rules of one set, up to and including the given year,
 * in the order in which they happen.
 */
function orderedInstances(
	set: readonly SourceRule[],
	lastYear: number,
): readonly RuleInstance[] {
	const firstYear = Math.min(...set.map((rule) => rule.firstYear), lastYear);
	const instances: RuleInstance[] = [];
	for (let year = firstYear; year <= lastYear; year += 1) {
		for (const rule of instancesOfYear(set, year)) {
			instances.push({ rule, year });
		}
	}
	return instances;
}

/**
 * The letters of the first run that states the standard offset. A line
 * that starts before every rule of its set states the standard offset,
 * and the abbreviation of that offset comes from the first rule that
 * states it.
 *
 * The function refuses a line that stops before its own rules start, where
 * the format of that line asks for letters. No rule states the letters,
 * and an empty set of letters would make an abbreviation that no rule of
 * the release states. The compiler of the release refuses the same shape.
 */
function standardLetters(
	instances: readonly RuleInstance[],
	format: string,
	zoneName: string,
): string {
	const found = instances.find((instance) => instance.rule.save === 0);
	if (found === undefined && format.includes('%s')) {
		throw new Error(
			`the zone ${zoneName} states the format ${format} on a line that stops before its rules start, and no rule states the letters for it`,
		);
	}
	return found?.rule.letters ?? '';
}

/**
 * The rules of one set that apply in one year, in the order in which
 * they run. Two rules of one set never fall on one day, so the month and
 * the day order them.
 */
function instancesOfYear(
	set: readonly SourceRule[],
	year: number,
): readonly SourceRule[] {
	return set
		.filter((rule) => rule.firstYear <= year && year <= rule.lastYear)
		.map((rule) => ({ rule, day: dayOfMonth(year, rule.month, rule.day) }))
		.sort(
			(left, right) =>
				left.rule.month - right.rule.month ||
				left.day - right.day ||
				left.rule.at.seconds - right.rule.at.seconds,
		)
		.map((entry) => entry.rule);
}

function instanceInstant(
	rule: SourceRule,
	year: number,
	standardOffset: number,
	saveBefore: number,
): number {
	const day = dayOfMonth(year, rule.month, rule.day);
	return (
		civilSeconds(year, rule.month, day) +
		universalShift(rule.at, standardOffset, saveBefore)
	);
}

function untilInstant(
	until: SourceZone['lines'][number]['until'],
	standardOffset: number,
	save: number,
): number {
	if (until === undefined) {
		return Number.POSITIVE_INFINITY;
	}
	const day = dayOfMonth(until.year, until.month, until.day);
	return (
		civilSeconds(until.year, until.month, day) +
		universalShift(until.at, standardOffset, save)
	);
}

/**
 * The seconds that turn a time of the source into an instant. A time
 * that reads the wall clock steps back by the whole offset. A time that
 * reads the standard clock steps back by the standard offset alone. A
 * time that reads the universal clock does not step.
 */
function universalShift(
	at: SourceTime,
	standardOffset: number,
	save: number,
): number {
	if (at.base === 'universal') {
		return at.seconds;
	}
	return at.seconds - standardOffset - (at.base === 'standard' ? 0 : save);
}

/** The changes with each one that states the state before it removed. */
function withoutRepeats(changes: readonly ZoneChange[]): readonly ZoneChange[] {
	const kept: ZoneChange[] = [];
	for (const change of changes) {
		const previous = kept[kept.length - 1];
		if (previous !== undefined && sameType(previous.type, change.type)) {
			continue;
		}
		if (previous?.at === change.at) {
			kept[kept.length - 1] = change;
			continue;
		}
		kept.push(change);
	}
	return kept;
}

function compareNames(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	return left > right ? 1 : 0;
}
