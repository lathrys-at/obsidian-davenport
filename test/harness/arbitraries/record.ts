/**
 * Generators of record content for the property tests.
 *
 * A record is a file that the plugin owns. The emitter writes the file
 * from the content, and the reader reads the content back out of the file.
 * Two devices that hold the same server state must write the same bytes,
 * so the emitter must be a pure function of the content and nothing else.
 *
 * The generators here draw the content, and not the file. Two limits keep
 * the drawn content inside what the plugin ever holds:
 *
 * - The base snapshot is the output of the canonical serializer. The
 *   record always holds that form, because the builder puts it there. The
 *   reader gives the same form back, so a base snapshot in another form
 *   would break the comparison for a reason that belongs to the builder
 *   and not to the emitter.
 * - A list and a map are absent or they hold something. The emitter writes
 *   nothing for an empty list and for an empty map, so an empty one and an
 *   absent one reach the same bytes. A property compares content with
 *   content, and it therefore draws only one of the two forms. A property
 *   of its own states that the two forms give one file.
 *
 * The text values hold the characters that make an emitter or a reader
 * fail: the quotation mark, the backslash, the line break, the tab, a
 * control character, a character above the first plane, one half of a
 * surrogate pair, and the byte-order mark.
 */

import fc from 'fast-check';
import type {
	EventClass,
	EventStatus,
	ItemType,
	RsvpResponse,
	Schedule,
	Transparency,
} from '../../../src/core/model/event';
import type { EventIdentity } from '../../../src/core/model/identity';
import type {
	MaterializationEntry,
	RecordData,
	RecordFields,
	VenuePointer,
} from '../../../src/core/model/record';
import type { Tombstone } from '../../../src/core/model/tombstone';
import { serializeCalendar } from '../../../src/core/ics/serializer';
import { icsCalendar } from './ics-model';

/** The characters that make a text hard to write into a record. */
const HARD_CHARACTERS: readonly string[] = [
	'"',
	'\\',
	'\n',
	'\r',
	'\t',
	'\u0001',
	'\u007f',
	'\u2028',
	'\uFEFF',
	'😀',
	'\uD800',
	': ',
	'`',
	'---',
];

const PLAIN_CHARACTERS: readonly string[] = ['a', 'B', '7', ' ', '-', '/'];

/** A text that a record can hold under any key. */
export function recordText(): fc.Arbitrary<string> {
	return fc
		.array(
			fc.oneof(
				{ arbitrary: fc.constantFrom(...PLAIN_CHARACTERS), weight: 3 },
				{ arbitrary: fc.constantFrom(...HARD_CHARACTERS), weight: 2 },
			),
			{ maxLength: 24 },
		)
		.map((parts) => parts.join(''));
}

/** A text that a record can hold, and that is never empty. */
function filledText(): fc.Arbitrary<string> {
	return fc
		.tuple(fc.constantFrom(...PLAIN_CHARACTERS), recordText())
		.map(([head, rest]) => head + rest);
}

/** The pair that names one event on one server. */
export function eventIdentity(): fc.Arbitrary<EventIdentity> {
	return fc.record({
		collectionHref: filledText(),
		uid: filledText(),
	});
}

