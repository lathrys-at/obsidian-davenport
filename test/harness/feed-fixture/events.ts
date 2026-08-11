/**
 * The event specifications a feed body is built from, and the edits a script
 * applies between polls.
 *
 * A spec's `id` is the fixture's own handle and never reaches the wire; `uid`
 * is what the feed emits. Leaving `uid` out serves an event with no UID line,
 * and two specs sharing one `uid` serve an in-feed duplicate — the two shapes
 * of generator misbehavior a feed consumer has to survive.
 */

import { icsDateStamp, icsUtcStamp } from './ics-text';

/** A point in time, served either as a UTC stamp or as an all-day date. */
export type FeedInstant =
	| { readonly kind: 'date-time'; readonly epochMs: number }
	| { readonly kind: 'all-day'; readonly epochMs: number };

export function timedAt(epochMs: number): FeedInstant {
	return { kind: 'date-time', epochMs };
}

export function allDayOn(epochMs: number): FeedInstant {
	return { kind: 'all-day', epochMs };
}

/** The content line placing the instant on the named property. */
export function instantLine(property: string, instant: FeedInstant): string {
	return instant.kind === 'all-day'
		? `${property};VALUE=DATE:${icsDateStamp(instant.epochMs)}`
		: `${property}:${icsUtcStamp(instant.epochMs)}`;
}

export interface FeedEventSpec {
	/** The fixture's handle for this event; never emitted. */
	readonly id: string;
	/** The UID the feed emits; absent serves an event with no UID line. */
	readonly uid?: string;
	readonly summary: string;
	readonly start: FeedInstant;
	readonly end?: FeedInstant;
	readonly sequence?: number;
	readonly location?: string;
	readonly description?: string;
	/** Content lines emitted verbatim inside the component, unescaped. */
	readonly extraLines?: readonly string[];
}

export interface DecadeCorpusOptions {
	/** Epoch milliseconds the corpus is generated around. */
	readonly referenceTime: number;
	readonly yearsBefore?: number;
	readonly yearsAfter?: number;
	readonly perYear?: number;
	readonly idPrefix?: string;
	/** All-day events by default, the shape a holiday feed serves. */
	readonly allDay?: boolean;
}

const HOUR_MS = 3_600_000;

/**
 * A corpus spanning years either side of the reference time, spread evenly
 * through each year. The generator takes its reference time as input, so the
 * same options always produce the same events.
 */
export function decadeSpanningCorpus(
	options: DecadeCorpusOptions,
): FeedEventSpec[] {
	const {
		referenceTime,
		yearsBefore = 5,
		yearsAfter = 5,
		perYear = 4,
		idPrefix = 'decade',
		allDay = true,
	} = options;
	if (perYear < 1) {
		throw new Error(
			'a decade-spanning corpus needs at least one event a year',
		);
	}
	if (yearsBefore < 0 || yearsAfter < 0) {
		throw new Error('a decade-spanning corpus cannot span negative years');
	}
	const referenceYear = new Date(referenceTime).getUTCFullYear();
	const events: FeedEventSpec[] = [];
	for (
		let year = referenceYear - yearsBefore;
		year <= referenceYear + yearsAfter;
		year++
	) {
		for (let index = 0; index < perYear; index++) {
			const month = Math.floor((12 * index) / perYear) % 12;
			const epochMs = Date.UTC(year, month, 15, 9, 0, 0);
			const id = `${idPrefix}-${String(year)}-${String(index)}`;
			events.push({
				id,
				uid: `${id}@feed.test`,
				summary: `${idPrefix} ${String(year)} number ${String(index)}`,
				start: allDay ? allDayOn(epochMs) : timedAt(epochMs),
				...(allDay ? {} : { end: timedAt(epochMs + HOUR_MS) }),
			});
		}
	}
	return events;
}

export type FeedEventChanges = Partial<
	Pick<
		FeedEventSpec,
		| 'uid'
		| 'summary'
		| 'sequence'
		| 'location'
		| 'description'
		| 'extraLines'
	>
>;

/** An edit applied to a feed's contents between one poll and the next. */
export type FeedDelta =
	| { readonly kind: 'add'; readonly event: FeedEventSpec }
	| { readonly kind: 'remove'; readonly id: string }
	| {
			readonly kind: 'modify';
			readonly id: string;
			readonly changes: FeedEventChanges;
	  }
	| {
			readonly kind: 'reschedule';
			readonly id: string;
			readonly start: FeedInstant;
			readonly end?: FeedInstant;
	  };

function shifted(instant: FeedInstant, shiftMs: number): FeedInstant {
	return instant.kind === 'all-day'
		? allDayOn(instant.epochMs + shiftMs)
		: timedAt(instant.epochMs + shiftMs);
}

/**
 * Moves an event, preserving its duration unless a new end is given. An event
 * with no end keeps having none.
 */
function rescheduled(
	event: FeedEventSpec,
	start: FeedInstant,
	end: FeedInstant | undefined,
): FeedEventSpec {
	if (end !== undefined) return { ...event, start, end };
	if (event.end === undefined) return { ...event, start };
	const shift = start.epochMs - event.start.epochMs;
	return { ...event, start, end: shifted(event.end, shift) };
}

/**
 * The events a feed serves after the deltas apply, in insertion order.
 * Targeting an event the feed does not carry throws rather than passing
 * silently, because a script that misses its target is a harness defect.
 */
export function applyFeedDeltas(
	events: readonly FeedEventSpec[],
	deltas: readonly FeedDelta[],
): FeedEventSpec[] {
	const byId = new Map(events.map((event) => [event.id, event]));
	for (const delta of deltas) {
		if (delta.kind === 'add') {
			if (byId.has(delta.event.id)) {
				throw new Error(
					`the feed already carries event ${delta.event.id}`,
				);
			}
			byId.set(delta.event.id, delta.event);
			continue;
		}
		const target = byId.get(delta.id);
		if (target === undefined) {
			throw new Error(`the feed carries no event ${delta.id}`);
		}
		switch (delta.kind) {
			case 'remove':
				byId.delete(delta.id);
				break;
			case 'modify':
				byId.set(delta.id, { ...target, ...delta.changes });
				break;
			case 'reschedule':
				byId.set(delta.id, rescheduled(target, delta.start, delta.end));
				break;
		}
	}
	return [...byId.values()];
}
