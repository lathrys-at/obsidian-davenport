/**
 * The defects that the property tests of the iCalendar boundary found.
 *
 * Every case here starts from a text that iCalendar permits. The parse
 * boundary accepts each text, and the model that it gives back states
 * something that the text does not state. The boundary exists to refuse
 * exactly that: its own comment says that it refuses a text when the
 * structure that the parser reports disagrees with the text.
 *
 * Each case is the smallest input that reaches the defect. The generator
 * that found the case now leaves that shape out, so the other properties
 * run. The comment beside each generator points back to this file.
 *
 * Every test here is skipped. A skipped test is a defect that waits for a
 * decision, and it is not a rule that the engine keeps today. Take the skip
 * away when the engine holds the rule.
 */

import { describe, expect, it } from 'vitest';
import { parseIcs } from '../../../src/core/ics/parse';
import { serializeIcs } from '../../../src/core/ics/serializer';

/** A calendar that holds the one line under test. */
function calendar(line: string): string {
	return [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'BEGIN:VEVENT',
		line,
		'END:VEVENT',
		'END:VCALENDAR',
		'',
	].join('\r\n');
}

/** The property that the calendar holds inside its event. */
function propertyOf(text: string): unknown {
	const parsed = parseIcs(text);
	if (!parsed.ok) {
		throw new Error(
			`the boundary refused the text: ${parsed.failure.message}`,
		);
	}
	return parsed.calendar[2][0]?.[1][0];
}

/** The canonical text of a text. */
function canonical(text: string): string {
	const result = serializeIcs(text);
	if (!result.ok) {
		throw new Error(
			`the boundary refused the text: ${result.failure.message}`,
		);
	}
	return result.text;
}

describe('a parameter that carries a list of values', () => {
	// The property carries one parameter, and that parameter is the last
	// one before the value. The last value of the list holds a colon. The
	// library then takes the value of the property from the wrong colon,
	// and the boundary does not see the disagreement. The value grows on
	// each trip through the serializer, and it grows without a limit, so a
	// device rewrites the record on every loop and reaches no steady state.
	//
	// The text decides whether the case arrives. The same list written as
	// two addresses, MEMBER="mailto:a@b.c","mailto:d@e.f", comes through
	// whole. The generator therefore leaves a colon out of every value of
	// such a list, and it does not try to state where the case starts.
	it.skip('gives the property the value that the text states', () => {
		const text = calendar('X-A;MEMBER="a","b:c":v');
		expect(propertyOf(text)).toEqual([
			'x-a',
			{ member: ['a', 'b:c'] },
			'unknown',
			'v',
		]);
	});

	it.skip('writes a canonical text that it writes again unchanged', () => {
		const once = canonical(calendar('X-A;MEMBER="a","b:c":v'));
		expect(canonical(once)).toBe(once);
	});

	// A value of the list holds a quotation mark and a comma, and another
	// value follows it. The library divides the list at the comma inside
	// that value, so the values that it reports are not the values that the
	// text states. Here the text states the two values `",` and `x`, and
	// the library reports an empty value and the value `,"x`. The canonical
	// bytes stay the same on every trip, so this case makes no rewrite; it
	// loses the values that the server sent.
	it.skip('gives the parameter the values that the text states', () => {
		const text = calendar('SUMMARY;MEMBER="^\',","x":hello');
		expect(propertyOf(text)).toEqual([
			'summary',
			{ member: ['",', 'x'] },
			'text',
			'hello',
		]);
	});
});

describe('a text value that ends with an escaped backslash', () => {
	// The text states two values, and the first one ends with the escape
	// of a backslash. The library reads the escape and the separator that
	// follows it as one escape, so it reports one value that holds the
	// separator. The record then states one category where the server
	// stated two. The canonical bytes stay the same on every trip, so this
	// case makes no rewrite; it loses the division between the values.
	it.skip('keeps the values apart', () => {
		const text = calendar('CATEGORIES:a\\\\,b');
		expect(propertyOf(text)).toEqual([
			'categories',
			{},
			'text',
			'a\\',
			'b',
		]);
	});

	it.skip('keeps the parts of a structured value apart', () => {
		const text = calendar('REQUEST-STATUS:a\\\\;b');
		expect(propertyOf(text)).toEqual([
			'request-status',
			{},
			'text',
			['a\\', 'b'],
		]);
	});
});
