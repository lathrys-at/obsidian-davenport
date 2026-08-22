/**
 * The inputs that the fuzzing lane draws.
 *
 * The lane has two arms, and each arm carries its own knowledge of the
 * input.
 *
 * The model arm draws a calendar from the generators of the property tests,
 * and it writes the text of that calendar with the canonical serializer.
 * The arm therefore knows which calendar the text states, and the drive
 * compares the calendar that comes back against it. That comparison is the
 * only rule that sees a value which the parse loses without a change of the
 * bytes.
 *
 * The generators of the property tests leave out the shapes that the parse
 * boundary reads wrongly today, so that the tests of every commit stay
 * green. This lane must reach those shapes: they are the neighbourhood of
 * the defects that are filed, and a defect that stands beside a filed one
 * is what the lane exists to find. The arm therefore draws a calendar and
 * then puts one of those shapes back into it. The ledger of the filed
 * defects decides which of the findings that follow are already known.
 *
 * The text arm draws a text and changes its bytes. The text comes from the
 * adversarial corpus, from a calendar of the model arm, from a feed of
 * ordinary shape, or from noise that carries the words of the format. The
 * changes are of two kinds. The changes that keep the meaning come from the
 * property tests, and they put the text in another legal shape. The changes
 * of the bytes damage the text. The arm knows nothing about what the text
 * states after such a change, so the drive holds it to the rules that stand
 * for arbitrary bytes: no throw, a refusal that names its reason, and a
 * canonical text that does not move.
 */

import fc from 'fast-check';
import type {
	JCalComponent,
	JCalProperty,
	JCalValue,
} from '../src/core/ics/jcal.ts';
import { icsCalendar } from '../test/harness/arbitraries/ics-model.ts';
import { icsMutation } from '../test/harness/arbitraries/ics-mutations.ts';
import { decadeSpanningCorpus } from '../test/harness/feed-fixture/events.ts';
import {
	events,
	renderVariant,
} from '../test/harness/feed-fixture/variants.ts';
import { icsCorpus } from '../test/harness/fixtures/ics-corpus.ts';
import type { IcsEngine } from './fuzz-ics-core.ts';

/**
 * One input, with the recipe that made it. The model arm carries the
 * calendar and not the text of it: the serializer writes that text, and a
 * serializer that throws is a finding of the run and not an error of the
 * generator.
 */
export type FuzzInput =
	| {
			readonly arm: 'model';
			/** What the arm did, for the report of a finding. */
			readonly recipe: string;
			readonly model: JCalComponent;
	  }
	| {
			readonly arm: 'text';
			readonly recipe: string;
			readonly text: string;
	  };

/** One change to a text, with the name that a report shows. */
export interface TextChange {
	readonly name: string;
	readonly apply: (text: string) => string;
}

/** One shape that the generators of the property tests leave out. */
export interface Widening {
	readonly name: string;
	/**
	 * The calendar with the shape put into one site of it. The `choice`
	 * argument selects the site among the sites that fit. A calendar with
	 * no such site comes back unchanged.
	 */
	readonly apply: (model: JCalComponent, choice: number) => JCalComponent;
}

/** The characters that a change to the bytes inserts. */
const HARD_BYTES: readonly string[] = [
	':',
	';',
	',',
	'"',
	'\\',
	'^',
	'=',
	'\r',
	'\n',
	'\t',
	'\0',
	'\uFEFF',
	'\uD800',
	'é',
	'😀',
	'A',
];

/** The words of the format that the noise generator puts together. */
const NOISE_PARTS: readonly string[] = [
	'BEGIN:VCALENDAR',
	'END:VCALENDAR',
	'BEGIN:VEVENT',
	'END:VEVENT',
	'BEGIN:VTIMEZONE',
	'END:VALARM',
	'VERSION:2.0',
	'SUMMARY:a',
	'DTSTART;TZID=Europe/Berlin:20200101T000000',
	'X-A;MEMBER="a","b":c',
	'CATEGORIES:a\\\\,b',
	'RRULE:FREQ=DAILY;COUNT=2',
	'GEO:1.5;2.5',
	' continuation',
	':',
	';',
	',',
	'"',
	'\\',
	'',
];

