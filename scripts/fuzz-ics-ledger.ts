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
 * The defects that the layer of property tests and this lane found, and
 * that the issue tree holds. A new entry lands together with the issue that
 * it names.
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
		frame: 'logical-lines',
		repairText: (line) => repairQuotedColons(line),
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
		frame: 'logical-lines',
		repairText: (line) => line.replaceAll("^'", '-'),
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
		frame: 'logical-lines',
		repairText: (line) =>
			line.replace(/(^|[^\\])((?:\\\\)+)(?=[,;])/g, '$1'),
	},
	{
		issue: 234,
		name: 'a bare carriage return inside a line',
		// The reader of the boundary ends a line at a bare carriage return,
		// and the library keeps that character inside the value. The check
		// for a control character reads the lines of the reader, so it never
		// sees the character. Where a fold continues the line, the canonical
		// text breaks the property across two lines, and the boundary then
		// refuses its own text.
		//
		// A logical line carries no line ending, so a carriage return that
		// stands on one is a bare one and the pattern needs no more than that
		// character. The repair reads the whole text, because the construct
		// is the carriage return beside the fold: a rebuild from the logical
		// lines writes the fold somewhere else, and the finding goes away
		// with it. The repair takes away each carriage return that no line
		// feed follows, and it leaves every line ending where it stands.
		kinds: ['refused-own-text'],
		pattern: /\r/,
		site: 'value',
		repairValue: (value) => value.replaceAll('\r', ''),
		frame: 'whole-text',
		repairText: (text) => text.replace(/\r(?!\n)/g, ''),
	},
	{
		issue: 235,
		name: 'the VALUE parameter carries an escape or a quotation mark',
		// The parse turns the VALUE parameter into the name of the value
		// type, and it reads the escapes of a parameter value on the way.
		// The serializer writes the name of the type back raw: it writes no
		// escape, and it writes no quotation mark. A caret, a backslash or a
		// quotation mark in that parameter therefore moves the text on each
		// trip, or makes a text that the library cannot read back. An
		// ordinary parameter takes the encoding, so the pattern names the
		// VALUE parameter alone. The repair keeps the letters, the digits
		// and the dashes of that parameter and takes every other character
		// away. A name of those characters needs no escape and no quotation
		// mark, so the serializer writes it back as it stands. The repair
		// leaves the parameter where it is, because a property that states
		// its type needs that parameter to keep its value.
		kinds: ['not-a-fixed-point', 'refused-own-text'],
		pattern: /;VALUE=[^;:\r\n]*["^\\]/i,
		site: 'parameter',
		repairValue: (value) => value.replaceAll('^', '').replaceAll('\\', ''),
		frame: 'logical-lines',
		repairText: (line) => plainValueParameter(line),
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

/** How a VALUE parameter starts, in either case of the letters. */
const VALUE_PARAMETER = ';VALUE=';

/**
 * The line where every VALUE parameter holds a plain name: the letters, the
 * digits and the dashes of the name that the line states, and nothing else.
 * The walk stops at the first colon that stands outside quotation marks,
 * because that colon ends the parameters and starts the value of the
 * property. The value of the property therefore keeps its own text.
 */
function plainValueParameter(line: string): string {
	let repaired = '';
	let at = 0;
	let inside = false;
	while (at < line.length) {
		const character = line[at] ?? '';
		if (!inside && character === ':') {
			return repaired + line.slice(at);
		}
		if (
			!inside &&
			line.slice(at, at + VALUE_PARAMETER.length).toUpperCase() ===
				VALUE_PARAMETER
		) {
			const from = at + VALUE_PARAMETER.length;
			const end = parameterEnd(line, from);
			repaired +=
				line.slice(at, from) +
				line.slice(from, end).replace(/[^A-Za-z0-9-]/g, '');
			at = end;
			continue;
		}
		if (character === '"') {
			inside = !inside;
		}
		repaired += character;
		at += 1;
	}
	return repaired;
}

/**
 * The place where the value of the parameter that starts at `at` ends. That
 * is the next semicolon or colon, and a quoted value carries the search to
 * the character after its closing quotation mark. A value that opens a
 * quotation mark and closes none is a damaged value, and the search then
 * reads it as an ordinary one. The repair therefore takes away the
 * characters of one parameter, and never the rest of a damaged line.
 */
function parameterEnd(line: string, at: number): number {
	const quoted = line[at] === '"' ? line.indexOf('"', at + 1) : -1;
	const from = quoted === -1 ? at : quoted + 1;
	const semicolon = line.indexOf(';', from);
	const colon = line.indexOf(':', from);
	const end = Math.min(
		semicolon === -1 ? line.length : semicolon,
		colon === -1 ? line.length : colon,
	);
	return end;
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
