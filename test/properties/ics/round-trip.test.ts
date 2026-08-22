/**
 * The round-trip rules of the iCalendar boundary, over generated input.
 *
 * The parse boundary and the canonical serializer already have tests
 * against a corpus that a person wrote. That corpus holds the shapes that a
 * person thought of. These tests hold the same rules against shapes that a
 * generator draws, so a shape that nobody thought of also meets them.
 *
 * Three rules stand here:
 *
 * - The canonical text of a text is a fixed point. The serializer reads its
 *   own output and writes the same bytes again.
 * - A trip from a model to text and back to a model loses nothing. Every
 *   component, every property, every parameter and every value comes back.
 *   The order of the properties changes, because the serializer owns that
 *   order, so the comparison reads the content and not the order.
 * - A change to the text that keeps the meaning does not move the canonical
 *   text. A server can fold a line at another place, write a name in
 *   another case, or put the properties in another order. The record must
 *   hold the same bytes after each of these.
 *
 * Each failure carries the seed of the run, and the message states the
 * command that draws the same inputs again.
 */

import { describe, expect, it } from 'vitest';
import { ICS_FOLD_OCTET_LIMIT } from '../../../src/core/ics/fold';
import type { JCalComponent } from '../../../src/core/ics/jcal';
import { parseIcs } from '../../../src/core/ics/parse';
import {
	serializeCalendar,
	serializeIcs,
} from '../../../src/core/ics/serializer';
import fc from 'fast-check';
import { icsCalendar } from '../../harness/arbitraries/ics-model';
import {
	composedMutation,
	icsMutation,
} from '../../harness/arbitraries/ics-mutations';
import { assertProperty } from '../../harness/arbitraries/seed';
import { icsFixtureArbitrary } from '../../harness/fixtures/ics-corpus';
import { contentOf } from '../../harness/ics-content';
import { octetLength } from '../../harness/ics-octets';

/** The canonical text of a text, or a failure that names the refusal. */
function canonical(text: string): string {
	const result = serializeIcs(text);
	if (!result.ok) {
		throw new Error(
			`the boundary refused the text: ${result.failure.message}\n${JSON.stringify(text)}`,
		);
	}
	return result.text;
}

/** The calendar that a text states, or a failure that names the refusal. */
function calendarOf(text: string): JCalComponent {
	const parsed = parseIcs(text);
	if (!parsed.ok) {
		throw new Error(
			`the boundary refused the text: ${parsed.failure.message}\n${JSON.stringify(text)}`,
		);
	}
	return parsed.calendar;
}

describe('the canonical serializer over generated calendars', () => {
	it('writes text that it writes again unchanged', () => {
		assertProperty(
			fc.property(icsCalendar(), (model) => {
				const once = serializeCalendar(model);
				expect(canonical(once)).toBe(once);
			}),
			200,
		);
	});

	it('writes text that the parse boundary reads', () => {
		assertProperty(
			fc.property(icsCalendar(), (model) => {
				expect(parseIcs(serializeCalendar(model)).ok).toBe(true);
			}),
			200,
		);
	});

	it('holds every physical line inside the octet limit', () => {
		assertProperty(
			fc.property(icsCalendar(), (model) => {
				const over = serializeCalendar(model)
					.split('\r\n')
					.filter((line) => octetLength(line) > ICS_FOLD_OCTET_LIMIT);
				expect(over).toEqual([]);
			}),
			200,
		);
	});
});

describe('a trip from a model to text and back', () => {
	it('gives back every component, property, parameter and value', () => {
		assertProperty(
			fc.property(icsCalendar(), (model) => {
				const text = serializeCalendar(model);
				expect(contentOf(calendarOf(text))).toBe(contentOf(model));
			}),
			200,
		);
	});

	it('gives back a model that writes the same text', () => {
		assertProperty(
			fc.property(icsCalendar(), (model) => {
				const text = serializeCalendar(model);
				expect(serializeCalendar(calendarOf(text))).toBe(text);
			}),
			200,
		);
	});
});

describe('a change to the text that keeps the meaning', () => {
	it('leaves the canonical text of a generated calendar where it was', () => {
		assertProperty(
			fc.property(icsCalendar(), icsMutation(), (model, mutation) => {
				const text = serializeCalendar(model);
				const changed = mutation.apply(text);
				expect(canonical(changed)).toBe(text);
			}),
			250,
		);
	});

	it('leaves that text where it was when every change applies', () => {
		assertProperty(
			fc.property(icsCalendar(), (model) => {
				const text = serializeCalendar(model);
				expect(canonical(composedMutation(text))).toBe(text);
			}),
			150,
		);
	});

	it('leaves the canonical text of a corpus fixture where it was', () => {
		assertProperty(
			fc.property(
				icsFixtureArbitrary(),
				icsMutation(),
				(fixture, mutation) => {
					const text = canonical(fixture.content);
					expect(canonical(mutation.apply(text))).toBe(text);
				},
			),
			100,
		);
	});
});
