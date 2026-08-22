/**
 * The defects of the parse library, and the rule that the parse boundary
 * keeps for each of them.
 *
 * Every case here starts from a text that the library reads wrongly. The
 * library reports a structure that the text does not state, and it reports
 * no problem while it does so. The boundary reads the text a second time, it
 * sees the difference, and it refuses the text with a message that names the
 * difference.
 *
 * The boundary refuses these texts. The boundary does not correct them, and
 * the reason is the same for every case. The model comes from the library,
 * and the library builds the wrong one. The boundary would have to build the
 * model itself to give the right one. The boundary would then own the parse.
 * It therefore names what is wrong and stops. A refusal that names its
 * reason is an answer that a person can act on. A value that is silently
 * wrong is not one, and a text that grows on every trip is worse than
 * either.
 *
 * A text of a shape that a server sends every day must still come through. A
 * list parameter that holds two addresses is that shape, and this file pins
 * it beside the refusals.
 *
 * Each case is the smallest input that reaches the defect. The generators of
 * the property tests leave these shapes out, because the boundary refuses a
 * text that states one and those tests draw only text that the boundary
 * accepts.
 *
 * The cases at the end come from the fuzzing lane, and the crash corpus
 * holds the input of each of them as a file.
 */

import { describe, expect, it } from 'vitest';
import type { IcsParseFailure } from '../../../src/core/ics/parse';
import { parseIcs } from '../../../src/core/ics/parse';
import { serializeIcs } from '../../../src/core/ics/serializer';
import { icsCrashCorpus } from '../../harness/fixtures/ics-crash-corpus';

/** The text of one file of the crash corpus. */
function icsCrashFixture(id: string): string {
	const found = icsCrashCorpus().find((fixture) => fixture.id === id);
	if (found === undefined) {
		throw new Error(`the crash corpus holds no fixture named ${id}`);
	}
	return found.content;
}

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

/** The refusal of a text. The helper throws where the boundary accepts. */
function refusalOf(text: string): IcsParseFailure {
	const parsed = parseIcs(text);
	if (parsed.ok) {
		throw new Error('the boundary accepted the text');
	}
	return parsed.failure;
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
	// The property carries one parameter, and that parameter is the last one
	// before the value. The last value of the list holds a colon. The library
	// adds the lengths of the values of that parameter to the place where the
	// text of the parameter starts, and it counts none of the characters that
	// stand between two values. It then takes the first colon at or after
	// that sum, which is a colon inside the last value. The library reports
	// the parameter correctly and the value of the property wrongly.
	//
	// The value that the library reports holds the tail of the parameter, so
	// the canonical text is longer than the text that went in, and it grows
	// again on the next trip. A device that kept such a record would rewrite
	// it on every loop and reach no steady state. The boundary refuses the
	// text, and the growth stops there.
	it('refuses a line whose list parameter moves the start of the value', () => {
		const failure = refusalOf(calendar('X-A;MEMBER="a","b:c":v'));
		expect(failure.problem).toBe('value');
		expect(failure.message).toContain('the library does not count');
	});

	// The refusal stands in front of the serializer as well. The boundary
	// reads the text before it writes anything, so the text of this shape
	// reaches no canonical form and starts no growth.
	it('writes no canonical text for that line', () => {
		const result = serializeIcs(calendar('X-A;MEMBER="a","b:c":v'));
		expect(result.ok).toBe(false);
	});

	// The same parameter with another parameter after it. The library reads
	// this line correctly, because it computes the start of the value from
	// the last parameter and that one counts its whole text. The canonical
	// serializer writes the parameters in the order of their names, so MEMBER
	// stands last in the canonical text. The engine would then write a text
	// that it cannot read back. The check therefore reads every parameter of
	// the line, and the boundary refuses this line as well.
	it('refuses a line whose middle parameter moves the start of the value', () => {
		const failure = refusalOf(calendar('X-A;MEMBER="a","b:c";ZZZ=1:v'));
		expect(failure.problem).toBe('value');
		expect(failure.message).toContain('the parameter MEMBER');
	});

	// The characters that the library does not count are three for each
	// value after the first, so the list of two addresses below keeps its
	// colon out of them and comes through whole. This is the shape that a
	// server sends. The rule of this file is a refusal of the damaged text
	// and not a refusal of the construct, and this case is what states the
	// difference. A third address in the same list moves the count by three
	// more characters, the colon of the last address falls inside them, and
	// the boundary refuses that text.
	it('reads a list parameter that holds two addresses', () => {
		const text = calendar(
			'ATTENDEE;MEMBER="mailto:a@b.c","mailto:d@e.f":mailto:x@y.z',
		);
		const parsed = parseIcs(text);
		expect(parsed.ok).toBe(true);
		const once = canonical(text);
		expect(once).toContain('"mailto:a@b.c","mailto:d@e.f"');
		expect(once).toContain(':mailto:x@y.z');
		expect(canonical(once)).toBe(once);
	});

	// A value of the list holds a quotation mark and a comma, and another
	// value follows it. The library decodes the escapes of the whole span
	// before it divides the span at the comma between two values, so the
	// escape of a quotation mark becomes a part of a divider. Here the text
	// states the two values `",` and `x`, and the library reports an empty
	// value and the value `,"x`. The bytes of the canonical text stand still
	// from the first canonical form onward, so this shape makes no rewrite.
	// It loses the values that the server sent, and nothing else sees the
	// loss. The boundary compares the values one against one and refuses.
	it('refuses a line whose list parameter holds a quotation mark beside a comma', () => {
		const failure = refusalOf(calendar('SUMMARY;MEMBER="^\',","x":hello'));
		expect(failure.problem).toBe('value');
		expect(failure.message).toContain('the parameter MEMBER');
	});
});

