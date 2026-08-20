/**
 * The order that decides the timezone of a time, and what that decision
 * writes into the calendar format.
 *
 * The matrix below states every combination of the three sources. The
 * device of the test run stands in a fourth zone, which is not one of the
 * three. A result that carried the zone of the device would therefore
 * differ from the result that the matrix states.
 *
 * The last group runs the same emission under two device zones and
 * compares the two results. The engine reads no clock and no zone of the
 * device, and that comparison is the measurement of it.
 */

import { describe, expect, it } from 'vitest';
import type { JCalComponent } from '../../../src/core/ics/jcal';
import { serializeCalendar } from '../../../src/core/ics/serializer';
import { synthesiseTimezone } from '../../../src/core/timezone/synthesiser';
import type { ScheduleEmission } from '../../../src/core/frontmatter/emission';
import { emitSchedule } from '../../../src/core/frontmatter/emission';
import { readNote } from '../../../src/core/frontmatter/parse';
import type { NoteSchedule } from '../../../src/core/frontmatter/schedule';
import { validateNote } from '../../../src/core/frontmatter/validate';
import type { ZoneContext } from '../../../src/core/frontmatter/zone';
import { resolveZone } from '../../../src/core/frontmatter/zone';

/** The two zones that no input of these tests names. */
const DEVICE_ZONES = ['America/Denver', 'Australia/Sydney'];

const NOTE_ZONE = 'Asia/Tokyo';
const CALENDAR_ZONE = 'Europe/London';

function context(
	noteTimezone: string | undefined,
	calendarTimezone: string | undefined,
): ZoneContext {
	return { noteTimezone, calendarTimezone };
}

/** The schedule of one note. The helper refuses a note that states none. */
function scheduleOf(raw: Readonly<Record<string, unknown>>): NoteSchedule {
	const schedule = readNote(raw).schedule;
	if (schedule === null) {
		throw new Error('the note states no schedule');
	}
	return schedule;
}

/** The times of one timed note under the given sources. */
function emit(
	start: string,
	zones: ZoneContext,
	end?: string,
): ScheduleEmission {
	const raw = end === undefined ? { start } : { start, end };
	const reading = readNote(raw);
	expect(reading.problems).toEqual([]);
	const schedule = reading.schedule;
	if (schedule === null) {
		throw new Error(`the note ${start} states no schedule`);
	}
	const result = emitSchedule(schedule, zones);
	if (!result.ok) {
		throw new Error(
			`the note ${start} emits no times: ${result.problems.map((problem) => problem.kind).join(', ')}`,
		);
	}
	return result.value;
}

/** Runs the function with the given zone as the zone of the device. */
function underDeviceZone<T>(zone: string, run: () => T): T {
	const held = process.env.TZ;
	process.env.TZ = zone;
	try {
		return run();
	} finally {
		if (held === undefined) {
			delete process.env.TZ;
		} else {
			process.env.TZ = held;
		}
	}
}

