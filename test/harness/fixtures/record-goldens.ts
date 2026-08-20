/**
 * The golden corpus of the record ledger.
 *
 * The gate holds the record writer to the bytes that it writes for a
 * fixed set of records. Each case of the set reaches at least one rule
 * that no smaller case reaches. The list below states which rule each
 * case reaches. A rule that no case reaches can change without a failure
 * here. A new rule of the writer therefore lands together with a case
 * that reaches the rule.
 *
 * The bytes of a record follow from three things: the rules of the
 * canonical serializer, the serializer of the parse library, and the
 * emitter that writes the frontmatter. The core component of the
 * normalization stamp covers all three. A change to any one of them
 * therefore moves that component, and this gate holds them together.
 *
 * Each set of golden files sits in a directory. The name of the directory
 * carries the value of the core component. The directory `core-1/`
 * therefore holds the bytes that the writer wrote while that component
 * was 1. The layout ties a change of the bytes to a change of the
 * component in three ways.
 *
 * - A change that does not raise the component reads the directory of the
 *   old value. The bytes there differ from the new bytes, and the test
 *   fails and names the component.
 * - A change that raises the component finds no directory for the new
 *   value. The test then names the directory to write.
 * - A set that an earlier value wrote stays in the tree, and a test reads
 *   every set. An old set therefore keeps its work after the writer moves
 *   past it.
 *
 * The environment variable `DAVENPORT_WRITE_RECORD_GOLDENS` makes the test
 * write the set of the current component. The test then fails, so a run
 * that writes a set never reports success.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { RecordInput } from '../../../src/core/records/build';

/** The state of one case, without the calendar that the text below gives. */
export type RecordGoldenState = Omit<RecordInput, 'calendar'>;

/** One case of the gate, with the rule that the case reaches. */
export interface RecordGoldenCase {
	/** The file name of the golden, without its extension. */
	readonly id: string;
	/** The rule of the writer that this case reaches. */
	readonly reaches: string;
	/** The calendar as a server sends it. The text uses CRLF line endings. */
	readonly ics: string;
	/** Everything else that the record states. */
	readonly state: RecordGoldenState;
}

const COLLECTION = 'https://dav.example.com/calendars/ren/work/';

function ics(...lines: string[]): string {
	return [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Davenport//record golden//EN',
		...lines,
		'END:VCALENDAR',
		'',
	].join('\r\n');
}

const NEW_YORK_DEFINITION = [
	'BEGIN:VTIMEZONE',
	'TZID:America/New_York',
	'BEGIN:STANDARD',
	'DTSTART:20071104T020000',
	'TZNAME:EST',
	'TZOFFSETFROM:-0400',
	'TZOFFSETTO:-0500',
	'END:STANDARD',
	'END:VTIMEZONE',
];

const STRANGE_DEFINITION = [
	'BEGIN:VTIMEZONE',
	'TZID:Factory/Line 3',
	'BEGIN:STANDARD',
	'DTSTART:19700101T000000',
	'TZNAME:F3',
	'TZOFFSETFROM:+0130',
	'TZOFFSETTO:+0130',
	'END:STANDARD',
	'END:VTIMEZONE',
];

/**
 * The cases of the gate. Each entry states the rule that the case
 * reaches. The cases stand from the smallest record to the largest, so a
 * reader meets the simple shapes first.
 */