/**
 * The shapes that the generators of the property tests leave out. Each one
 * has a case in the file of known defects, and the ledger of this lane
 * holds the issue that the case names.
 */
export const WIDENINGS: readonly Widening[] = [
	{ name: 'no change', apply: (model) => model },
	{
		// The last value of the list is the value that stands beside the
		// colon of the property, and the case that is filed puts the colon
		// there.
		name: 'puts a colon in the last value of a list parameter',
		apply: (model, choice) =>
			overListParameter(model, choice, 'last', (value) => `${value}:x`),
	},
	{
		// The case that is filed puts the quotation mark in a value that
		// another value follows.
		name: 'puts a quotation mark and a comma in the first value of a list parameter',
		apply: (model, choice) =>
			overListParameter(model, choice, 'first', (value) => `${value}",`),
	},
	{
		name: 'ends a text value of a property that carries several values with a backslash',
		apply: (model, choice) =>
			overManyValues(model, choice, (values) =>
				values.map((value, at) =>
					at === 0 && typeof value === 'string'
						? `${value}\\`
						: value,
				),
			),
	},
	{
		name: 'ends a part of a structured text value with a backslash',
		apply: (model, choice) =>
			overStructuredValue(model, choice, (parts) =>
				parts.map((part, at) =>
					at === 0 && typeof part === 'string' ? `${part}\\` : part,
				),
			),
	},
];

/** The changes of the bytes that the text arm makes. */
export const BYTE_MUTATIONS: readonly {
	readonly name: string;
	readonly apply: (
		text: string,
		at: number,
		span: number,
		unit: string,
	) => string;
}[] = [
	{
		name: 'removes a run of characters',
		apply: (text, at, span) => text.slice(0, at) + text.slice(at + span),
	},
	{
		name: 'repeats a run of characters',
		apply: (text, at, span) =>
			text.slice(0, at) + text.slice(at, at + span) + text.slice(at),
	},
	{
		name: 'writes a character over a run',
		apply: (text, at, span, unit) =>
			text.slice(0, at) + unit.repeat(span) + text.slice(at + span),
	},
	{
		name: 'inserts a character',
		apply: (text, at, span, unit) =>
			text.slice(0, at) + unit.repeat(span) + text.slice(at),
	},
	{
		name: 'cuts the text short',
		apply: (text, at) => text.slice(0, at),
	},
	{
		name: 'repeats a line',
		apply: (text, at) => overLine(text, at, (line) => [line, line]),
	},
	{
		name: 'removes a line',
		apply: (text, at) => overLine(text, at, () => []),
	},
	{
		name: 'makes a line long',
		apply: (text, at, span, unit) =>
			overLine(text, at, (line) => [line + unit.repeat(span * 8)]),
	},
	{
		name: 'takes the carriage return out of every line ending',
		apply: (text) => text.replace(/\r\n/g, '\n'),
	},
	{
		name: 'takes the line feed out of every line ending',
		apply: (text) => text.replace(/\r\n/g, '\r'),
	},
];

/** An input of the model arm. */
export function modelInput(): fc.Arbitrary<FuzzInput> {
	return fc
		.tuple(
			icsCalendar(),
			fc.constantFrom(...WIDENINGS),
			fc.nat({ max: 999 }),
		)
		.map(([drawn, widening, choice]): FuzzInput => ({
			arm: 'model',
			recipe: `a generated calendar, and the widening that ${widening.name}`,
			model: widening.apply(drawn, choice),
		}));
}

/** An input of the text arm. */
export function textInput(engine: IcsEngine): fc.Arbitrary<FuzzInput> {
	return fc
		.tuple(baseText(engine), fc.array(textChange(), { maxLength: 4 }))
		.map(([base, changes]): FuzzInput => {
			// A change that keeps the meaning reads the components of the
			// text, and a text that an earlier change damaged holds no
			// components. Such a change throws, and the arm then passes over
			// it. The changes are the tools of the lane, and a tool that
			// cannot work on a text states nothing about the engine.
			let text = base.text;
			const names: string[] = [];
			for (const change of changes) {
				try {
					text = change.apply(text);
					names.push(change.name);
				} catch {
					continue;
				}
			}
			return {
				arm: 'text',
				recipe:
					names.length === 0
						? base.name
						: `${base.name}, and then it ${names.join(', and then it ')}`,
				text,
			};
		});
}

