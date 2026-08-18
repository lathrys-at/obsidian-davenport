import { describe, expect, it } from 'vitest';
import { icsCorpus } from '../../../test/harness/fixtures/ics-corpus';
import { octetLength } from '../../../test/harness/ics-octets';
import { timePoisonHolds } from '../../../test/harness/sweeps/time-poison';
import { canonicalIcs } from './canon';
import { ICS_FOLD_OCTET_LIMIT } from './fold';
import { parseIcs } from './parse';
import { stringifyJCalComponent } from './jcal';

const HEAD = [
	'BEGIN:VCALENDAR',
	'VERSION:2.0',
	'PRODID:-//Davenport//canonical serializer//EN',
];

/** A calendar that holds the given lines. */
function calendar(...lines: string[]): string {
	return [...HEAD, ...lines, 'END:VCALENDAR', ''].join('\r\n');
}

/** A calendar that holds one event, and the event holds the given lines. */
function event(...lines: string[]): string {
	return calendar('BEGIN:VEVENT', 'UID:canon', ...lines, 'END:VEVENT');
}

function canon(text: string): string {
	const result = canonicalIcs(text);
	if (!result.ok) {
		throw new Error(
			`the canon refused the text: ${result.failure.message}`,
		);
	}
	return result.text;
}

/** The library's own serialization of the same content. */
function libraryText(text: string): string {
	const parsed = parseIcs(text);
	if (!parsed.ok) {
		throw new Error(
			`the boundary refused the text: ${parsed.failure.message}`,
		);
	}
	return stringifyJCalComponent(parsed.calendar);
}

/**
 * The logical lines of a text. The reader joins each continuation to the
 * line above it and drops the one space or tab that the fold added.
 */
function logical(text: string): string[] {
	const lines: string[] = [];
	for (const physical of text.split('\r\n')) {
		if (physical === '') {
			continue;
		}
		const above = lines.pop();
		if (
			above !== undefined &&
			(physical.startsWith(' ') || physical.startsWith('\t'))
		) {
			lines.push(above + physical.slice(1));
		} else {
			if (above !== undefined) {
				lines.push(above);
			}
			lines.push(physical);
		}
	}
	return lines;
}

/** The text that these logical lines make, folded at the given limit. */
function foldedAt(lines: readonly string[], limit: number): string {
	const physical: string[] = [];
	for (const line of lines) {
		let current = '';
		let octets = 0;
		for (const character of line) {
			const size = octetLength(character);
			if (octets + size > limit) {
				physical.push(current);
				current = ' ';
				octets = 1;
			}
			current += character;
			octets += size;
		}
		physical.push(current);
	}
	return physical.map((line) => `${line}\r\n`).join('');
}

/** One component of a text, as a tree of lines. */
interface Block {
	name: string;
	properties: string[];
	children: Block[];
}

function readBlocks(lines: readonly string[]): Block {
	const root: Block = { name: '', properties: [], children: [] };
	const open: Block[] = [root];
	for (const line of lines) {
		const current = open[open.length - 1];
		if (current === undefined) {
			throw new Error('the text closes more components than it opens');
		}
		if (line.startsWith('BEGIN:')) {
			const child: Block = {
				name: line.slice('BEGIN:'.length),
				properties: [],
				children: [],
			};
			current.children.push(child);
			open.push(child);
		} else if (line.startsWith('END:')) {
			open.pop();
		} else {
			current.properties.push(line);
		}
	}
	return root;
}

function writeBlocks(block: Block): string[] {
	const inside = [
		...block.properties,
		...block.children.flatMap(writeBlocks),
	];
	return block.name === ''
		? inside
		: [`BEGIN:${block.name}`, ...inside, `END:${block.name}`];
}

function reverseProperties(block: Block): Block {
	return {
		name: block.name,
		properties: [...block.properties].reverse(),
		children: block.children.map(reverseProperties),
	};
}

/**
 * Properties whose value type is text when the property states no type.
 * A `VALUE=TEXT` on one of these says what the format already says.
 */
const TEXT_PROPERTIES: readonly string[] = [
	'ACTION',
	'CATEGORIES',
	'CLASS',
	'COMMENT',
	'CONTACT',
	'DESCRIPTION',
	'LOCATION',
	'METHOD',
	'PRODID',
	'RELATED-TO',
	'RESOURCES',
	'STATUS',
	'SUMMARY',
	'TRANSP',
	'TZID',
	'TZNAME',
	'UID',
	'VERSION',
];

/** The one line of these lines that carries the given name. */
function lineNamed(lines: readonly string[], name: string): string | undefined {
	return lines.find((line) => nameOf(line) === name);
}

