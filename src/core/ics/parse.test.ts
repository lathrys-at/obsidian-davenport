import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import { icsCorpus } from '../../../test/harness/fixtures/ics-corpus';
import type { JCalComponent } from './jcal';
import type { IcsParseFailure, IcsParseProblem } from './parse';
import { parseIcs } from './parse';

const HEAD = [
	'BEGIN:VCALENDAR',
	'VERSION:2.0',
	'PRODID:-//Davenport//parse boundary//EN',
];

/** A calendar that holds the given lines. */
function calendar(...lines: string[]): string {
	return [...HEAD, ...lines, 'END:VCALENDAR', ''].join('\r\n');
}

/** A calendar that holds one event, and the event holds the given lines. */
function event(...lines: string[]): string {
	return calendar(
		'BEGIN:VEVENT',
		'UID:parse-boundary',
		...lines,
		'END:VEVENT',
	);
}

function calendarOf(text: string): JCalComponent {
	const result = parseIcs(text);
	if (!result.ok) {
		throw new Error(
			`the boundary refused the text: ${result.failure.message}`,
		);
	}
	return result.calendar;
}

function failureOf(text: string): IcsParseFailure {
	const result = parseIcs(text);
	if (result.ok) {
		throw new Error('the boundary accepted text that it must refuse');
	}
	return result.failure;
}

describe('the parse boundary and the corpus', () => {
	it.each(icsCorpus())('accepts $id', (fixture) => {
		expect(parseIcs(fixture.content).ok).toBe(true);
	});

	it.each(icsCorpus())(
		'reports for $id the structure that the library reports',
		(fixture) => {
			const direct: unknown = ICAL.parse(fixture.content);
			expect(calendarOf(fixture.content)).toEqual(direct);
		},
	);

	it.each(icsCorpus())(
		'serializes $id to the bytes that the library serializes',
		(fixture) => {
			const direct: unknown = ICAL.parse(fixture.content);
			expect(ICAL.stringify([...calendarOf(fixture.content)])).toBe(
				ICAL.stringify(direct as unknown[]),
			);
		},
	);

	it('names VCALENDAR as the root of every fixture', () => {
		for (const fixture of icsCorpus()) {
			expect(calendarOf(fixture.content)[0]).toBe('vcalendar');
		}
	});
});