/** One text that a change starts from, with the name of where it came from. */
function baseText(
	engine: IcsEngine,
): fc.Arbitrary<{ readonly name: string; readonly text: string }> {
	const fixtures = icsCorpus().map((fixture) => ({
		name: `the corpus fixture ${fixture.id}`,
		text: fixture.content,
	}));
	const feeds = feedTexts().map((text, at) => ({
		name: `a feed of ordinary shape, number ${String(at + 1)}`,
		text,
	}));
	const [first, ...rest] = [...fixtures, ...feeds];
	if (first === undefined) {
		throw new Error(
			'the fuzzing lane found no text to start from; the ics corpus is empty',
		);
	}
	return fc.oneof(
		{ arbitrary: fc.constantFrom(first, ...rest), weight: 4 },
		{
			arbitrary: modelInput().map((input) => ({
				name: input.recipe,
				text:
					input.arm === 'model'
						? safeText(engine, input.model)
						: input.text,
			})),
			weight: 3,
		},
		{ arbitrary: noiseText(), weight: 2 },
	);
}

/**
 * The text of a calendar, or an empty text where the serializer throws on
 * that calendar. Here the text is only the material that a change works on.
 * The model arm drives the same calendars, and that arm reports a
 * serializer which throws as a finding.
 */
function safeText(engine: IcsEngine, model: JCalComponent): string {
	try {
		return engine.serializeCalendar(model);
	} catch {
		return '';
	}
}

/** A text of noise. The noise carries the words of the format. */
function noiseText(): fc.Arbitrary<{
	readonly name: string;
	readonly text: string;
}> {
	const words = fc
		.array(fc.constantFrom(...NOISE_PARTS), { maxLength: 12 })
		.map((parts) => parts.join('\r\n'));
	return fc
		.oneof(words, fc.string({ unit: 'binary', maxLength: 200 }))
		.map((text) => ({ name: 'noise', text }));
}

/** One change to a text, with its arguments already drawn. */
function textChange(): fc.Arbitrary<TextChange> {
	return fc.oneof(
		{ arbitrary: byteChange(), weight: 4 },
		{ arbitrary: icsMutation(), weight: 1 },
	);
}

function byteChange(): fc.Arbitrary<TextChange> {
	return fc
		.tuple(
			fc.constantFrom(...BYTE_MUTATIONS),
			fc.nat({ max: 999 }),
			fc.integer({ min: 1, max: 24 }),
			fc.constantFrom(...HARD_BYTES),
		)
		.map(([mutation, place, span, unit]): TextChange => {
			const shown = JSON.stringify(unit);
			return {
				name: `${mutation.name} (at ${String(place)} of 1000, ${String(span)} long, with ${shown})`,
				apply: (text) =>
					mutation.apply(text, placeIn(text, place), span, unit),
			};
		});
}

/** The place in the text that the fraction names. */
function placeIn(text: string, place: number): number {
	return Math.floor((place / 1000) * text.length);
}

/** The text with one line changed. The place names the line. */
function overLine(
	text: string,
	at: number,
	change: (line: string) => readonly string[],
): string {
	const ending = text.includes('\r\n') ? '\r\n' : '\n';
	const lines = text.split(ending);
	if (lines.length === 0) {
		return text;
	}
	const fraction = text.length === 0 ? 0 : at / text.length;
	const index = Math.min(
		lines.length - 1,
		Math.floor(fraction * lines.length),
	);
	const line = lines[index] ?? '';
	return [
		...lines.slice(0, index),
		...change(line),
		...lines.slice(index + 1),
	].join(ending);
}

let feeds: readonly string[] | undefined;

