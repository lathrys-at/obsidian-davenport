/**
 * The schedule of a note: which shape the note states, and what stands in
 * that shape.
 *
 * A schedule takes one shape only. The timed shape states a start with a
 * time of day, and then an end or a length. The all-day shape states one
 * day, or a first day and a last day. A note that states a key of each
 * shape states a contradiction, and this module gives such a note no
 * schedule at all. The plugin never chooses a shape for the user.
 *
 * The module gives the schedule in two forms. The value form holds the
 * day, the time of day, and the offset that the reader read, which is what
 * the engine computes with. The text form holds what the note says. Both
 * forms come from one read.
 */

import type { Schedule, TimedSchedule } from '../model/event';
import type { CivilDate } from './datetime';
import type { Duration } from './duration';
import type { DateTimeValue, Read, Reader } from './reader';

/**
 * The schedule of a note, in the form that the engine computes with. A
 * timed schedule states an end, or a length, or neither of the two. A
 * draft that states a start alone is correct.
 */
export type NoteSchedule =
	| {
			readonly kind: 'timed';
			readonly start: DateTimeValue;
			readonly end: DateTimeValue | null;
			readonly duration: Duration | null;
	  }
	| {
			readonly kind: 'all-day';
			readonly date: CivilDate;
			/** The last day of the event. That day is part of the event. */
			readonly endDate: CivilDate | null;
	  };

/** Reads the keys of both shapes, and states the schedule of the note. */
export function readSchedule(reader: Reader): ScheduleForms {
	return shape(reader, {
		start: reader.dateTime('start'),
		end: reader.dateTime('end'),
		duration: reader.duration('duration'),
		date: reader.date('date'),
		endDate: reader.date('endDate'),
	});
}

interface ScheduleParts {
	readonly start: Read<DateTimeValue> | null;
	readonly end: Read<DateTimeValue> | null;
	readonly duration: Read<Duration> | null;
	readonly date: Read<CivilDate> | null;
	readonly endDate: Read<CivilDate> | null;
}

/** The schedule of a note, in the two forms that the reading holds. */
export interface ScheduleForms {
	readonly value: NoteSchedule | null;
	readonly text: Schedule | null;
}

const NO_SCHEDULE: ScheduleForms = { value: null, text: null };

/**
 * The shape of the schedule. A note that states a key of each shape gets
 * no schedule, because the plugin never chooses a shape for the user. A
 * note that states an end two times keeps its start and loses both ends,
 * for the same reason.
 */
function shape(reader: Reader, parts: ScheduleParts): ScheduleForms {
	const timed = reader.holds('start');
	const allDay = reader.holds('date');
	if (timed && allDay) {
		reader.report({ kind: 'shape-conflict', keys: ['date', 'start'] });
		return NO_SCHEDULE;
	}
	reader.needs('end', 'start');
	reader.needs('duration', 'start');
	reader.needs('endDate', 'date');
	if (allDay) {
		return parts.date === null
			? NO_SCHEDULE
			: allDayForms(
					parts.date,
					lastDay(reader, parts.date, parts.endDate),
				);
	}
	if (parts.start === null) {
		return NO_SCHEDULE;
	}
	if (reader.holds('end') && reader.holds('duration')) {
		reader.report({ kind: 'end-conflict', keys: ['end', 'duration'] });
		return timedForms(parts.start, null, null);
	}
	return timedForms(
		parts.start,
		stops(reader, parts.start, parts.end),
		length(reader, parts.duration),
	);
}

/** The two forms of one all-day schedule. */
function allDayForms(
	date: Read<CivilDate>,
	endDate: Read<CivilDate> | null,
): ScheduleForms {
	return {
		value: {
			kind: 'all-day',
			date: date.value,
			endDate: endDate?.value ?? null,
		},
		text:
			endDate === null
				? { kind: 'all-day', date: date.text }
				: { kind: 'all-day', date: date.text, endDate: endDate.text },
	};
}

/** The two forms of one timed schedule. */
function timedForms(
	start: Read<DateTimeValue>,
	end: Read<DateTimeValue> | null,
	duration: Read<Duration> | null,
): ScheduleForms {
	const text: Writable<TimedSchedule> = { kind: 'timed', start: start.text };
	if (end !== null) {
		text.end = end.text;
	}
	if (duration !== null) {
		text.duration = duration.text;
	}
	return {
		value: {
			kind: 'timed',
			start: start.value,
			end: end?.value ?? null,
			duration: duration?.value ?? null,
		},
		text,
	};
}

/**
 * The last day of an all-day event. The reader reports a last day that
 * stands before the first day, and it drops that day.
 */
function lastDay(
	reader: Reader,
	date: Read<CivilDate>,
	endDate: Read<CivilDate> | null,
): Read<CivilDate> | null {
	if (endDate === null) {
		return null;
	}
	if (dayNumber(endDate.value) < dayNumber(date.value)) {
		reader.report({
			kind: 'end-before-start',
			keys: ['date', 'endDate'],
			start: 'date',
			end: 'endDate',
		});
		return null;
	}
	return endDate;
}

/**
 * The end of a timed event. The reader compares the end with the start
 * where the two carry the same kind of zone: both state an offset, or
 * neither states one. Where one states an offset and the other states no
 * offset, the order of the two follows from a zone, and this reader
 * resolves no zone.
 */
function stops(
	reader: Reader,
	start: Read<DateTimeValue>,
	end: Read<DateTimeValue> | null,
): Read<DateTimeValue> | null {
	if (end === null) {
		return null;
	}
	const comparable =
		(start.value.offsetSeconds === null) ===
		(end.value.offsetSeconds === null);
	if (comparable && instant(end.value) < instant(start.value)) {
		reader.report({
			kind: 'end-before-start',
			keys: ['start', 'end'],
			start: 'start',
			end: 'end',
		});
		return null;
	}
	return end;
}

/** The length of a timed event. The length is more than zero. */
function length(
	reader: Reader,
	duration: Read<Duration> | null,
): Read<Duration> | null {
	if (duration === null) {
		return null;
	}
	if (duration.value.negative || duration.value.seconds === 0) {
		reader.report({
			kind: 'duration-not-positive',
			keys: ['duration'],
			key: 'duration',
		});
		return null;
	}
	return duration;
}

/** The seconds of one time, read against the offset that it states. */
function instant(value: DateTimeValue): number {
	const seconds =
		value.time.hour * 3600 + value.time.minute * 60 + value.time.second;
	return dayNumber(value.date) * 86400 + seconds - (value.offsetSeconds ?? 0);
}

/**
 * A number that puts the days of the calendar in order. The number is not
 * a count of days. A comparison of two such numbers gives the order of the
 * two days, which is all that this module needs.
 */
function dayNumber(date: CivilDate): number {
	return date.year * 10000 + date.month * 100 + date.day;
}

type Writable<T> = { -readonly [K in keyof T]: T[K] };
