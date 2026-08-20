/**
 * The order that decides the timezone of one time in a note.
 *
 * Three sources can give the zone, and the order is fixed:
 *
 * 1. an offset in the value itself, which includes the letter Z for
 *    universal time;
 * 2. the key `timezone` of the note;
 * 3. the default timezone of the calendar.
 *
 * The first source that gives an answer decides. Where no source gives an
 * answer, the resolution fails, and the plugin states that failure to the
 * user. This module has no fourth source: it never reads the timezone of
 * the device, and no result of it can hold that zone. A time that the
 * plugin sends to a server therefore always carries the zone that the user
 * stated, or the zone that the calendar states.
 *
 * A name that the bundled timezone table does not hold fails here. The
 * name does not fall through to the source below it, because a fall
 * through would send a time in a zone that the user did not choose.
 */

import type { TimezoneName } from '../model/event';
import { isKnownTimezoneName } from '../timezone/names';

/** The sources of a zone, from the first to the last. */
export type ZoneSource = 'value' | 'note' | 'calendar';

/**
 * The zone of one time. An offset stands for itself, and a name stands for
 * the rules that the bundled table holds under it.
 */
export type ResolvedZone =
	| {
			readonly kind: 'offset';
			readonly source: 'value';
			readonly offsetSeconds: number;
	  }
	| {
			readonly kind: 'named';
			readonly source: 'note' | 'calendar';
			readonly name: TimezoneName;
	  };

/** Why no zone resolves. */
export type ZoneFailure =
	/** The note names a timezone that the bundled table does not hold. */
	| {
			readonly kind: 'unknown-name';
			readonly source: 'note' | 'calendar';
			readonly name: string;
	  }
	/** No source states a zone. */
	| { readonly kind: 'no-source' };

export type ZoneResolution =
	| { readonly ok: true; readonly zone: ResolvedZone }
	| { readonly ok: false; readonly failure: ZoneFailure };

/** The two sources that stand outside the value. */
export interface ZoneContext {
	/** The value of the key `timezone` of the note. */
	readonly noteTimezone: TimezoneName | undefined;
	/** The default timezone of the calendar that the note names. */
	readonly calendarTimezone: TimezoneName | undefined;
}

/**
 * The zone of one time. The caller states the offset that the value of
 * that time holds, or null where the value holds no offset.
 */
export function resolveZone(
	offsetSeconds: number | null,
	context: ZoneContext,
): ZoneResolution {
	if (offsetSeconds !== null) {
		return {
			ok: true,
			zone: { kind: 'offset', source: 'value', offsetSeconds },
		};
	}
	if (context.noteTimezone !== undefined) {
		return named(context.noteTimezone, 'note');
	}
	if (context.calendarTimezone !== undefined) {
		return named(context.calendarTimezone, 'calendar');
	}
	return { ok: false, failure: { kind: 'no-source' } };
}

function named(name: string, source: 'note' | 'calendar'): ZoneResolution {
	return isKnownTimezoneName(name)
		? { ok: true, zone: { kind: 'named', source, name } }
		: { ok: false, failure: { kind: 'unknown-name', source, name } };
}
