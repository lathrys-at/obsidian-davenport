/**
 * The reader of the frontmatter of a note.
 *
 * The reader takes the keys that a note holds and gives three things: the
 * lifecycle intent of the note, the event that the note declares, and the
 * list of the faults that the note carries. The reader never stops at the
 * first fault, because a user who corrects a note must see every fault of
 * that note.
 *
 * The reader passes over each key that the plugin does not own. The user
 * owns such a key, or another plugin owns it. A name that differs only in
 * its capital letters is such a key.
 *
 * The reader reads text, and it reads a list of text. A key that holds a
 * number where the plugin reads text is a fault, and the reader states it.
 * The reader never puts a value of one type into another type, because a
 * plugin that changes what the user wrote is a plugin that the user cannot
 * predict.
 *
 * The reader reads no timezone name and it reads no clock. The check of a
 * note against its calendar states the faults of the zones.
 */

import type {
	EventClass,
	EventFields,
	EventState,
	EventStatus,
	ItemType,
	RsvpResponse,
	Transparency,
} from '../model/event';
import type { Raw } from './reader';
import { Reader } from './reader';
import type { NoteSchedule } from './schedule';
import { readSchedule } from './schedule';
import type { FrontmatterProblem } from './problems';

/** What the reader found in one note. */
export interface NoteReading {
	/**
	 * The lifecycle intent of the note. The value stands apart from the
	 * field set, because it is a signal to the plugin and not a field of
	 * the event. It never reaches the server.
	 */
	readonly state: EventState | null;
	/** The event fields, as the note writes them. */
	readonly fields: EventFields;
	/**
	 * The schedule that the note states. The value is null where the note
	 * states no schedule, and also where two keys of the note contradict
	 * each other.
	 */
	readonly schedule: NoteSchedule | null;
	readonly problems: readonly FrontmatterProblem[];
}

const STATES: readonly EventState[] = ['draft', 'ready'];
const TYPES: readonly ItemType[] = ['event', 'task', 'block'];
const STATUSES: readonly EventStatus[] = [
	'tentative',
	'confirmed',
	'cancelled',
];
const RSVPS: readonly RsvpResponse[] = ['accepted', 'declined', 'tentative'];
const CLASSES: readonly EventClass[] = ['public', 'private', 'confidential'];
const TRANSPARENCIES: readonly Transparency[] = ['opaque', 'transparent'];

/** The values that the priority of a task takes. */
const MIN_PRIORITY = 0;
const MAX_PRIORITY = 9;

/** Reads the frontmatter of one note. */
export function readNote(raw: Raw): NoteReading {
	const problems: FrontmatterProblem[] = [];
	const reader = new Reader(raw, problems);
	const state = reader.word('state', STATES);
	const schedule = readSchedule(reader);
	const fields: Writable<EventFields> = {
		type: reader.word('type', TYPES) ?? 'event',
	};
	assign(fields, 'summary', reader.text('summary'));
	assign(fields, 'calendar', reader.text('calendar'));
	assign(fields, 'timezone', reader.text('timezone'));
	assign(fields, 'rrule', reader.text('rrule'));
	assign(fields, 'task', reader.text('task'));
	assign(fields, 'due', reader.time('due')?.text ?? null);
	assign(fields, 'completed', reader.dateTime('completed')?.text ?? null);
	assign(fields, 'description', reader.text('description'));
	assign(fields, 'location', reader.text('location'));
	assign(fields, 'alarm', reader.duration('alarm')?.text ?? null);
	assign(fields, 'rsvp', reader.word('rsvp', RSVPS));
	assign(fields, 'class', reader.word('class', CLASSES));
	assign(fields, 'transp', reader.word('transp', TRANSPARENCIES));
	assign(fields, 'status', reader.word('status', STATUSES));
	assign(
		fields,
		'priority',
		reader.wholeNumber('priority', MIN_PRIORITY, MAX_PRIORITY),
	);
	assign(fields, 'attachments', reader.list('attachments'));
	assign(fields, 'categories', reader.list('categories'));
	assign(fields, 'schedule', schedule.text);
	return { state, fields, schedule: schedule.value, problems };
}

type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** Puts one field into the set, where the note states that field. */
function assign<K extends keyof EventFields>(
	fields: Writable<EventFields>,
	key: K,
	value: EventFields[K] | null,
): void {
	if (value !== null) {
		fields[key] = value;
	}
}