export const RECORD_GOLDEN_CASES: readonly RecordGoldenCase[] = [
	{
		id: 'minimal',
		reaches:
			'The smallest record. The frontmatter holds the pair, the kind of the item, the stamp, and the checksum, and it holds nothing else. The stamp carries the core component alone.',
		ics: ics(
			'BEGIN:VEVENT',
			'UID:minimal',
			'DTSTART:20260302T140000Z',
			'END:VEVENT',
		),
		state: {
			identity: { collectionHref: COLLECTION, uid: 'minimal' },
			fields: { type: 'event' },
		},
	},
	{
		id: 'all-day',
		reaches:
			'The all-day shape of the schedule, beside the timed shape of the other cases. The record states the last date, which the format writes one day later.',
		ics: ics(
			'BEGIN:VEVENT',
			'UID:all-day',
			'DTSTART;VALUE=DATE:20260302',
			'DTEND;VALUE=DATE:20260305',
			'SUMMARY:Conference',
			'END:VEVENT',
		),
		state: {
			identity: { collectionHref: COLLECTION, uid: 'all-day' },
			resourceHref: `${COLLECTION}all-day.ics`,
			etag: '"1a2b3c"',
			fields: {
				type: 'event',
				summary: 'Conference',
				schedule: {
					kind: 'all-day',
					date: '2026-03-02',
					endDate: '2026-03-04',
				},
			},
		},
	},
	{
		id: 'known-zone',
		reaches:
			'A name that the bundled table holds. The server sent a definition for it, and the record drops that definition and keeps the name. The stamp carries the timezone component.',
		ics: ics(
			...NEW_YORK_DEFINITION,
			'BEGIN:VEVENT',
			'UID:known-zone',
			'DTSTART;TZID=America/New_York:20260302T090000',
			'DTEND;TZID=America/New_York:20260302T100000',
			'SUMMARY:Standup',
			'END:VEVENT',
		),
		state: {
			identity: { collectionHref: COLLECTION, uid: 'known-zone' },
			fields: {
				type: 'event',
				summary: 'Standup',
				timezone: 'America/New_York',
				schedule: {
					kind: 'timed',
					start: '2026-03-02T09:00:00',
					end: '2026-03-02T10:00:00',
				},
			},
		},
	},
	{
		id: 'unknown-zone',
		reaches:
			'A name that the bundled table does not hold. The record keeps the definition that the server sent, because no device can write it. The stamp carries no timezone component.',
		ics: ics(
			...STRANGE_DEFINITION,
			'BEGIN:VEVENT',
			'UID:unknown-zone',
			'DTSTART;TZID=Factory/Line 3:20260302T090000',
			'SUMMARY:Shift',
			'END:VEVENT',
		),
		state: {
			identity: { collectionHref: COLLECTION, uid: 'unknown-zone' },
			fields: {
				type: 'event',
				summary: 'Shift',
				timezone: 'Factory/Line 3',
			},
		},
	},
	{
		id: 'series-until',
		reaches:
			'A repeating series whose end stands in universal time, under a start that names a zone. This is the second reach of the bundled table, and it stands beside the first reach in one record.',
		ics: ics(
			'BEGIN:VEVENT',
			'UID:series-until',
			'DTSTART;TZID=America/New_York:20260302T090000',
			'RRULE:FREQ=WEEKLY;UNTIL=20260601T130000Z',
			'SUMMARY:Weekly review',
			'END:VEVENT',
		),
		state: {
			identity: { collectionHref: COLLECTION, uid: 'series-until' },
			fields: {
				type: 'event',
				summary: 'Weekly review',
				timezone: 'America/New_York',
				rrule: 'FREQ=WEEKLY;UNTIL=20260601T130000Z',
			},
		},
	},
	{
		id: 'venue-and-instances',
		reaches:
			'The pointer to the venue and the map of the instances. The keys of the map come from data, so the emitter writes each one in quotation marks, and the entries stand in the order of their code units. The state below states them out of that order.',
		ics: ics(
			'BEGIN:VEVENT',
			'UID:venue-and-instances',
			'DTSTART;TZID=America/New_York:20260302T090000',
			'RRULE:FREQ=WEEKLY;COUNT=3',
			'SUMMARY:Retrospective',
			'END:VEVENT',
		),
		state: {
			identity: {
				collectionHref: COLLECTION,
				uid: 'venue-and-instances',
			},
			fields: {
				type: 'event',
				summary: 'Retrospective',
				timezone: 'America/New_York',
				rrule: 'FREQ=WEEKLY;COUNT=3',
			},
			venue: {
				path: 'Meetings/Retrospective.md',
				section: 'Notes',
				contentHash: 'c0ffee00',
			},
			materialization: {
				'2026-03-16': { path: 'Daily/2026-03-16.md', section: '09:00' },
				'2026-03-02': {
					path: 'Daily/2026-03-02.md',
					section: '09:00',
					contentHash: 'deadbeef',
				},
				'2026-03-09': { path: 'Daily/2026-03-09.md' },
			},
		},
	},
	{
		id: 'tombstone-moved',
		reaches:
			'A tombstone with an annotation. The annotation names the identity that follows this one, and that identity is a pair inside a pair.',
		ics: ics(
			'BEGIN:VEVENT',
			'UID:tombstone-moved',
			'DTSTART:20260302T140000Z',
			'SUMMARY:Moved to home',
			'END:VEVENT',
		),
		state: {
			identity: { collectionHref: COLLECTION, uid: 'tombstone-moved' },
			fields: { type: 'event', summary: 'Moved to home' },
			tombstone: {
				type: 'local-intent',
				annotation: {
					kind: 'moved',
					successor: {
						collectionHref:
							'https://dav.example.com/calendars/ren/home/',
						uid: 'tombstone-moved',
					},
				},
			},
		},
	},
	{
		id: 'every-field',
		reaches:
			'Every field of the schema at one time: a task with a due date, a length of time, a priority, an answer to an invitation, lists of attachments and of categories, and the three fields that take one value out of a fixed set. The state states more than the calendar states, because the gate pins the bytes of the schema and not the agreement between the two.',
		ics: ics(
			'BEGIN:VTODO',
			'UID:every-field',
			'DTSTART:20260302T140000Z',
			'DUE:20260304T170000Z',
			'SUMMARY:Write the report',
			'DESCRIPTION:Two paragraphs.\\n\\nThe second one.',
			'LOCATION:Room 3',
			'CATEGORIES:work,writing',
			'CLASS:PRIVATE',
			'STATUS:CONFIRMED',
			'PRIORITY:2',
			'END:VTODO',
		),
		state: {
			identity: { collectionHref: COLLECTION, uid: 'every-field' },
			resourceHref: `${COLLECTION}every-field.ics`,
			etag: '"W/\\"9\\""',
			fields: {
				type: 'task',
				summary: 'Write the report',
				schedule: {
					kind: 'timed',
					start: '2026-03-02T14:00:00Z',
					duration: '2h30m',
				},
				timezone: 'UTC',
				rrule: 'FREQ=MONTHLY;COUNT=4',
				task: '[[Report]]',
				due: '2026-03-04T17:00:00Z',
				completed: '2026-03-04T16:12:00Z',
				priority: 2,
				rsvp: 'tentative',
				description: 'Two paragraphs.\n\nThe second one.',
				attachments: ['[[chart.png]]', 'https://example.com/brief.pdf'],
				alarm: '-15m',
				location: 'Room 3',
				categories: ['work', 'writing'],
				class: 'private',
				transp: 'transparent',
				status: 'confirmed',
			},
			renderHashes: {
				description: '9f2c1a',
				attachments: '4b7e08',
			},
		},
	},
	{
		id: 'hostile-text',
		reaches:
			'Text that the emitter must escape: a quotation mark, a backslash, a line feed, a tab, a control character, a character above the first plane, a surrogate with no partner, and the mark that some tools put at the front of a file. The pair itself also holds a colon and a space.',
		ics: ics(
			'BEGIN:VEVENT',
			'UID:hostile:text 1',
			'DTSTART:20260302T140000Z',
			'END:VEVENT',
		),
		state: {
			identity: {
				collectionHref: `${COLLECTION}a b/`,
				uid: 'hostile:text 1',
			},
			fields: {
				type: 'event',
				summary:
					'He said "no" \\ then left\n\twith a bell  and a face \u{1f600} and \ud800 alone ﻿',
				location: 'é́ café   line',
			},
		},
	},
	{
		id: 'back-quotes',
		reaches:
			'A value that holds three back quotes. No line of the canonical form can start with a back quote, so the fence of the block keeps its smallest width.',
		ics: ics(
			'BEGIN:VEVENT',
			'UID:back-quotes',
			'DTSTART:20260302T140000Z',
			'DESCRIPTION:A fence ``` inside a value',
			'END:VEVENT',
		),
		state: {
			identity: { collectionHref: COLLECTION, uid: 'back-quotes' },
			fields: {
				type: 'event',
				description: 'A fence ``` inside a value',
			},
		},
	},
];