/** A day, as a record writes one. */
function dayText(): fc.Arbitrary<string> {
	return fc
		.tuple(
			fc.integer({ min: 1900, max: 2099 }),
			fc.integer({ min: 1, max: 12 }),
			fc.integer({ min: 1, max: 28 }),
		)
		.map(
			([year, month, day]) =>
				`${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
		);
}

/** A day with a time of day, as a record writes one. */
function stampText(): fc.Arbitrary<string> {
	return fc
		.tuple(
			dayText(),
			fc.integer({ min: 0, max: 23 }),
			fc.integer({ min: 0, max: 59 }),
		)
		.map(
			([day, hour, minute]) =>
				`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`,
		);
}

/** The schedule of a record, in one of the two shapes. */
export function recordSchedule(): fc.Arbitrary<Schedule> {
	const timed = fc
		.record(
			{
				start: stampText(),
				end: stampText(),
				duration: fc.constantFrom('30m', '1h30m', '2d'),
			},
			{ requiredKeys: ['start'] },
		)
		.map((parts): Schedule => {
			// A timed schedule states an end, or a length of time, or
			// neither of the two. It never states both of them.
			const { start, end, duration } = parts;
			if (end !== undefined) {
				return { kind: 'timed', start, end };
			}
			return duration === undefined
				? { kind: 'timed', start }
				: { kind: 'timed', start, duration };
		});
	const allDay = fc
		.record(
			{ date: dayText(), endDate: dayText() },
			{ requiredKeys: ['date'] },
		)
		.map((parts): Schedule =>
			parts.endDate === undefined
				? { kind: 'all-day', date: parts.date }
				: {
						kind: 'all-day',
						date: parts.date,
						endDate: parts.endDate,
					},
		);
	return fc.oneof(timed, allDay);
}

const TYPES: readonly ItemType[] = ['event', 'task', 'block'];
const RSVPS: readonly RsvpResponse[] = ['accepted', 'declined', 'tentative'];
const CLASSES: readonly EventClass[] = ['public', 'private', 'confidential'];
const TRANSPARENCIES: readonly Transparency[] = ['opaque', 'transparent'];
const STATUSES: readonly EventStatus[] = [
	'tentative',
	'confirmed',
	'cancelled',
];

/** The fields that a record states about one event. */
export function recordFields(): fc.Arbitrary<RecordFields> {
	return fc.record(
		{
			summary: recordText(),
			schedule: recordSchedule(),
			timezone: filledText(),
			rrule: filledText(),
			type: fc.constantFrom(...TYPES),
			task: recordText(),
			due: stampText(),
			completed: stampText(),
			priority: fc.integer({ min: 0, max: 9 }),
			rsvp: fc.constantFrom(...RSVPS),
			description: recordText(),
			attachments: fc.array(recordText(), { minLength: 1, maxLength: 3 }),
			alarm: fc.constantFrom('-15m', '-1h', '0m'),
			location: recordText(),
			categories: fc.array(recordText(), { minLength: 1, maxLength: 3 }),
			class: fc.constantFrom(...CLASSES),
			transp: fc.constantFrom(...TRANSPARENCIES),
			status: fc.constantFrom(...STATUSES),
		},
		{ requiredKeys: ['type'] },
	);
}

/** A pointer at a place inside a note. */
function target(): fc.Arbitrary<VenuePointer & MaterializationEntry> {
	return fc.record(
		{
			path: filledText(),
			section: recordText(),
			contentHash: recordText(),
		},
		{ requiredKeys: ['path'] },
	);
}

/** The map that names the note of each instance of a series. */
function materialization(): fc.Arbitrary<
	Readonly<Record<string, MaterializationEntry>>
> {
	return fc
		.uniqueArray(fc.tuple(dayText(), target()), {
			minLength: 1,
			maxLength: 3,
			selector: ([day]) => day,
		})
		.map((entries) => Object.fromEntries(entries));
}

/** The mark that says the event is gone, and why. */
function tombstone(): fc.Arbitrary<Tombstone> {
	return fc
		.record(
			{
				type: fc.constantFrom<Tombstone['type']>(
					'remote-observed',
					'local-intent',
				),
				annotation: fc.record({
					kind: fc.constantFrom<'converted' | 'moved'>(
						'converted',
						'moved',
					),
					successor: eventIdentity(),
				}),
			},
			{ requiredKeys: ['type'] },
		)
		.map((parts): Tombstone =>
			parts.annotation === undefined
				? { type: parts.type }
				: { type: parts.type, annotation: parts.annotation },
		);
}

/** The hashes of the text that the plugin rendered into a note. */
function renderHashes(): fc.Arbitrary<{
	readonly description?: string;
	readonly attachments?: string;
}> {
	return fc
		.record(
			{ description: filledText(), attachments: filledText() },
			{ requiredKeys: [] },
		)
		.filter((hashes) => Object.keys(hashes).length > 0);
}

/** The digits that the checksum line takes. */
const HEX_DIGITS: readonly string[] = [
	'0',
	'1',
	'2',
	'3',
	'4',
	'5',
	'6',
	'7',
	'8',
	'9',
	'a',
	'b',
	'c',
	'd',
	'e',
	'f',
];

/** A checksum, in the alphabet that the checksum line takes. */
export function checksumText(): fc.Arbitrary<string> {
	return fc
		.array(fc.constantFrom(...HEX_DIGITS), { maxLength: 64 })
		.map((digits) => digits.join(''));
}

/** The base snapshot of a record: the calendar as the serializer writes it. */
export function baseIcsText(): fc.Arbitrary<string> {
	return icsCalendar().map(serializeCalendar);
}

/**
 * The content of one record. One record in five holds the smallest set of
 * keys: the pair, the fields, the base snapshot, the stamp and the
 * checksum. A record of that shape is the ordinary one, and a generator
 * that drew each key on its own chance would almost never reach it.
 */
export function recordData(): fc.Arbitrary<RecordData> {
	return fc.oneof(
		{ arbitrary: wholeRecord(), weight: 4 },
		{ arbitrary: smallestRecord(), weight: 1 },
	);
}

/** A record that holds the keys that every record holds, and no other. */
function smallestRecord(): fc.Arbitrary<RecordData> {
	return fc.record({
		identity: eventIdentity(),
		fields: recordFields(),
		baseIcs: baseIcsText(),
		normalizationVersion: fc.record({
			core: fc.integer({ min: 0, max: 99 }),
		}),
		checksum: checksumText(),
	});
}

function wholeRecord(): fc.Arbitrary<RecordData> {
	return fc
		.record(
			{
				identity: eventIdentity(),
				resourceHref: filledText(),
				etag: filledText(),
				fields: recordFields(),
				baseIcs: baseIcsText(),
				venue: target(),
				materialization: materialization(),
				renderHashes: renderHashes(),
				tombstone: tombstone(),
				normalizationVersion: fc.record(
					{
						core: fc.integer({ min: 0, max: 99 }),
						timezone: fc.integer({ min: 0, max: 99 }),
					},
					{ requiredKeys: ['core'] },
				),
				checksum: checksumText(),
			},
			{
				requiredKeys: [
					'identity',
					'fields',
					'baseIcs',
					'normalizationVersion',
					'checksum',
				],
			},
		)
		.map((data): RecordData => data);
}