describe('FM-4 the resolution order', () => {
	it.each([
		['+09:00', NOTE_ZONE, CALENDAR_ZONE],
		['+09:00', NOTE_ZONE, undefined],
		['+09:00', undefined, CALENDAR_ZONE],
		['+09:00', undefined, undefined],
	])(
		'FM-4: the offset %s of the value beats the note and the calendar',
		(_offset, noteTimezone, calendarTimezone) => {
			const resolution = resolveZone(
				32400,
				context(noteTimezone, calendarTimezone),
			);
			expect(resolution).toEqual({
				ok: true,
				zone: { kind: 'offset', source: 'value', offsetSeconds: 32400 },
			});
		},
	);

	it('FM-4: universal time in the value beats the note and the calendar', () => {
		expect(resolveZone(0, context(NOTE_ZONE, CALENDAR_ZONE))).toEqual({
			ok: true,
			zone: { kind: 'offset', source: 'value', offsetSeconds: 0 },
		});
	});

	it('FM-4: the timezone key of the note beats the default of the calendar', () => {
		expect(resolveZone(null, context(NOTE_ZONE, CALENDAR_ZONE))).toEqual({
			ok: true,
			zone: { kind: 'named', source: 'note', name: NOTE_ZONE },
		});
	});

	it('FM-4: the default of the calendar answers where the note names none', () => {
		expect(resolveZone(null, context(undefined, CALENDAR_ZONE))).toEqual({
			ok: true,
			zone: { kind: 'named', source: 'calendar', name: CALENDAR_ZONE },
		});
	});

	it('FM-4: no source gives a failure, and never the zone of the device', () => {
		expect(resolveZone(null, context(undefined, undefined))).toEqual({
			ok: false,
			failure: { kind: 'no-source' },
		});
	});

	it('FM-4: a name that the table does not hold fails and falls through to nothing', () => {
		expect(
			resolveZone(null, context('Mars/Olympus', CALENDAR_ZONE)),
		).toEqual({
			ok: false,
			failure: {
				kind: 'unknown-name',
				source: 'note',
				name: 'Mars/Olympus',
			},
		});
	});

	it('FM-4: a default of the calendar that the table does not hold fails', () => {
		expect(resolveZone(null, context(undefined, 'Mars/Olympus'))).toEqual({
			ok: false,
			failure: {
				kind: 'unknown-name',
				source: 'calendar',
				name: 'Mars/Olympus',
			},
		});
	});
});

describe('FM-4 the emitted zone', () => {
	it('FM-4: a time with no offset carries the name of the zone of the note', () => {
		const emission = emit(
			'2026-03-14T09:00',
			context(NOTE_ZONE, CALENDAR_ZONE),
			'2026-03-14T10:30',
		);
		expect(emission.dtstart).toEqual({
			kind: 'date-time',
			text: '2026-03-14T09:00:00',
			tzid: NOTE_ZONE,
		});
		expect(emission.dtend?.tzid).toBe(NOTE_ZONE);
		expect(emission.timezoneNames).toEqual([NOTE_ZONE]);
	});

	it('FM-4: a time with no offset carries the default of the calendar where the note names none', () => {
		const emission = emit(
			'2026-03-14T09:00',
			context(undefined, CALENDAR_ZONE),
		);
		expect(emission.dtstart.tzid).toBe(CALENDAR_ZONE);
		expect(emission.timezoneNames).toEqual([CALENDAR_ZONE]);
	});

	it.each([
		['2026-03-14T09:00:00Z', '2026-03-14T09:00:00Z'],
		['2026-03-14T09:00:00+09:00', '2026-03-14T00:00:00Z'],
		['2026-03-14T09:00:00+10:00', '2026-03-13T23:00:00Z'],
		['2026-03-14T20:00:00-05:00', '2026-03-15T01:00:00Z'],
		['2026-12-31T23:30:00+01:00', '2026-12-31T22:30:00Z'],
		['2027-01-01T00:30:00+01:00', '2026-12-31T23:30:00Z'],
	])('FM-4: the value %s reaches the format as %s', (start, expected) => {
		const emission = emit(start, context(NOTE_ZONE, CALENDAR_ZONE));
		expect(emission.dtstart).toEqual({
			kind: 'date-time',
			text: expected,
			tzid: null,
		});
		expect(emission.timezoneNames).toEqual([]);
	});

	it('FM-4: a time that no zone reaches states the failure and names the field', () => {
		const schedule = scheduleOf({
			start: '2026-03-14T09:00',
			end: '2026-03-14T10:00',
		});
		const result = emitSchedule(schedule, context(undefined, undefined));
		expect(result).toEqual({
			ok: false,
			problems: [
				{ kind: 'timezone-missing', keys: ['start'], key: 'start' },
				{ kind: 'timezone-missing', keys: ['end'], key: 'end' },
			],
		});
	});

	it('FM-4: a name that the table does not hold reaches the user one time', () => {
		const schedule = scheduleOf({
			start: '2026-03-14T09:00',
			end: '2026-03-14T10:00',
			timezone: 'Mars/Olympus',
		});
		const result = emitSchedule(
			schedule,
			context('Mars/Olympus', undefined),
		);
		expect(result).toEqual({
			ok: false,
			problems: [
				{
					kind: 'unknown-timezone',
					keys: ['timezone'],
					key: 'timezone',
					name: 'Mars/Olympus',
				},
			],
		});
	});

	it('FM-4: a default of the calendar that the table does not hold reaches the user', () => {
		const result = emitSchedule(
			scheduleOf({ start: '2026-03-14T09:00' }),
			context(undefined, 'Mars/Olympus'),
		);
		expect(result).toEqual({
			ok: false,
			problems: [
				{
					kind: 'unknown-calendar-timezone',
					keys: ['calendar'],
					name: 'Mars/Olympus',
				},
			],
		});
	});

	it('FM-4: a start in universal time with an end that no zone reaches emits nothing', () => {
		const schedule = scheduleOf({
			start: '2026-03-14T09:00:00Z',
			end: '2026-03-14T10:00',
		});
		const result = emitSchedule(schedule, context(undefined, undefined));
		expect(result).toEqual({
			ok: false,
			problems: [{ kind: 'timezone-missing', keys: ['end'], key: 'end' }],
		});
	});
});

