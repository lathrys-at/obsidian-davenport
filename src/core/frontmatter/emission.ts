/**
 * The times that a schedule of a note gives to the calendar format.
 *
 * The two formats state the end of an event in two different ways. A note
 * states the last day of an all-day event, and that day is part of the
 * event. The calendar format states the first day after the event. This
 * module converts the one into the other, and it adds the day across the
 * end of a month and across the end of a year. Users think of the last day
 * as part of the event, and the exclusive end of the format is the usual
 * cause of an error of one day.
 *
 * The module always states an end for an all-day event. A note that states
 * one day therefore reaches the server as one whole day, and no reader has
 * to know what a missing end means.
 *
 * A timed event states its start, and then its end or its length. Where
 * the note states a length, this module states that length to the format
 * and computes no end. A length says what the user wrote, and a computed
 * end would state another meaning across a change of the clock.
 *
 * The zone of a time comes from the resolution order. A time that states
 * an offset reaches the format as universal time. A time that states no
 * offset reaches the format as a wall time under the name of a zone, and
 * the calendar that carries it must also carry the definition of that
 * zone. The module names each zone that it used, so the caller writes
 * those definitions. No result of this module can carry the zone of the
 * device.
 *
 * Each value stands in the form that the calendar library takes, which
 * keeps the separators of the day and of the time of day. The library
 * writes the short form of the format from that text.
 */

import { civilDateTime, civilSeconds, daysInMonth } from '../timezone/calendar';
import type { CivilDate, CivilTime } from './datetime';
import { icsDuration } from './duration';
import type { SchemaKey } from './keys';
import type { DateTimeValue } from './reader';
import type { NoteSchedule } from './schedule';
import type { FrontmatterProblem } from './problems';
import type { ResolvedZone, ZoneContext } from './zone';
import { resolveZone } from './zone';

/**
 * One time, in the form that the calendar library takes. The kind is the
 * value type of the property, and the text is the value under that type.
 * The library writes the short form of the format from this text.
 */
export interface IcsTime {
	readonly kind: 'date' | 'date-time';
	/**
	 * The text of the value. A day reads as `2026-03-14`. A day with a
	 * time of day reads as `2026-03-14T09:00:00`. A time in universal time
	 * ends with the letter Z.
	 */
	readonly text: string;
	/** The name that the parameter TZID states, or null where it states none. */
	readonly tzid: string | null;
}

/** The times of one schedule, in the form of the calendar format. */
export interface ScheduleEmission {
	readonly dtstart: IcsTime;
	/** The end of the event. The end is the first instant after the event. */
	readonly dtend: IcsTime | null;
	/** The length of the event, where the note states a length. */
	readonly duration: string | null;
	/**
	 * The zones that the times name. The calendar that carries these times
	 * carries the definition of each of these zones.
	 */
	readonly timezoneNames: readonly string[];
}

export type EmissionResult =
	| { readonly ok: true; readonly value: ScheduleEmission }
	| { readonly ok: false; readonly problems: readonly FrontmatterProblem[] };

/** The times that this schedule gives to the calendar format. */
export function emitSchedule(
	schedule: NoteSchedule,
	context: ZoneContext,
): EmissionResult {
	if (schedule.kind === 'all-day') {
		return {
			ok: true,
			value: {
				dtstart: dayValue(schedule.date),
				dtend: dayValue(nextDay(schedule.endDate ?? schedule.date)),
				duration: null,
				timezoneNames: [],
			},
		};
	}
	const problems: FrontmatterProblem[] = [];
	// The zone of the note and the zone of the calendar do not change from
	// one time to the next, so a name that the table does not hold is one
	// fault of the note. This flag keeps that fault to one report.
	let named = false;
	const read = (value: DateTimeValue, key: SchemaKey): IcsTime | null => {
		const resolution = resolveZone(value.offsetSeconds, context);
		if (resolution.ok) {
			return timeValue(value, resolution.zone);
		}
		if (resolution.failure.kind === 'no-source') {
			problems.push({ kind: 'timezone-missing', keys: [key], key });
			return null;
		}
		if (!named) {
			named = true;
			problems.push(
				nameProblem(resolution.failure.source, resolution.failure.name),
			);
		}
		return null;
	};
	const dtstart = read(schedule.start, 'start');
	const dtend = schedule.end === null ? null : read(schedule.end, 'end');
	if (dtstart === null || problems.length > 0) {
		return { ok: false, problems };
	}
	return {
		ok: true,
		value: {
			dtstart,
			dtend,
			duration:
				schedule.duration === null
					? null
					: icsDuration(schedule.duration),
			timezoneNames: zoneNames([dtstart, dtend]),
		},
	};
}

/**
 * The day after the given day. The function steps over the end of a month
 * and over the end of a year.
 */
export function nextDay(date: CivilDate): CivilDate {
	if (date.day < daysInMonth(date.year, date.month)) {
		return { year: date.year, month: date.month, day: date.day + 1 };
	}
	if (date.month < 12) {
		return { year: date.year, month: date.month + 1, day: 1 };
	}
	return { year: date.year + 1, month: 1, day: 1 };
}

function dayValue(date: CivilDate): IcsTime {
	return { kind: 'date', text: dateText(date), tzid: null };
}

/**
 * One time under the zone that the resolution order gave it. A time under
 * a name keeps the wall time that the note states. A time under an offset
 * moves to universal time, because the format states an offset in no other
 * way.
 */
function timeValue(value: DateTimeValue, zone: ResolvedZone): IcsTime {
	if (zone.kind === 'named') {
		return {
			kind: 'date-time',
			text: `${dateText(value.date)}T${timeText(value.time)}`,
			tzid: zone.name,
		};
	}
	const seconds =
		civilSeconds(value.date.year, value.date.month, value.date.day) +
		value.time.hour * 3600 +
		value.time.minute * 60 +
		value.time.second -
		zone.offsetSeconds;
	const universal = civilDateTime(seconds);
	return {
		kind: 'date-time',
		text: `${dateText(universal)}T${timeText(universal)}Z`,
		tzid: null,
	};
}

function nameProblem(
	source: 'note' | 'calendar',
	name: string,
): FrontmatterProblem {
	return source === 'note'
		? {
				kind: 'unknown-timezone',
				keys: ['timezone'],
				key: 'timezone',
				name,
			}
		: { kind: 'unknown-calendar-timezone', keys: ['calendar'], name };
}

function zoneNames(times: readonly (IcsTime | null)[]): readonly string[] {
	const names: string[] = [];
	for (const time of times) {
		const tzid = time?.tzid ?? null;
		if (tzid !== null && !names.includes(tzid)) {
			names.push(tzid);
		}
	}
	return names;
}

function dateText(date: CivilDate): string {
	return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

function timeText(time: CivilTime): string {
	return `${pad(time.hour, 2)}:${pad(time.minute, 2)}:${pad(time.second, 2)}`;
}

function pad(value: number, width: number): string {
	return String(value).padStart(width, '0');
}
