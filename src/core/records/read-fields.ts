/**
 * The read of the modeled event fields of a record, and of the schedule
 * inside those fields.
 *
 * The fields of a record are the fields of an event, without the friendly
 * name of the calendar. The record never holds that name, because the
 * plugin resolves it from the href of the collection at read time.
 *
 * The schedule takes one of two shapes, and the shape states its own
 * kind. A timed schedule states a start, and an end or a length of time.
 * An all-day schedule states a date, and it can state a last date. The
 * reader refuses a schedule that mixes the keys of the two shapes.
 */

import type {
	EventClass,
	EventStatus,
	ItemType,
	RsvpResponse,
	Schedule,
	Transparency,
} from '../model/event';
import type { RecordFields } from '../model/record';
import type { Loaded } from './loader';
import type { Read } from './read-values';
import {
	collect,
	maybe,
	optionalInteger,
	optionalMap,
	optionalOneOf,
	optionalText,
	optionalTexts,
	requiredText,
	unknownKey,
} from './read-values';

const FIELD_KEYS: readonly string[] = [
	'summary',
	'schedule',
	'timezone',
	'rrule',
	'type',
	'task',
	'due',
	'completed',
	'priority',
	'rsvp',
	'description',
	'attachments',
	'alarm',
	'location',
	'categories',
	'class',
	'transp',
	'status',
];

const ITEM_TYPES: readonly ItemType[] = ['event', 'task', 'block'];
const RSVP_VALUES: readonly RsvpResponse[] = [
	'accepted',
	'declined',
	'tentative',
];
const CLASS_VALUES: readonly EventClass[] = [
	'public',
	'private',
	'confidential',
];
const TRANSP_VALUES: readonly Transparency[] = ['opaque', 'transparent'];
const STATUS_VALUES: readonly EventStatus[] = [
	'tentative',
	'confirmed',
	'cancelled',
];
const SCHEDULE_KINDS: readonly Schedule['kind'][] = ['timed', 'all-day'];

/** Reads the modeled fields of a record. */
export function readFields(node: Loaded | undefined): Read<RecordFields> {
	const inside = optionalMap(node, 'fields');
	if (!inside.ok) {
		return inside;
	}
	const entries = inside.value;
	if (entries === undefined) {
		return { ok: false, message: 'the record states no fields' };
	}
	const unknown = unknownKey(entries, FIELD_KEYS);
	if (unknown !== null) {
		return { ok: false, message: unknown };
	}
	const problems: string[] = [];
	const type = collect(
		optionalOneOf<ItemType>(entries, 'type', ITEM_TYPES),
		problems,
	);
	const fields: RecordFields = {
		...maybe(
			'summary',
			collect(optionalText(entries, 'summary'), problems),
		),
		...maybe(
			'schedule',
			collect(readSchedule(entries.get('schedule')), problems),
		),
		...maybe(
			'timezone',
			collect(optionalText(entries, 'timezone'), problems),
		),
		...maybe('rrule', collect(optionalText(entries, 'rrule'), problems)),
		type: type ?? 'event',
		...maybe('task', collect(optionalText(entries, 'task'), problems)),
		...maybe('due', collect(optionalText(entries, 'due'), problems)),
		...maybe(
			'completed',
			collect(optionalText(entries, 'completed'), problems),
		),
		...maybe(
			'priority',
			collect(optionalInteger(entries, 'priority'), problems),
		),
		...maybe(
			'rsvp',
			collect(optionalOneOf(entries, 'rsvp', RSVP_VALUES), problems),
		),
		...maybe(
			'description',
			collect(optionalText(entries, 'description'), problems),
		),
		...maybe(
			'attachments',
			collect(optionalTexts(entries, 'attachments'), problems),
		),
		...maybe('alarm', collect(optionalText(entries, 'alarm'), problems)),
		...maybe(
			'location',
			collect(optionalText(entries, 'location'), problems),
		),
		...maybe(
			'categories',
			collect(optionalTexts(entries, 'categories'), problems),
		),
		...maybe(
			'class',
			collect(optionalOneOf(entries, 'class', CLASS_VALUES), problems),
		),
		...maybe(
			'transp',
			collect(optionalOneOf(entries, 'transp', TRANSP_VALUES), problems),
		),
		...maybe(
			'status',
			collect(optionalOneOf(entries, 'status', STATUS_VALUES), problems),
		),
	};
	if (type === undefined) {
		problems.push('the fields of the record state no type');
	}
	return problems.length > 0
		? { ok: false, message: problems.join('; ') }
		: { ok: true, value: fields };
}

/** Reads the schedule of a record. */
export function readSchedule(node: Loaded | undefined): Read<Schedule> {
	const inside = optionalMap(node, 'schedule');
	if (!inside.ok) {
		return inside;
	}
	const entries = inside.value;
	if (entries === undefined) {
		return { ok: true, value: undefined };
	}
	const kind = optionalOneOf<Schedule['kind']>(
		entries,
		'kind',
		SCHEDULE_KINDS,
	);
	if (!kind.ok) {
		return kind;
	}
	if (kind.value === 'timed') {
		return readTimed(entries);
	}
	if (kind.value === 'all-day') {
		return readAllDay(entries);
	}
	return { ok: false, message: 'the schedule of the record states no kind' };
}

function readTimed(entries: ReadonlyMap<string, Loaded>): Read<Schedule> {
	const unknown = unknownKey(entries, ['kind', 'start', 'end', 'duration']);
	if (unknown !== null) {
		return { ok: false, message: unknown };
	}
	const problems: string[] = [];
	const start = collect(requiredText(entries, 'start'), problems);
	const value: Schedule = {
		kind: 'timed',
		start: start ?? '',
		...maybe('end', collect(optionalText(entries, 'end'), problems)),
		...maybe(
			'duration',
			collect(optionalText(entries, 'duration'), problems),
		),
	};
	return problems.length > 0
		? { ok: false, message: problems.join('; ') }
		: { ok: true, value };
}

function readAllDay(entries: ReadonlyMap<string, Loaded>): Read<Schedule> {
	const unknown = unknownKey(entries, ['kind', 'date', 'endDate']);
	if (unknown !== null) {
		return { ok: false, message: unknown };
	}
	const problems: string[] = [];
	const date = collect(requiredText(entries, 'date'), problems);
	const value: Schedule = {
		kind: 'all-day',
		date: date ?? '',
		...maybe(
			'endDate',
			collect(optionalText(entries, 'endDate'), problems),
		),
	};
	return problems.length > 0
		? { ok: false, message: problems.join('; ') }
		: { ok: true, value };
}
