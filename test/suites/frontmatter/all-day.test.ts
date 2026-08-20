/**
 * The all-day shape, and the end of one day that the two formats state in
 * two different ways.
 *
 * A note states the last day of the event, and that day is part of the
 * event. The calendar format states the first day after the event. Every
 * test here reads the note form and states the format form, and the
 * difference of one day is the subject.
 *
 * The battery over the months exists because the day after the last day of
 * a month is not the day of the month plus one. February in a leap year,
 * February in a common year, and the end of a year are the days that a
 * simple addition gets wrong.
 */

import { describe, expect, it } from 'vitest';
import type { JCalComponent } from '../../../src/core/ics/jcal';
import { serializeCalendar } from '../../../src/core/ics/serializer';
import type { ScheduleEmission } from '../../../src/core/frontmatter/emission';
import { emitSchedule } from '../../../src/core/frontmatter/emission';
import { readNote } from '../../../src/core/frontmatter/parse';

const NO_ZONE = {
	noteTimezone: undefined,
	calendarTimezone: undefined,
} as const;

/** The times that one all-day note gives to the calendar format. */
function emit(date: string, endDate?: string): ScheduleEmission {
	const raw = endDate === undefined ? { date } : { date, endDate };
	const reading = readNote(raw);
	expect(reading.problems).toEqual([]);
	const schedule = reading.schedule;
	if (schedule === null) {
		throw new Error(`the note ${date} states no schedule`);
	}
	const result = emitSchedule(schedule, NO_ZONE);
	if (!result.ok) {
		throw new Error(`the note ${date} emits no times`);
	}
	return result.value;
}

/** The text of one all-day event, as the canonical serializer writes it. */
function icsText(emission: ScheduleEmission): string {
	const event: JCalComponent = [
		'vevent',
		[
			['uid', {}, 'text', 'fm-3'],
			['dtstart', {}, emission.dtstart.kind, emission.dtstart.text],
			[
				'dtend',
				{},
				emission.dtend?.kind ?? 'date',
				emission.dtend?.text ?? '',
			],
		],
		[],
	];
	const calendar: JCalComponent = [
		'vcalendar',
		[
			['version', {}, 'text', '2.0'],
			['prodid', {}, 'text', '-//Davenport//test//EN'],
		],
		[event],
	];
	return serializeCalendar(calendar);
}

describe('FM-3 the inclusive last day becomes the exclusive end', () => {
	it('FM-3: one day reaches the format as the day and the day after it', () => {
		const emission = emit('2026-03-14');
		expect(emission.dtstart).toEqual({
			kind: 'date',
			text: '2026-03-14',
			tzid: null,
		});
		expect(emission.dtend).toEqual({
			kind: 'date',
			text: '2026-03-15',
			tzid: null,
		});
	});

	it('FM-3: a note of several days states the day after its last day', () => {
		expect(emit('2026-03-14', '2026-03-16').dtend?.text).toBe('2026-03-17');
	});

	it('FM-3: a last day that equals the first day states one whole day', () => {
		expect(emit('2026-03-14', '2026-03-14').dtend?.text).toBe('2026-03-15');
	});

	it('FM-3: an all-day event always states an end', () => {
		expect(emit('2026-03-14').dtend).not.toBeNull();
		expect(emit('2026-03-14', '2026-03-16').dtend).not.toBeNull();
	});

	it('FM-3: an all-day event names no timezone', () => {
		const emission = emit('2026-03-14', '2026-03-16');
		expect(emission.dtstart.tzid).toBeNull();
		expect(emission.dtend?.tzid).toBeNull();
		expect(emission.timezoneNames).toEqual([]);
		expect(emission.duration).toBeNull();
	});

	it('FM-3: the serialized event states the days and the type of the value', () => {
		const text = icsText(emit('2026-03-14', '2026-03-16'));
		expect(text).toContain('DTSTART;VALUE=DATE:20260314\r\n');
		expect(text).toContain('DTEND;VALUE=DATE:20260317\r\n');
	});
});

describe('FM-3 the end of a month and the end of a year', () => {
	it.each([
		['2026-01-31', '2026-02-01'],
		['2026-02-28', '2026-03-01'],
		['2026-03-31', '2026-04-01'],
		['2026-04-30', '2026-05-01'],
		['2026-05-31', '2026-06-01'],
		['2026-06-30', '2026-07-01'],
		['2026-07-31', '2026-08-01'],
		['2026-08-31', '2026-09-01'],
		['2026-09-30', '2026-10-01'],
		['2026-10-31', '2026-11-01'],
		['2026-11-30', '2026-12-01'],
		['2026-12-31', '2027-01-01'],
	])('FM-3: the last day %s ends on %s', (date, expected) => {
		expect(emit(date).dtend?.text).toBe(expected);
	});

	it.each([
		['2028-02-28', '2028-02-29'],
		['2028-02-29', '2028-03-01'],
		['2000-02-29', '2000-03-01'],
		['2100-02-28', '2100-03-01'],
		['1900-02-28', '1900-03-01'],
	])('FM-3: the last day %s of February ends on %s', (date, expected) => {
		expect(emit(date).dtend?.text).toBe(expected);
	});

	it.each([
		['2026-01-30', '2026-01-31', '2026-02-01'],
		['2026-02-01', '2026-02-28', '2026-03-01'],
		['2026-12-30', '2026-12-31', '2027-01-01'],
		['2028-02-01', '2028-02-29', '2028-03-01'],
	])(
		'FM-3: the event from %s through %s ends on %s',
		(date, endDate, expected) => {
			expect(emit(date, endDate).dtend?.text).toBe(expected);
		},
	);
});