describe('FM-4 the emitted calendar', () => {
	it('FM-4: the event states TZID, and the calendar carries the definition of that zone', () => {
		const emission = emit(
			'2026-03-14T09:00',
			context(NOTE_ZONE, CALENDAR_ZONE),
			'2026-03-14T10:30',
		);
		const text = serializeCalendar(calendarOf(emission));
		expect(text).toContain(`DTSTART;TZID=${NOTE_ZONE}:20260314T090000\r\n`);
		expect(text).toContain(`DTEND;TZID=${NOTE_ZONE}:20260314T103000\r\n`);
		expect(text).toContain('BEGIN:VTIMEZONE\r\n');
		expect(text).toContain(`TZID:${NOTE_ZONE}\r\n`);
		expect(text).not.toContain('Europe/London');
	});

	it('FM-4: a time in universal time states no TZID and needs no definition', () => {
		const emission = emit(
			'2026-03-14T09:00:00+09:00',
			context(NOTE_ZONE, CALENDAR_ZONE),
		);
		const text = serializeCalendar(calendarOf(emission));
		expect(text).toContain('DTSTART:20260314T000000Z\r\n');
		expect(text).not.toContain('TZID');
		expect(text).not.toContain('BEGIN:VTIMEZONE');
	});
});

describe('FM-4 the check of a note against its calendar', () => {
	it('FM-4: a note that no zone reaches states the fault at each time', () => {
		const reading = validateNote(
			{ start: '2026-03-14T09:00', end: '2026-03-14T10:00' },
			{ calendarTimezone: undefined },
		);
		expect(reading.problems).toEqual([
			{ kind: 'timezone-missing', keys: ['start'], key: 'start' },
			{ kind: 'timezone-missing', keys: ['end'], key: 'end' },
		]);
	});

	it('FM-4: the default of the calendar answers, and the note states no fault', () => {
		const reading = validateNote(
			{ start: '2026-03-14T09:00' },
			{ calendarTimezone: CALENDAR_ZONE },
		);
		expect(reading.problems).toEqual([]);
	});

	it('FM-4: a time in universal time needs no zone from the note', () => {
		const reading = validateNote(
			{ start: '2026-03-14T09:00:00Z' },
			{ calendarTimezone: undefined },
		);
		expect(reading.problems).toEqual([]);
	});

	it('FM-4: an all-day note needs no zone', () => {
		const reading = validateNote(
			{ date: '2026-03-14', endDate: '2026-03-16' },
			{ calendarTimezone: undefined },
		);
		expect(reading.problems).toEqual([]);
	});

	it('FM-4: a name that the table does not hold is a fault of the note itself', () => {
		const reading = validateNote(
			{ timezone: 'Mars/Olympus' },
			{ calendarTimezone: CALENDAR_ZONE },
		);
		expect(reading.problems).toEqual([
			{
				kind: 'unknown-timezone',
				keys: ['timezone'],
				key: 'timezone',
				name: 'Mars/Olympus',
			},
		]);
	});

	it('FM-4: the note that names a zone it cannot use states that fault one time', () => {
		const reading = validateNote(
			{
				start: '2026-03-14T09:00',
				end: '2026-03-14T10:00',
				timezone: 'Mars/Olympus',
			},
			{ calendarTimezone: CALENDAR_ZONE },
		);
		expect(reading.problems).toEqual([
			{
				kind: 'unknown-timezone',
				keys: ['timezone'],
				key: 'timezone',
				name: 'Mars/Olympus',
			},
		]);
	});

	it('FM-4: a default of the calendar that the table does not hold states one fault', () => {
		const reading = validateNote(
			{ start: '2026-03-14T09:00', end: '2026-03-14T10:00' },
			{ calendarTimezone: 'Mars/Olympus' },
		);
		expect(reading.problems).toEqual([
			{
				kind: 'unknown-calendar-timezone',
				keys: ['calendar'],
				name: 'Mars/Olympus',
			},
		]);
	});

	it('FM-4: the check keeps the faults that the reader found', () => {
		const reading = validateNote(
			{ start: '2026-03-14T09:00', status: 'open' },
			{ calendarTimezone: undefined },
		);
		expect(reading.problems.map((problem) => problem.kind)).toEqual([
			'unknown-value',
			'timezone-missing',
		]);
	});
});