/**
 * The calendars of ordinary shape that a feed serves. The lane builds them
 * one time and then holds them.
 */
function feedTexts(): readonly string[] {
	feeds ??= builtFeedTexts();
	return feeds;
}

function builtFeedTexts(): readonly string[] {
	const decoder = new TextDecoder('utf-8');
	const referenceTime = Date.UTC(2026, 0, 15, 12, 0, 0);
	return [true, false].map((allDay) =>
		decoder.decode(
			renderVariant(
				events(
					decadeSpanningCorpus({
						referenceTime,
						yearsBefore: 1,
						yearsAfter: 1,
						perYear: 2,
						allDay,
					}),
				),
				{ poll: 1, referenceTime, churnStepMs: 0 },
			).bytes,
		),
	);
}

/** The calendar with one value of a list parameter changed. */
function overListParameter(
	model: JCalComponent,
	choice: number,
	where: 'first' | 'last',
	change: (value: string) => string,
): JCalComponent {
	return overProperty(
		model,
		choice,
		(property) =>
			Object.values(property[1]).some((value) => Array.isArray(value)),
		(property) => {
			const [name, parameters, type, ...values] = property;
			const entries = Object.entries(parameters).map(
				([key, value]): [string, string | readonly string[]] => {
					if (typeof value === 'string') {
						return [key, value];
					}
					const wanted = where === 'first' ? 0 : value.length - 1;
					return [
						key,
						value.map((item, at) =>
							at === wanted ? change(item) : item,
						),
					];
				},
			);
			return [name, Object.fromEntries(entries), type, ...values];
		},
	);
}

/**
 * The calendar with the values of one text property that carries several
 * changed. The value type must be text: a backslash at the end of a value
 * is a character of the text of the format, and a value of another type
 * holds no such character.
 */
function overManyValues(
	model: JCalComponent,
	choice: number,
	change: (values: readonly JCalValue[]) => readonly JCalValue[],
): JCalComponent {
	return overProperty(
		model,
		choice,
		(property) => {
			const [, , type, ...values] = property;
			return (
				type === 'text' &&
				values.length > 1 &&
				values.every((value) => typeof value === 'string')
			);
		},
		(property) => {
			const [name, parameters, type, ...values] = property;
			return [name, parameters, type, ...change(values)];
		},
	);
}

/** The calendar with the parts of one structured text value changed. */
function overStructuredValue(
	model: JCalComponent,
	choice: number,
	change: (parts: readonly JCalValue[]) => readonly JCalValue[],
): JCalComponent {
	return overProperty(
		model,
		choice,
		(property) => {
			const first = property[3];
			return (
				property[2] === 'text' &&
				Array.isArray(first) &&
				first.length > 1 &&
				first.every((part) => typeof part === 'string')
			);
		},
		(property) => {
			const [name, parameters, type, first, ...rest] = property;
			return Array.isArray(first)
				? [name, parameters, type, change(first), ...rest]
				: property;
		},
	);
}

/**
 * The calendar with one property changed. The change reaches the property
 * that the choice selects among the properties that fit. A calendar that
 * holds no such property comes back unchanged.
 */
function overProperty(
	model: JCalComponent,
	choice: number,
	fits: (property: JCalProperty) => boolean,
	change: (property: JCalProperty) => JCalProperty,
): JCalComponent {
	const sites = countSites(model, fits);
	if (sites === 0) {
		return model;
	}
	const wanted = choice % sites;
	let seen = 0;
	const walk = (component: JCalComponent): JCalComponent => {
		const [name, properties, components] = component;
		return [
			name,
			properties.map((property) => {
				if (!fits(property)) {
					return property;
				}
				seen += 1;
				return seen - 1 === wanted ? change(property) : property;
			}),
			components.map(walk),
		];
	};
	return walk(model);
}

function countSites(
	component: JCalComponent,
	fits: (property: JCalProperty) => boolean,
): number {
	return (
		component[1].filter(fits).length +
		component[2].reduce(
			(total, inner) => total + countSites(inner, fits),
			0,
		)
	);
}