describe('a text value that ends with an escaped backslash', () => {
	// The text states two values, and the first one ends with the escape of a
	// backslash. The library treats one backslash in front of a separator as
	// an escape of that separator, and the format asks for an odd number of
	// them. The library therefore reads the escape and the separator after it
	// as one escape, and it reports one value that holds the separator. The
	// record would then state one category where the server stated two. The
	// bytes of the canonical text stand still from the first canonical form
	// onward, so this shape makes no rewrite; it loses the division between
	// the values. The boundary divides the text with the rule of the format,
	// counts the pieces, and refuses.
	it('refuses a line whose values the library joins', () => {
		const failure = refusalOf(calendar('CATEGORIES:a\\\\,b'));
		expect(failure.problem).toBe('value');
		expect(failure.message).toContain('carries 2 values');
	});

	// The same rule holds for the parts of a structured value. The library
	// reports one text where the text states two parts, and it loses the
	// structure of the value as well as the division.
	it('refuses a line whose parts of a structured value the library joins', () => {
		const failure = refusalOf(calendar('REQUEST-STATUS:a\\\\;b'));
		expect(failure.problem).toBe('value');
		expect(failure.message).toContain('carries 2 parts');
	});
});

describe('a carriage return inside a line', () => {
	// A line ends at a line feed. A carriage return that no line feed follows
	// is one more character of the line, and the library holds that rule. The
	// reader of the boundary ended a line at such a carriage return, so the
	// check for a control character read a line that no longer held the
	// character. The reader now holds the rule of the library, the check sees
	// the character, and the boundary refuses the text. The format forbids
	// every control character except the horizontal tab, so no reading of
	// this text keeps it.
	it('refuses a text whose value holds a carriage return', () => {
		const failure = refusalOf(
			icsCrashFixture('carriage-return-in-a-value'),
		);
		expect(failure.problem).toBe('structure');
		expect(failure.message).toContain(
			'holds a character that iCalendar does not permit',
		);
	});
});

describe('a value type that carries an escape', () => {
	// The parse turns the VALUE parameter into the name of the value type of
	// the property, and it decodes the escapes of a parameter value on the
	// way. The serializer writes that name back raw: it writes no escape and
	// no quotation marks. A name that carried an escape therefore loses bytes
	// on each trip, and the canonical text is no fixed point. The boundary
	// holds the value type to the same promise as every other parameter: the
	// name that the parser reports must keep the bytes that the text writes,
	// apart from the case of the letters.
	it('refuses a text whose value type loses a caret', () => {
		const failure = refusalOf(
			icsCrashFixture('value-type-carries-an-escape'),
		);
		expect(failure.problem).toBe('value');
		expect(failure.message).toContain('the parser read the value type');
	});

	// Here the parameter holds a backslash and the letter n, which the
	// library reads as a line break. The serializer wrote that line break
	// into the parameter, and the library could not read the text that came
	// out. The same rule refuses the text.
	it('refuses a text whose value type becomes a line break', () => {
		const failure = refusalOf(
			icsCrashFixture('value-type-carries-a-line-break'),
		);
		expect(failure.problem).toBe('value');
		expect(failure.message).toContain('the parser read the value type');
	});

	// A value type that needs no escape still passes. The name goes through
	// the parse and the serializer with its bytes, and only the case of the
	// letters changes.
	it('reads a value type that carries no escape', () => {
		const text = calendar('X-A;VALUE=date-time:19000101T000000');
		expect(parseIcs(text).ok).toBe(true);
		const once = canonical(text);
		expect(once).toContain('VALUE=DATE-TIME');
		expect(canonical(once)).toBe(once);
	});
});