describe('FM-4 the zone of the device', () => {
	it.each(DEVICE_ZONES)(
		'FM-4: the emitted zone is the resolved zone under the device zone %s',
		(zone) => {
			const emission = underDeviceZone(zone, () =>
				emit('2026-03-14T09:00', context(NOTE_ZONE, CALENDAR_ZONE)),
			);
			expect(emission.dtstart.tzid).toBe(NOTE_ZONE);
			expect(emission.dtstart.text).toBe('2026-03-14T09:00:00');
		},
	);

	it('FM-4: two device zones give one answer, for a name and for an offset', () => {
		const zones = context(NOTE_ZONE, CALENDAR_ZONE);
		const [first, second] = DEVICE_ZONES.map((zone) =>
			underDeviceZone(zone, () => [
				emit('2026-03-14T09:00', zones),
				emit('2026-03-14T09:00:00+09:00', zones),
				emit('2026-07-01T12:00', context(undefined, CALENDAR_ZONE)),
			]),
		);
		expect(first).toEqual(second);
	});
});

/** A calendar that holds the event and the definition of each zone it names. */
function calendarOf(emission: ScheduleEmission): JCalComponent {
	const properties: JCalComponent[1] = [
		['uid', {}, 'text', 'fm-4'],
		[
			'dtstart',
			emission.dtstart.tzid === null
				? {}
				: { tzid: emission.dtstart.tzid },
			emission.dtstart.kind,
			emission.dtstart.text,
		],
	];
	const dtend = emission.dtend;
	const event: JCalComponent = [
		'vevent',
		dtend === null
			? properties
			: [
					...properties,
					[
						'dtend',
						dtend.tzid === null ? {} : { tzid: dtend.tzid },
						dtend.kind,
						dtend.text,
					],
				],
		[],
	];
	return [
		'vcalendar',
		[
			['version', {}, 'text', '2.0'],
			['prodid', {}, 'text', '-//Davenport//test//EN'],
		],
		[...emission.timezoneNames.map(definitionOf), event],
	];
}

function definitionOf(name: string): JCalComponent {
	const result = synthesiseTimezone(name);
	if (!result.ok) {
		throw new Error(`the table holds no zone under the name ${name}`);
	}
	return result.component;
}
