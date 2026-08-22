/**
 * The findings that are already filed, and the rule that recognises one.
 *
 * The lane rediscovers a filed defect on every run. A run that reports its
 * known findings beside its new ones buries the new ones, and a lane that
 * nobody reads finds nothing. The ledger therefore holds one entry for each
 * filed defect. A finding that an entry recognises is counted and set
 * aside, and the run does not fail on it. Every other finding is new, and
 * the run fails.
 *
 * The rule has three conditions, and a finding matches an entry only when
 * all three hold.
 *
 * 1. The kind. The kind of the finding is one of the kinds that the entry
 *    states.
 * 2. The pattern. One logical line of the input matches the pattern of the
 *    entry. The pattern is a cheap first reading, and it is never the
 *    proof: a line that carries the construct beside another defect matches
 *    it too.
 * 3. The cause. The runner repairs the input as the entry states, and it
 *    drives the repaired input. The repair must remove the finding. Then
 *    the construct that the entry names is what made the finding.
 *
 * Condition 3 is what keeps the ledger narrow. A defect that stands beside
 * the construct of an entry survives the repair, so the runner reports it.
 * A finding that fails any condition is new, and the runner reports it.
 * The ledger never makes a finding disappear: a set-aside finding stands in
 * the report of the run under the issue that holds it.
 *
 * The repair reads one of two forms, and the kind of the finding decides
 * which one the runner uses.
 *
 * - A finding that reads the calendar which went in carries that calendar.
 *   The runner repairs the values of that calendar, writes the text of the
 *   repaired calendar, and drives it against the repaired calendar. The
 *   drive that made the finding is the control of this test: the calendar
 *   before the repair already gave the finding.
 * - Every other finding carries a text alone. The runner repairs that text,
 *   and the repaired text must be a text that the boundary accepts and that
 *   gives no finding. A repaired text that the boundary refuses proves
 *   nothing, and the finding is new.
 *
 * The frame of an entry states how the runner reads a text while it repairs
 * it, and the two frames need different controls.
 *
 * - Over the logical lines, the runner rebuilds the text from those lines
 *   and repairs each line that carries the pattern. A fold hides the
 *   construct of most entries, and a logical line shows it whole. The
 *   rebuild writes the framing again, so the runner first drives the
 *   rebuilt text with no repair, and that text must still give a finding of
 *   the same kind. Without this control, a rebuild that removed the finding
 *   by itself would look like a repair that worked.
 * - Over the whole text, the runner repairs the text as it stands. An entry
 *   takes this frame where the construct is a byte of the framing itself,
 *   because such a construct does not survive a rebuild. Here the runner
 *   needs no control of its own: it changes the bytes of the construct and
 *   nothing else, and the drive that made the finding is the control.
 */

import { ICS_FOLD_OCTET_LIMIT } from '../src/core/ics/fold.ts';
import type {
	JCalComponent,
	JCalParameters,
	JCalProperty,
	JCalValue,
} from '../src/core/ics/jcal.ts';
import {
	foldedAt,
	logicalLinesOf,
} from '../test/harness/arbitraries/ics-mutations.ts';
import type { Finding, FindingKind, IcsEngine } from './fuzz-ics-core.ts';
import { driveInput } from './fuzz-ics-core.ts';

/** Where in a calendar the values of an entry stand. */
export type KnownSite = 'parameter' | 'value';

/** How the runner reads a text while it repairs it. */
export type KnownFrame =
	/** One logical line at a time, in a text that the runner rebuilt. */
	| 'logical-lines'
	/** The whole text, as it stands. */
	| 'whole-text';

/** One defect that is already filed. */
export interface KnownFinding {
	/** The number of the issue that holds the defect. */
	readonly issue: number;
	/** A short name for the report. */
	readonly name: string;
	/** The kinds of finding that this defect makes. */
	readonly kinds: readonly FindingKind[];
	/** The construct, as it reads on one logical line of the text. */
	readonly pattern: RegExp;
	/** The values of a calendar that the repair reads. */
	readonly site: KnownSite;
	/** The repair of one value of a calendar. */
	readonly repairValue: (value: string) => string;
	/** How the runner reads a text while it repairs it. */
	readonly frame: KnownFrame;
	/**
	 * The repair of a text. The frame states what this repair receives: one
	 * logical line that carries the pattern, or the whole text.
	 */
	readonly repairText: (piece: string) => string;
}

/**
 * The defects that are already filed. The list is empty: the parse
 * boundary now refuses every shape that the entries of this list named,
 * and each of those defects left the list together with the change that
 * repaired it.
 *
 * A new entry lands together with the issue that it names. While the list
 * is empty, every finding of a run is a new finding, and the run fails on
 * it.
 *
 * The issue that reports a serializer which throws on a calendar outside
 * the range of the parse boundary carries no entry here. The lane drives
 * the parse boundary, and no input of the lane reaches that calendar.
 */
export const KNOWN_FINDINGS: readonly KnownFinding[] = [];


