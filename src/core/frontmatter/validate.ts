/**
 * The check of a note against the schema, on the read side.
 *
 * The reader of the frontmatter finds every fault that one key holds, and
 * every fault that two keys hold together. This module adds the faults
 * that need the calendar of the note: a timezone name that the bundled
 * table does not hold, and a time that no zone reaches.
 *
 * The check finds those faults through the emission of the times, and not
 * through a second reading of the resolution order. One rule then stands
 * in one place: a note that this check passes is a note whose times reach
 * the calendar format, and a fault that the emission states is a fault
 * that the user sees before a push.
 *
 * One fault stands outside the emission. A note can name a timezone that
 * the table does not hold and state every time with an offset. The
 * emission needs no zone for such a note, and the name is still wrong, so
 * this module reads that name itself.
 *
 * The result is the list of the faults of the note. The list is empty for
 * a note that the plugin can read. A caller that pushes a note reads this
 * list first, and a caller that shows the note to the user states each
 * fault beside the field that holds it.
 *
 * This check reads no clock and it reaches no server. It reads the note
 * and the default timezone of the calendar, and nothing else.
 */

import type { TimezoneName } from '../model/event';
import { isKnownTimezoneName } from '../timezone/names';
import { emitSchedule } from './emission';
import type { NoteReading } from './parse';
import { readNote } from './parse';
import type { FrontmatterProblem } from './problems';

/** What the check needs from outside the note. */
export interface ValidationContext {
	/**
	 * The default timezone of the calendar that the note names. The value
	 * is undefined where the note names no calendar, where the registry
	 * holds no such calendar, and where that calendar states no default.
	 */
	readonly calendarTimezone: TimezoneName | undefined;
}

/**
 * Reads one note and checks it. The reading holds the faults of the note,
 * which include the faults that the calendar of the note decides.
 */
export function validateNote(
	raw: Readonly<Record<string, unknown>>,
	context: ValidationContext,
): NoteReading {
	const reading = readNote(raw);
	const problems = [...reading.problems, ...zoneProblems(reading, context)];
	return { ...reading, problems };
}

/**
 * The faults of the zones of one note. The check reports a name that the
 * table does not hold one time, because one name stands for the whole
 * note. The emission reports a time that no zone reaches one time for
 * each such time, because the user corrects each of those times.
 */
function zoneProblems(
	reading: NoteReading,
	context: ValidationContext,
): readonly FrontmatterProblem[] {
	const problems: FrontmatterProblem[] = [];
	const noteTimezone = reading.fields.timezone;
	const named =
		noteTimezone !== undefined && !isKnownTimezoneName(noteTimezone);
	if (named) {
		problems.push({
			kind: 'unknown-timezone',
			keys: ['timezone'],
			key: 'timezone',
			name: noteTimezone,
		});
	}
	const schedule = reading.schedule;
	if (schedule === null) {
		return problems;
	}
	const emission = emitSchedule(schedule, {
		noteTimezone,
		calendarTimezone: context.calendarTimezone,
	});
	if (emission.ok) {
		return problems;
	}
	for (const problem of emission.problems) {
		// The check above already stated the name of the note, and the
		// emission states that one fault again for the first time that
		// needs the zone.
		if (!(named && problem.kind === 'unknown-timezone')) {
			problems.push(problem);
		}
	}
	return problems;
}
