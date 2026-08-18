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

	it('keeps the error of the library as the cause', () => {
		const failure = failureOf('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n');
		expect(failure.cause).toBeInstanceOf(Error);
		expect(failure.message).toContain('component began but did not end');
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
