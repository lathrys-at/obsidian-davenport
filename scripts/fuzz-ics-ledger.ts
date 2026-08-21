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
 * - Every other finding carries a text alone. The runner repairs the lines
 *   of that text. Here the runner first drives the text that it rebuilt
 *   from the logical lines without a repair. That text must still give a
 *   finding of the same kind. Without this control, a rebuild that removed
 *   the finding by itself would look like a repair that worked. The
 *   repaired text must then be a text that the boundary accepts and that
 *   gives no finding. A repaired text that the boundary refuses proves
 *   nothing, and the finding is new.
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
	/** The repair of one logical line of a text. */
	readonly repairLine: (line: string) => string;
}

/**
 * The defects that the layer of property tests found and that the issue
 * tree holds. A new entry lands together with the issue that it names.
 *
 * The issue that reports a serializer which throws on a calendar outside
 * the range of the parse boundary carries no entry here. The lane drives
 * the parse boundary, and no input of the lane reaches that calendar.
 */
export const KNOWN_FINDINGS: readonly KnownFinding[] = [
	{
		issue: 230,
		name: 'a colon inside a quoted parameter value',
		// The library takes the value of the property from the colon inside
		// the quotation marks. The property value then grows on each trip
		// through the serializer, so the canonical text is no fixed point.
		// Where the property states a type that the wrong value disobeys,
		// the boundary refuses the text instead. Both readings have this
		// one root. A crash is not among the kinds: a crash on such a line
		// is another defect, and the run reports it.
		kinds: [
			'not-a-fixed-point',
			'model-divergence',
			'value-divergence',
			'refused',
			'refused-own-text',
		],
		pattern: /;[A-Za-z0-9-]+=[^\r\n]*"[^"\r\n]*:[^"\r\n]*"/,
		site: 'parameter',
		repairValue: (value) => value.replaceAll(':', '-'),
		repairLine: (line) => repairQuotedColons(line),
	},
	{
		issue: 230,
		name: 'a quotation mark beside a comma in a parameter value',
		// The library divides the list of values at the comma inside the
		// quotation marks, so the values that it reports are not the values
		// that the text states. The bytes stay the same on every trip.
		kinds: ['model-divergence', 'value-divergence', 'not-a-fixed-point'],
		pattern: /;[A-Za-z0-9-]+=[^\r\n]*(?:\^',|,\^')/,
		site: 'parameter',
		repairValue: (value) => value.replaceAll('"', '-'),
		repairLine: (line) => line.replaceAll("^'", '-'),
	},
	{
		issue: 231,
		name: 'a value that ends with an escaped backslash',
		// The library reads the escape of the backslash and the separator
		// that follows it as one escape. Two values then come back as one
		// value that holds the separator. The bytes stay the same on every
		// trip, so only a calendar that went in shows the loss.
		kinds: ['model-divergence'],
		pattern: /(?:^|[^\\])(?:\\\\)+[,;]/,
		site: 'value',
		repairValue: (value) => value.replace(/\\+$/, ''),
		repairLine: (line) =>
			line.replace(/(^|[^\\])((?:\\\\)+)(?=[,;])/g, '$1'),
	},
];

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

/** True when the repair of the lines removes the finding. */
function repairsTheText(
	engine: IcsEngine,
	found: Finding,
	entry: KnownFinding,
): boolean {
	const lines = logicalLinesOf(found.input);
	const framed = foldedAt(lines, ICS_FOLD_OCTET_LIMIT);
	const control = driveInput(engine, { text: framed, promise: 'any' });
	if (control?.kind !== found.kind) {
		return false;
	}
	const repaired = foldedAt(
		lines.map((line) =>
			entry.pattern.test(line) ? entry.repairLine(line) : line,
		),
		ICS_FOLD_OCTET_LIMIT,
	);
	if (repaired === framed) {
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

/**
 * The line with every colon inside quotation marks changed to a dash. The
 * walk stops at the first colon that stands outside the quotation marks,
 * because that colon ends the parameters and starts the value of the
 * property. The value of the property therefore keeps its colons.
 */
function repairQuotedColons(line: string): string {
	let inside = false;
	let repaired = '';
	for (let at = 0; at < line.length; at += 1) {
		const character = line[at] ?? '';
		if (character === '"') {
			inside = !inside;
			repaired += character;
			continue;
		}
		if (character === ':') {
			if (!inside) {
				return repaired + line.slice(at);
			}
			repaired += '-';
			continue;
		}
		repaired += character;
	}
	return repaired;
}