function nameOf(line: string): string {
	const end = Math.min(
		...[line.indexOf(';'), line.indexOf(':')].filter((at) => at !== -1),
	);
	return line.slice(0, end);
}

/** Every mutation keeps the meaning of the text and changes its bytes. */
const MUTATIONS: readonly [string, (text: string) => string][] = [
	[
		'reverses the properties of every component',
		(text) =>
			foldedAt(
				writeBlocks(reverseProperties(readBlocks(logical(text)))),
				ICS_FOLD_OCTET_LIMIT,
			),
	],
	['folds the lines at another width', (text) => foldedAt(logical(text), 42)],
	[
		'writes the names of the properties in lower case',
		(text) =>
			foldedAt(
				logical(text).map((line) => {
					const name = nameOf(line);
					return name === 'BEGIN' || name === 'END'
						? line
						: name.toLowerCase() + line.slice(name.length);
				}),
				ICS_FOLD_OCTET_LIMIT,
			),
	],
	[
		'states the value type that the property already has',
		(text) =>
			foldedAt(
				logical(text).map((line) => {
					const name = nameOf(line);
					return TEXT_PROPERTIES.includes(name)
						? `${name};VALUE=TEXT${line.slice(name.length)}`
						: line;
				}),
				ICS_FOLD_OCTET_LIMIT,
			),
	],
];

const COMPOSED = (text: string): string =>
	MUTATIONS.reduce((carried, [, mutate]) => mutate(carried), text);

describe('the canon and the corpus', () => {
	it.each(icsCorpus())('writes one text for $id', (fixture) => {
		expect(canonicalIcs(fixture.content).ok).toBe(true);
	});

	it.each(icsCorpus())('writes $id again unchanged', (fixture) => {
		const once = canon(fixture.content);
		expect(canon(once)).toBe(once);
	});

	it.each(icsCorpus())(
		'ends the text of $id with one carriage return and line feed',
		(fixture) => {
			const text = canon(fixture.content);
			expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
			expect(text.endsWith('\r\n\r\n')).toBe(false);
		},
	);

	it.each(icsCorpus())(
		'holds every physical line of $id inside the octet limit',
		(fixture) => {
			const over = canon(fixture.content)
				.split('\r\n')
				.filter((line) => octetLength(line) > ICS_FOLD_OCTET_LIMIT);
			expect(over).toEqual([]);
		},
	);

	it('folds one line of the corpus to exactly the octet limit', () => {
		const widest = Math.max(
			...icsCorpus().flatMap((fixture) =>
				canon(fixture.content)
					.split('\r\n')
					.map((line) => octetLength(line)),
			),
		);
		expect(widest).toBe(ICS_FOLD_OCTET_LIMIT);
	});

	it.each(icsCorpus())(
		'gives the same text again when the folds of $id are joined and made again',
		(fixture) => {
			const text = canon(fixture.content);
			expect(foldedAt(logical(text), ICS_FOLD_OCTET_LIMIT)).toBe(text);
		},
	);

	it.each(icsCorpus())(
		'writes a text for $id that the boundary reads',
		(fixture) => {
			expect(parseIcs(canon(fixture.content)).ok).toBe(true);
		},
	);
});

describe('the canon and the mutations that keep the meaning', () => {
	for (const [name, mutate] of MUTATIONS) {
		it.each(icsCorpus())(`${name}: $id gives one text`, (fixture) => {
			const mutated = mutate(fixture.content);
			expect(mutated).not.toBe(fixture.content);
			expect(canon(mutated)).toBe(canon(fixture.content));
		});
	}

	it.each(icsCorpus())(
		'takes every mutation together on $id and gives one text',
		(fixture) => {
			const mutated = COMPOSED(fixture.content);
			expect(mutated).not.toBe(fixture.content);
			expect(canon(mutated)).toBe(canon(fixture.content));
		},
	);

	it.each(icsCorpus())(
		'absorbs the serialization of the library for $id',
		(fixture) => {
			expect(canon(libraryText(fixture.content))).toBe(
				canon(fixture.content),
			);
		},
	);
});

describe('the canon and the clock', () => {
	it('writes the corpus while the ambient time functions throw', () => {
		expect(timePoisonHolds()).toBe(true);
		for (const fixture of icsCorpus()) {
			expect(canon(fixture.content).length).toBeGreaterThan(0);
		}
	});
});