// Each text makes the library throw, and the classes of the errors
// differ. The boundary reports one problem for every one of these texts.
const THROWING: [string, string][] = [
	['text that opens no component', 'VERSION:2.0\r\n'],
	['a component that never ends', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'],
	['a line that holds no separator', calendar('BOGUSLINE')],
	['a parameter that holds no value', calendar('X-NOTE;BROKEN:value')],
	[
		'a repeat rule with a frequency that does not exist',
		event('RRULE:FREQ=BOGUS'),
	],
	[
		'a repeat rule with a count that holds no number',
		event('RRULE:FREQ=DAILY;COUNT=nan'),
	],
];

describe('the parse boundary and the errors of the library', () => {
	it.each(THROWING)('refuses %s', (_name, text) => {
		expect(failureOf(text).problem).toBe('unreadable');
	});

	it('meets more than one class of error', () => {
		const classes = new Set(
			THROWING.map(([, text]) => {
				const cause: unknown = failureOf(text).cause;
				return cause instanceof Error ? cause.constructor.name : 'none';
			}),
		);
		expect(classes.size).toBeGreaterThan(1);
		expect(classes.has('none')).toBe(false);
	});

	it('keeps the error of the library as the cause and not in the message', () => {
		const failure = failureOf('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n');
		expect(failure.cause).toBeInstanceOf(Error);
		expect((failure.cause as Error).message).toContain(
			'component began but did not end',
		);
		expect(failure.message).toBe(
			'ics parse: the library cannot read the text',
		);
	});

	it('writes no text of the library into the message', () => {
		for (const [, text] of THROWING) {
			expect(failureOf(text).message).toBe(
				'ics parse: the library cannot read the text',
			);
		}
	});
});

describe('the parse boundary and the count of calendars', () => {
	it('refuses two calendars in one text', () => {
		const failure = failureOf(
			calendar('X-NOTE:one') + calendar('X-NOTE:two'),
		);
		expect(failure.problem).toBe('many-calendars');
		expect(failure.message).toContain('2 calendars');
	});

	it('refuses three calendars in one text', () => {
		const failure = failureOf(calendar('X-NOTE:one').repeat(3));
		expect(failure.problem).toBe('many-calendars');
		expect(failure.message).toContain('3 calendars');
	});

	it('refuses a text that holds no calendar', () => {
		expect(failureOf('').problem).toBe('no-calendar');
		expect(failureOf('   ').problem).toBe('no-calendar');
	});

	it('accepts one calendar', () => {
		expect(calendarOf(calendar('X-NOTE:one'))[0]).toBe('vcalendar');
	});
});

// The library accepts every text below, and it then gives each text a
// meaning of its own. The boundary refuses every one of these texts.
const REFUSED: [string, string, IcsParseProblem][] = [
	[
		'an END that names another component',
		calendar(
			'BEGIN:VEVENT',
			'UID:a',
			'DTSTART:20260101T090000Z',
			'END:VTODO',
		),
		'structure',
	],
	[
		'an integer that holds no number',
		calendar('X-COUNT;VALUE=INTEGER:not-a-number'),
		'value',
	],
	['a start that holds no time', event('DTSTART:garbage'), 'value'],
	[
		'a value that holds a control character',
		calendar('X-NOTE:before\u0000after'),
		'structure',
	],
	[
		'a float that holds no number',
		calendar('X-RATIO;VALUE=FLOAT:not-a-float'),
		'value',
	],
	[
		'a float that holds more than the parser reads',
		calendar('X-RATIO;VALUE=FLOAT:1.5;2.5'),
		'value',
	],
	[
		'a boolean that holds no boolean',
		calendar('X-FLAG;VALUE=BOOLEAN:garbage'),
		'value',
	],
	[
		'a period that holds no period',
		event('RDATE;VALUE=PERIOD:garbage'),
		'value',
	],
	['a repeat rule that holds no parts', event('RRULE:garbage'), 'not-jcal'],
	[
		'a repeat rule part that holds no value',
		event('RRULE:FREQ=DAILY;JUNK'),
		'not-jcal',
	],
	[
		'a repeat rule part that occurs two times',
		event('RRULE:FREQ=DAILY;COUNT=5;COUNT=6'),
		'value',
	],
	['a duration that holds no duration', event('DURATION:garbage'), 'value'],
	[
		'an offset that holds no offset',
		calendar('X-OFFSET;VALUE=UTC-OFFSET:garbage'),
		'value',
	],
	['coordinates that hold no numbers', event('GEO:nope;alsonope'), 'value'],
	[
		'a parameter name that occurs two times',
		calendar('X-NOTE;X-KEY=one;X-KEY=two:value'),
		'structure',
	],
	[
		'a line that opens a component and carries a parameter',
		calendar('BEGIN;X-KEY=1:VEVENT', 'UID:a', 'END:VEVENT'),
		'structure',
	],
	[
		'a line that continues a line that does not exist',
		` ${calendar('X-NOTE:one')}`,
		'structure',
	],
	[
		'a parameter with no equals sign before the value',
		calendar('X-NOTE;X-KEY=one;X-OTHER:value'),
		'structure',
	],
	[
		'two quoted values on a parameter that carries one',
		calendar('X-NOTE;X-KEY="one","two":value'),
		'value',
	],
	[
		'a series end that holds no date',
		event('RRULE:FREQ=DAILY;UNTIL=garbage'),
		'value',
	],
	[
		'a series end in the extended form',
		event('RRULE:FREQ=DAILY;UNTIL=2026-12-31'),
		'value',
	],
	[
		'an interval with a fraction',
		event('RRULE:FREQ=DAILY;INTERVAL=1.5'),
		'value',
	],
	['an interval below one', event('RRULE:FREQ=DAILY;INTERVAL=-3'), 'value'],
	['an interval of zero', event('RRULE:FREQ=DAILY;INTERVAL=0'), 'value'],
	['a count with a fraction', event('RRULE:FREQ=DAILY;COUNT=1.9'), 'value'],
	[
		'a count past the width of a number',
		event('RRULE:FREQ=DAILY;COUNT=99999999999999999999'),
		'value',
	],
	[
		'an exclusion rule with a fraction',
		event('EXRULE:FREQ=DAILY;INTERVAL=2.7'),
		'value',
	],
	[
		'a day that a list repeats',
		event('RRULE:FREQ=WEEKLY;BYDAY=MO,MO'),
		'value',
	],
	[
		'a day of the month that holds letters',
		event('RRULE:FREQ=MONTHLY;BYMONTHDAY=5x'),
		'value',
	],
	[
		'a sequence past the width of a number',
		event('SEQUENCE:9007199254740993'),
		'value',
	],
	[
		'an integer past the width of a number',
		calendar('X-COUNT;VALUE=INTEGER:99999999999999999999'),
		'value',
	],
	[
		'a float past the width of a number',
		calendar('X-RATIO;VALUE=FLOAT:1.0000000000000001'),
		'value',
	],
	[
		'coordinates past the width of a number',
		event('GEO:46.18100000000000001;6.156'),
		'value',
	],
	[
		'a backslash before a comma in a parameter',
		calendar('X-PLACE;X-NAME=Foo\\, Bar:value'),
		'value',
	],
	[
		'a backslash before a comma in a name',
		event('ATTENDEE;CN=Foo\\, Bar:mailto:someone@example.test'),
		'value',
	],
	[
		'two backslashes in a parameter',
		calendar('X-PLACE;X-NAME=a\\\\b:value'),
		'value',
	],
	[
		'a backslash before a semicolon in a quoted parameter',
		calendar('X-PLACE;X-NAME="a\\;b":value'),
		'value',
	],
];

describe('the parse boundary and the values that the library repairs', () => {
	it.each(REFUSED)('refuses %s', (_name, text, problem) => {
		expect(failureOf(text).problem).toBe(problem);
	});

	it('carries no cause when the library threw nothing', () => {
		for (const [, text] of REFUSED) {
			expect(failureOf(text).cause).toBeUndefined();
		}
	});
});

const ACCEPTED: [string, string][] = [
	['coordinates that end in a zero', event('GEO:46.1810;6.1560')],
	[
		'a repeat rule with a list of days',
		event('RRULE:FREQ=WEEKLY;COUNT=5;BYDAY=MO,TU'),
	],
	[
		'a repeat rule with a part that no standard names',
		event('RRULE:FREQ=DAILY;X-VENDOR=1'),
	],
	[
		'two exclusions on one line',
		event('EXDATE:20260101T000000Z,20260102T000000Z'),
	],
	['exclusions that are dates', event('EXDATE;VALUE=DATE:20260101,20260102')],
	[
		'a period that ends with a duration',
		event('RDATE;VALUE=PERIOD:20260101T000000Z/PT1H'),
	],
	['a duration in weeks', event('DURATION:-P2W')],
	[
		'an offset that carries seconds',
		calendar('X-OFFSET;VALUE=UTC-OFFSET:+001932'),
	],
	[
		'a parameter with more than one value',
		calendar('X-TAGS;X-LIST=alpha,beta:value'),
	],
	[
		'a parameter value that holds a backslash and the letter n',
		calendar('X-PLACE;X-PATH="C:\\new\\dir":value'),
	],
	['a value that holds a horizontal tab', calendar('X-NOTE:before\tafter')],
	[
		'line breaks that carry no carriage return',
		'BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR\n',
	],
	[
		'a component that no standard names',
		calendar('BEGIN:X-BLOCK', 'X-NOTE:one', 'END:X-BLOCK'),
	],
	[
		'an inch mark in a parameter value',
		calendar('X-NOTE;X-SIZE=5" pipe:value'),
	],
	[
		'an inch mark in a structured location',
		event('X-APPLE-STRUCTURED-LOCATION;X-TITLE=5" Pipe Room:geo:1,2'),
	],
	[
		'an inch mark before a further parameter',
		calendar('X-NOTE;X-SIZE=5" pipe;X-OTHER=2:value'),
	],
	['a quotation mark inside a word', calendar('X-NOTE;X-KEY=a"b:value')],
	[
		'a quotation mark that opens nothing',
		calendar('X-NOTE;X-KEY=say "hi:value'),
	],
	[
		'two quotation marks that enclose a semicolon',
		calendar('X-NOTE;X-KEY=a"b;X-OTHER=c"d:value'),
	],
	[
		'a name between quotation marks',
		event('ATTENDEE;CN=John "Jack" Smith:mailto:jack@example.test'),
	],
	[
		'a parameter that carries values in separate quotation marks',
		event(
			'ATTENDEE;MEMBER="mailto:a@example.test","mailto:b@example.test":mailto:c@example.test',
		),
	],
	['a day with a positive ordinal', event('RRULE:FREQ=MONTHLY;BYDAY=2MO')],
	['a day with an explicit plus', event('RRULE:FREQ=MONTHLY;BYDAY=+2MO')],
	['a day with a negative ordinal', event('RRULE:FREQ=MONTHLY;BYDAY=-1FR')],
	['a negative day of the month', event('RRULE:FREQ=MONTHLY;BYMONTHDAY=-1')],
	[
		'a series end as a date-time',
		event('RRULE:FREQ=DAILY;UNTIL=20261231T000000Z'),
	],
	['a series end as a date', event('RRULE:FREQ=DAILY;UNTIL=20261231')],
	[
		'a rule with many parts',
		event('RRULE:FREQ=YEARLY;BYMONTH=1,7;BYSETPOS=-1;WKST=SU;INTERVAL=2'),
	],
	['an integer with leading zeros', calendar('X-COUNT;VALUE=INTEGER:0012')],
	['an integer with a leading plus', calendar('X-COUNT;VALUE=INTEGER:+12')],
	['a float that ends in zeros', calendar('X-RATIO;VALUE=FLOAT:1.500')],
	['the largest exact integer', event('SEQUENCE:9007199254740991')],
	[
		'a byte-order mark before the calendar',
		`\uFEFF${event('SUMMARY:hello')}`,
	],
	['a text escape that no standard names', event('SUMMARY:bad\\q escape')],
	['a backslash at the end of a text', event('SUMMARY:trailing\\')],
	['a caret in a parameter value', calendar('X-PLACE;X-NAME=a^b:value')],
	['a backslash before a letter', calendar('X-PLACE;X-NAME=a\\b:value')],
	[
		'a parameter escape for a quotation mark',
		calendar("X-PLACE;X-NAME=a^'b:value"),
	],
	['a parameter escape for a caret', calendar('X-PLACE;X-NAME=a^^b:value')],
	[
		'a parameter escape for a line break',
		calendar('X-PLACE;X-NAME=a^nb:value'),
	],
	[
		'a parameter escape that no standard names',
		calendar('X-PLACE;X-NAME=a^zb:value'),
	],
];

describe('the parse boundary and the values that the library keeps', () => {
	it.each(ACCEPTED)('accepts %s', (_name, text) => {
		expect(parseIcs(text).ok).toBe(true);
	});
});

const EVERY_PROBLEM: string[] = [
	'',
	'VERSION:2.0\r\n',
	calendar('X-NOTE:one') + calendar('X-NOTE:two'),
	event('DTSTART:garbage'),
	calendar('BEGIN:VEVENT', 'UID:a', 'END:VTODO'),
	event('RRULE:garbage'),
];

describe('the failure of the parse boundary', () => {
	it('names itself in every message', () => {
		for (const text of EVERY_PROBLEM) {
			expect(failureOf(text).message.startsWith('ics parse: ')).toBe(
				true,
			);
		}
	});

	it('gives one shape for every problem that it reports', () => {
		const problems = new Set<IcsParseProblem>();
		for (const text of EVERY_PROBLEM) {
			const failure = failureOf(text);
			expect(typeof failure.message).toBe('string');
			problems.add(failure.problem);
		}
		expect([...problems].sort()).toEqual([
			'many-calendars',
			'no-calendar',
			'not-jcal',
			'structure',
			'unreadable',
			'value',
		]);
	});
});

describe('the messages of the parse boundary', () => {
	it('names the type of a value that disobeys its rules', () => {
		expect(
			failureOf(calendar('X-COUNT;VALUE=INTEGER:zz')).message,
		).toContain('does not obey the rules of the type integer');
	});

	it('points at the value and never at the whole text', () => {
		const texts = [
			event('DTSTART:garbage'),
			calendar('X-COUNT;VALUE=INTEGER:zz'),
			event('RDATE;VALUE=PERIOD:garbage'),
		];
		for (const text of texts) {
			expect(failureOf(text).message).not.toContain('this text');
		}
	});

	it('says what a line holds that the two readings disagree about', () => {
		expect(
			failureOf(calendar('X-NOTE;X-KEY=one;X-OTHER:value')).message,
		).toContain('holds text between its last parameter and its value');
	});

	it('names the number that the parser read', () => {
		expect(failureOf(event('SEQUENCE:9007199254740993')).message).toContain(
			'the parser read the number 9007199254740992',
		);
	});

	it('names the rule part that carries a value it cannot hold', () => {
		expect(
			failureOf(event('RRULE:FREQ=DAILY;UNTIL=garbage')).message,
		).toContain('in the rule part UNTIL');
	});

	it('says that a text holds no calendar only when it holds none', () => {
		expect(failureOf('').message).toBe(
			'ics parse: the text holds no calendar',
		);
		expect(
			failureOf(calendar('X-NOTE:one') + calendar('X-NOTE:two')).problem,
		).not.toBe('no-calendar');
	});
});