/** The entry that recognises the finding, or null for a new finding. */
export function knownFinding(
	engine: IcsEngine,
	found: Finding,
	ledger: readonly KnownFinding[] = KNOWN_FINDINGS,
): KnownFinding | null {
	for (const entry of ledger) {
		if (matchesEntry(engine, found, entry)) {
			return entry;
		}
	}
	return null;
}

function matchesEntry(
	engine: IcsEngine,
	found: Finding,
	entry: KnownFinding,
): boolean {
	if (!entry.kinds.includes(found.kind)) {
		return false;
	}
	if (!logicalLinesOf(found.input).some((line) => entry.pattern.test(line))) {
		return false;
	}
	return found.model === undefined
		? repairsTheText(engine, found, entry)
		: repairsTheCalendar(engine, found, entry.site, entry.repairValue);
}

/**
 * True when the repair of the calendar removes the finding. The calendar
 * that went in already gives the finding, so that drive is the control.
 */
function repairsTheCalendar(
	engine: IcsEngine,
	found: Finding,
	site: KnownSite,
	repair: (value: string) => string,
): boolean {
	const model = found.model;
	if (model === undefined) {
		return false;
	}
	const repaired = repairedComponent(model, site, repair);
	let text: string;
	try {
		text = engine.serializeCalendar(repaired);
	} catch {
		return false;
	}
	if (text === safeText(engine, model)) {
		return false;
	}
	return (
		driveInput(engine, { text, promise: 'accepted', model: repaired }) ===
		null
	);
}

/** True when the repair of the text removes the finding. */
function repairsTheText(
	engine: IcsEngine,
	found: Finding,
	entry: KnownFinding,
): boolean {
	const repaired =
		entry.frame === 'whole-text'
			? repairedWhole(found, entry)
			: repairedLines(engine, found, entry);
	if (repaired === null) {
		return false;
	}
	let accepted: boolean;
	try {
		accepted = engine.parseIcs(repaired).ok;
	} catch {
		return false;
	}
	return (
		accepted &&
		driveInput(engine, { text: repaired, promise: 'any' }) === null
	);
}

/**
 * The text with the repair over the whole of it, or null where the repair
 * changed nothing. The repair reads the text as it stands, so this form
 * needs no control: the drive that made the finding is the control.
 */
function repairedWhole(found: Finding, entry: KnownFinding): string | null {
	const repaired = entry.repairText(found.input);
	return repaired === found.input ? null : repaired;
}

/**
 * The text with the repair over each logical line that carries the pattern,
 * or null where the repair changed nothing, or where the rebuild is what
 * removed the finding.
 *
 * The runner rebuilds the text from its logical lines, and that rebuild
 * writes the framing again. The runner therefore drives the rebuilt text
 * with no repair first, and that text must still give a finding of the same
 * kind. Without this control, a rebuild that removed the finding by itself
 * would look like a repair that worked.
 */
function repairedLines(
	engine: IcsEngine,
	found: Finding,
	entry: KnownFinding,
): string | null {
	const lines = logicalLinesOf(found.input);
	const framed = foldedAt(lines, ICS_FOLD_OCTET_LIMIT);
	const control = driveInput(engine, { text: framed, promise: 'any' });
	if (control?.kind !== found.kind) {
		return null;
	}
	const repaired = foldedAt(
		lines.map((line) =>
			entry.pattern.test(line) ? entry.repairText(line) : line,
		),
		ICS_FOLD_OCTET_LIMIT,
	);
	return repaired === framed ? null : repaired;
}

/** The text of a calendar, or an empty text where the serializer throws. */
function safeText(engine: IcsEngine, calendar: JCalComponent): string {
	try {
		return engine.serializeCalendar(calendar);
	} catch {
		return '';
	}
}

/** The calendar, with the repair applied to every value of the site. */
function repairedComponent(
	component: JCalComponent,
	site: KnownSite,
	repair: (value: string) => string,
): JCalComponent {
	const [name, properties, components] = component;
	return [
		name,
		properties.map((property) => repairedProperty(property, site, repair)),
		components.map((inner) => repairedComponent(inner, site, repair)),
	];
}

function repairedProperty(
	property: JCalProperty,
	site: KnownSite,
	repair: (value: string) => string,
): JCalProperty {
	const [name, parameters, type, ...values] = property;
	return site === 'parameter'
		? [name, repairedParameters(parameters, repair), type, ...values]
		: [
				name,
				parameters,
				type,
				...values.map((value) => repairedValue(value, repair)),
			];
}

function repairedParameters(
	parameters: JCalParameters,
	repair: (value: string) => string,
): JCalParameters {
	return Object.fromEntries(
		Object.entries(parameters).map(([name, value]) => [
			name,
			typeof value === 'string' ? repair(value) : value.map(repair),
		]),
	);
}

/**
 * The value with the repair applied. A number, a boolean and a repeat rule
 * carry no text of the format, so the repair passes over them. The parts of
 * a structured value each take the repair.
 */
function repairedValue(
	value: JCalValue,
	repair: (text: string) => string,
): JCalValue {
	if (typeof value === 'string') {
		return repair(value);
	}
	if (Array.isArray(value)) {
		return (value as readonly JCalValue[]).map((part) =>
			repairedValue(part, repair),
		);
	}
	return value;
}