describe('the order that the canon writes', () => {
	it('puts the properties of a component in the order of their names', () => {
		expect(logical(canon(event('SUMMARY:b', 'LOCATION:a')))).toEqual([
			'BEGIN:VCALENDAR',
			'PRODID:-//Davenport//canonical serializer//EN',
			'VERSION:2.0',
			'BEGIN:VEVENT',
			'LOCATION:a',
			'SUMMARY:b',
			'UID:canon',
			'END:VEVENT',
			'END:VCALENDAR',
		]);
	});

	it('puts two properties of one name in the order of their lines', () => {
		const lines = logical(canon(event('COMMENT:b', 'COMMENT:a')));
		expect(lines.slice(4, 6)).toEqual(['COMMENT:a', 'COMMENT:b']);
	});

	it('puts the parameters of a property in the order of their names', () => {
		const lines = logical(
			canon(
				event(
					'ATTENDEE;ROLE=REQ-PARTICIPANT;CN=Zoe;PARTSTAT=ACCEPTED:mailto:z@example.com',
				),
			),
		);
		expect(lineNamed(lines, 'ATTENDEE')).toBe(
			'ATTENDEE;CN=Zoe;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:z@example.com',
		);
	});

	it('puts the frequency of a repeat rule first', () => {
		const lines = logical(
			canon(
				event('RRULE:BYDAY=MO;COUNT=5;FREQ=WEEKLY;WKST=SU;INTERVAL=2'),
			),
		);
		expect(lineNamed(lines, 'RRULE')).toBe(
			'RRULE:FREQ=WEEKLY;COUNT=5;INTERVAL=2;BYDAY=MO;WKST=SU',
		);
	});

	it('puts a part that no standard names after the parts that a standard names', () => {
		const lines = logical(
			canon(
				event(
					'RRULE:SKIP=FORWARD;BYMONTHDAY=30;RSCALE=CHINESE;FREQ=MONTHLY',
				),
			),
		);
		expect(lineNamed(lines, 'RRULE')).toBe(
			'RRULE:FREQ=MONTHLY;BYMONTHDAY=30;RSCALE=CHINESE;SKIP=FORWARD',
		);
	});

	it('puts a timezone definition before the event that names it', () => {
		const text = canon(
			calendar(
				'BEGIN:VEVENT',
				'UID:canon',
				'DTSTART;TZID=Etc/GMT+5:20260302T090000',
				'END:VEVENT',
				'BEGIN:VTIMEZONE',
				'TZID:Etc/GMT+5',
				'BEGIN:STANDARD',
				'DTSTART:19700101T000000',
				'TZNAME:GMT+5',
				'TZOFFSETFROM:-0500',
				'TZOFFSETTO:-0500',
				'END:STANDARD',
				'END:VTIMEZONE',
			),
		);
		expect(logical(text).indexOf('BEGIN:VTIMEZONE')).toBeLessThan(
			logical(text).indexOf('BEGIN:VEVENT'),
		);
	});

	it('puts a master before its overrides and orders the overrides by their recurrence id', () => {
		const text = canon(
			calendar(
				'BEGIN:VEVENT',
				'UID:canon',
				'RECURRENCE-ID:20260316T140000Z',
				'DTSTART:20260316T140000Z',
				'END:VEVENT',
				'BEGIN:VEVENT',
				'UID:canon',
				'RECURRENCE-ID;RANGE=THISANDFUTURE:20260309T140000Z',
				'DTSTART:20260309T140000Z',
				'END:VEVENT',
				'BEGIN:VEVENT',
				'UID:canon',
				'DTSTART:20260302T140000Z',
				'RRULE:FREQ=WEEKLY',
				'END:VEVENT',
			),
		);
		const ids = logical(text).filter(
			(line) =>
				line.startsWith('RECURRENCE-ID') || line.startsWith('RRULE'),
		);
		expect(ids).toEqual([
			'RRULE:FREQ=WEEKLY',
			'RECURRENCE-ID;RANGE=THISANDFUTURE:20260309T140000Z',
			'RECURRENCE-ID:20260316T140000Z',
		]);
	});

	it('puts an alarm after the properties of its event and before an unknown component', () => {
		const text = canon(
			calendar(
				'BEGIN:VEVENT',
				'UID:canon',
				'BEGIN:X-VENDOR-BLOCK',
				'X-VENDOR-KEY:1',
				'END:X-VENDOR-BLOCK',
				'BEGIN:VALARM',
				'ACTION:DISPLAY',
				'DESCRIPTION:ring',
				'TRIGGER:-PT15M',
				'END:VALARM',
				'END:VEVENT',
			),
		);
		const lines = logical(text);
		expect(lines.indexOf('BEGIN:VALARM')).toBeLessThan(
			lines.indexOf('BEGIN:X-VENDOR-BLOCK'),
		);
	});
});