/** One committed set of golden files. */
export interface RecordGoldenSet {
	/** The value of the core component that wrote this set. */
	readonly core: number;
	/** The path of the directory that holds the set. */
	readonly path: string;
	/** The file names in the set, in sorted order. */
	readonly ids: readonly string[];
}

/** The text of one golden file. */
export interface RecordGoldenEntry {
	readonly id: string;
	readonly text: string;
}

const GOLDEN_ROOT = join(import.meta.dirname, 'records');
const SET_PREFIX = 'core-';
const EXTENSION = '.md';
const WRITE_VARIABLE = 'DAVENPORT_WRITE_RECORD_GOLDENS';

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Every committed set, from the oldest component to the newest. */
export function recordGoldenSets(): readonly RecordGoldenSet[] {
	if (!existsSync(GOLDEN_ROOT)) {
		return [];
	}
	return readdirSync(GOLDEN_ROOT, { withFileTypes: true })
		.filter(
			(entry) => entry.isDirectory() && entry.name.startsWith(SET_PREFIX),
		)
		.map((entry) => readSet(entry.name))
		.sort((left, right) => left.core - right.core);
}

/** The set of one component value, or nothing when no set carries it. */
export function recordGoldenSet(core: number): RecordGoldenSet | undefined {
	return recordGoldenSets().find((set) => set.core === core);
}

/** The path that a set of the given component value takes. */
export function recordGoldenSetPath(core: number): string {
	return join(GOLDEN_ROOT, `${SET_PREFIX}${String(core)}`);
}

/** The text of one file of a set. */
export function recordGoldenText(set: RecordGoldenSet, id: string): string {
	return utf8.decode(readFileSync(join(set.path, `${id}${EXTENSION}`)));
}

/** True when the environment asks the test to write the set. */
export function recordGoldenWriteRequested(): boolean {
	return process.env[WRITE_VARIABLE] !== undefined;
}

/** Writes one set. The function replaces every file that the set holds. */
export function writeRecordGoldenSet(
	core: number,
	entries: readonly RecordGoldenEntry[],
): string {
	const path = recordGoldenSetPath(core);
	mkdirSync(path, { recursive: true });
	for (const entry of entries) {
		writeFileSync(
			join(path, `${entry.id}${EXTENSION}`),
			entry.text,
			'utf8',
		);
	}
	return path;
}

function readSet(directory: string): RecordGoldenSet {
	const path = join(GOLDEN_ROOT, directory);
	return {
		core: Number(directory.slice(SET_PREFIX.length)),
		path,
		ids: readdirSync(path)
			.filter((file) => file.endsWith(EXTENSION))
			.map((file) => file.slice(0, -EXTENSION.length))
			.sort(),
	};
}
