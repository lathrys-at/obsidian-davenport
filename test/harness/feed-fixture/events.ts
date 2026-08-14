/**
 * The event specifications that the fixture builds a feed body from, and the
 * edits that a script applies to those events between two polls. A poll is
 * one fetch of the feed.
 *
 * Each specification carries an `id`. The `id` is the handle that the fixture
 * uses for the event, and the feed never serves this handle. The `uid` is the
 * value that the feed puts in the UID line of the event. A specification with
 * no `uid` serves an event that has no UID line. Two specifications with the
 * same `uid` serve that UID twice in one feed. A feed generator can make
 * these two mistakes. A program that reads a feed must continue to work when
 * the feed makes either mistake.
 */

import { icsDateStamp, icsUtcStamp } from './ics-text';

/**
 * A point in time. The feed serves it as a UTC stamp, or as a date with no
 * time for an all-day event.
 */
export type FeedInstant =
	| { readonly kind: 'date-time'; readonly epochMs: number }
	| { readonly kind: 'all-day'; readonly epochMs: number };

export function timedAt(epochMs: number): FeedInstant {
	return { kind: 'date-time', epochMs };
}

export function allDayOn(epochMs: number): FeedInstant {
	return { kind: 'all-day', epochMs };
}

/** The content line that puts the given instant on the given property. */
export function instantLine(property: string, instant: FeedInstant): string {
	return instant.kind === 'all-day'
		? `${property};VALUE=DATE:${icsDateStamp(instant.epochMs)}`
		: `${property}:${icsUtcStamp(instant.epochMs)}`;
}

export interface FeedEventSpec {
	/**
	 * The handle that the fixture uses for this event. The feed never serves
	 * this handle.
	 */
	readonly id: string;
	/**
	 * The UID that the feed puts in the UID line of this event. If this field
	 * is absent, the feed serves an event that has no UID line.
	 */
	readonly uid?: string;
	readonly summary: string;
	readonly start: FeedInstant;
	readonly end?: FeedInstant;
	readonly sequence?: number;
	readonly location?: string;
	readonly description?: string;
	/**
	 * Content lines that the feed puts inside the event component. The feed
	 * escapes no character in these lines. The feed folds them as it folds
	 * every other content line: it breaks a long line and starts the next
	 * line with one space. If a line arrives here already folded, the feed
	 * folds it a second time. The feed does not serve such a line unchanged.
	 */
	readonly extraLines?: readonly string[];
}

export interface DecadeCorpusOptions {
	/**
	 * The time that the generator builds the corpus around. The value is the
	 * count of milliseconds after the Unix epoch.
	 */
	readonly referenceTime: number;
	readonly yearsBefore?: number;
	readonly yearsAfter?: number;
	readonly perYear?: number;
	readonly idPrefix?: string;
	/**
	 * If true, the corpus holds all-day events. True is the default, because
	 * a holiday feed serves all-day events.
	 */
	readonly allDay?: boolean;
}

const HOUR_MS = 3_600_000;

/**
 * A corpus of events that spans the years before and after the reference
 * time. The generator spreads the events evenly through each year. The caller
 * gives the generator the reference time, and the generator reads no clock.
 * Therefore the same options always give the same events.
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
			'a decade-spanning corpus needs at least one event in each year: set perYear to 1 or more',
		);
	}
	if (yearsBefore < 0 || yearsAfter < 0) {
		throw new Error(
			'a decade-spanning corpus cannot span a negative number of years: set yearsBefore and yearsAfter to 0 or more',
		);
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

/**
 * An edit that a script makes to the contents of a feed between one poll and
 * the next poll.
 */
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
 * The event that this function moves to a new start time. If the caller gives
 * a new end time, the event takes that end time. If the caller gives no end
 * time, the event keeps the duration that it had. An event that has no end
 * time still has no end time.
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
 * The events that a feed serves after these deltas apply. The events keep the
 * order in which they entered the feed. If a delta names an event that the
 * feed does not carry, this function throws an error. The function does not
 * ignore such a delta, because a script that misses its target is a defect in
 * the harness.
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
					`the feed already carries event ${delta.event.id}: add an event with an id that the feed does not carry`,
				);
			}
			byId.set(delta.event.id, delta.event);
			continue;
		}
		const target = byId.get(delta.id);
		if (target === undefined) {
			throw new Error(
				`the feed carries no event ${delta.id}: name an event that the feed carries`,
			);
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