/**
 * The parse boundary accepts five changes that it leaves to this module.
 * Two of them move a property that stands beside a component. Three of
 * them are the work on the lines: the width of a fold, a fold that
 * nothing needs, and the line break at the end of a line.
 */
describe('the changes that the parse boundary leaves to the canon', () => {
	it('moves a property that stands after a component in front of it', () => {
		const lines = logical(
			canon(
				calendar(
					'BEGIN:VEVENT',
					'UID:canon',
					'BEGIN:VALARM',
					'ACTION:DISPLAY',
					'DESCRIPTION:ring',
					'TRIGGER:-PT15M',
					'END:VALARM',
					'SUMMARY:after one alarm',
					'END:VEVENT',
				),
			),
		);
		expect(lines.indexOf('SUMMARY:after one alarm')).toBeLessThan(
			lines.indexOf('BEGIN:VALARM'),
		);
	});

	it('moves a property that stands between two components in front of both', () => {
		const lines = logical(
			canon(
				calendar(
					'BEGIN:VEVENT',
					'UID:canon',
					'BEGIN:VALARM',
					'ACTION:DISPLAY',
					'DESCRIPTION:first',
					'TRIGGER:-PT15M',
					'END:VALARM',
					'SUMMARY:between two alarms',
					'BEGIN:VALARM',
					'ACTION:DISPLAY',
					'DESCRIPTION:second',
					'TRIGGER:-PT30M',
					'END:VALARM',
					'END:VEVENT',
				),
			),
		);
		expect(lines.indexOf('SUMMARY:between two alarms')).toBeLessThan(
			lines.indexOf('BEGIN:VALARM'),
		);
	});

	it('folds a line that is longer than the limit', () => {
		const summary = `SUMMARY:${'w'.repeat(200)}`;
		const physical = canon(event(summary)).split('\r\n');
		expect(physical).toContain(`SUMMARY:${'w'.repeat(67)}`);
		expect(physical).not.toContain(summary);
	});

	it('joins a fold that the text makes where no fold is necessary', () => {
		const text = calendar().replace('VERSION:2.0', 'VERSI\r\n ON:2.0');
		expect(logical(canon(text))).toContain('VERSION:2.0');
	});

	it('ends every line with a carriage return and a line feed', () => {
		const text = [...HEAD, 'END:VCALENDAR', ''].join('\n');
		const canonical = canon(text);
		expect(canonical.includes('\r\n')).toBe(true);
		expect(canonical.replaceAll('\r\n', '').includes('\n')).toBe(false);
	});
});

/**
 * Each pair holds one meaning in two spellings that the canon keeps
 * apart. The canon collapses the order of the lines, the folds, the case
 * of a name, and a value type that repeats the default one. It collapses
 * nothing else.
 */
const KEPT_APART: readonly [string, string, string][] = [
	[
		'a list of two values, beside two properties of one value',
		event('EXDATE:20260309T090000Z,20260316T090000Z'),
		event('EXDATE:20260309T090000Z', 'EXDATE:20260316T090000Z'),
	],
	[
		'the order of two values in one property',
		event('EXDATE:20260309T090000Z,20260316T090000Z'),
		event('EXDATE:20260316T090000Z,20260309T090000Z'),
	],
	[
		'the order of two categories',
		event('CATEGORIES:alpha,beta'),
		event('CATEGORIES:beta,alpha'),
	],
	[
		'the case of the value of a parameter',
		event('ATTENDEE;PARTSTAT=ACCEPTED:mailto:z@example.com'),
		event('ATTENDEE;PARTSTAT=accepted:mailto:z@example.com'),
	],
	[
		'an end that a time states, beside an end that a length states',
		event('DTSTART:20260302T090000Z', 'DTEND:20260302T100000Z'),
		event('DTSTART:20260302T090000Z', 'DURATION:PT1H'),
	],
];

describe('what the canon keeps apart', () => {
	it.each(KEPT_APART)('keeps %s', (_name, left, right) => {
		expect(canon(left)).not.toBe(canon(right));
	});
});

describe('the canon and a text that the boundary refuses', () => {
	it('gives the failure of the boundary back', () => {
		const result = canonicalIcs('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failure.problem).toBe('unreadable');
		}
	});

	it('refuses a text that holds two calendars', () => {
		const result = canonicalIcs(`${calendar()}${calendar()}`);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failure.problem).toBe('many-calendars');
		}
	});
});
