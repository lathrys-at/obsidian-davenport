/**
 * Event field model: the validated form of the frontmatter vocabulary.
 * Raw-frontmatter parsing and validation produce these types. Machine sync
 * state — etags, hrefs, hashes, base snapshots — never appears in
 * frontmatter; it lives in records.
 */

/** ISO 8601 date-time text; offset optional. */
export type IsoDateTime = string;

/** ISO 8601 calendar date (`YYYY-MM-DD`). */
export type IsoDate = string;

/** Duration shorthand, e.g. `30m`, `1h30m`. */
export type DurationText = string;

/** IANA timezone name, e.g. `Europe/London`. */
export type TimezoneName = string;

/**
 * Lifecycle intent: `draft` is local planning, `ready` signals push.
 * Liveness is deliberately not a frontmatter value — a note is live when a
 * live record resolves for its identity.
 */
export type EventState = 'draft' | 'ready';

/**
 * iCalendar event STATUS. Kept disjoint from {@link EventState} in key,
 * vocabulary, and code identifiers: scheduling status is display data,
 * lifecycle intent drives server writes, and the two must never blur.
 */
export type EventStatus = 'tentative' | 'confirmed' | 'cancelled';

/** RSVP intent; writing it is a confirm-gated server action. */
export type RsvpResponse = 'accepted' | 'declined' | 'tentative';

/** iCalendar CLASS. */
export type EventClass = 'public' | 'private' | 'confidential';

/** iCalendar TRANSP; blocks default to `opaque`. */
export type Transparency = 'opaque' | 'transparent';

/**
 * `event` is a fixed-time commitment (VEVENT); `task` maps to VTODO;
 * `block` is a VEVENT claiming time for the task it links via `task`.
 */
export type ItemType = 'event' | 'task' | 'block';

/**
 * Timed and all-day shapes are mutually exclusive: a note carrying both
 * `date` and `start` fails validation naming both keys, and plugin writes
 * are shape-exclusive — switching shape removes the departing shape's keys
 * in the same write.
 */
export type Schedule = TimedSchedule | AllDaySchedule;

export interface TimedSchedule {
	readonly kind: 'timed';
	readonly start: IsoDateTime;
	/**
	 * At most one of `end` or `duration`; both present fails validation
	 * naming both keys. Pushing requires one of them, but a start-only
	 * draft is legitimate.
	 */
	readonly end?: IsoDateTime;
	readonly duration?: DurationText;
}

/**
 * All-day shape. `endDate` is inclusive; the serializer converts to
 * iCalendar's exclusive `DTEND` — users think inclusively, and the
 * exclusive end is the standard off-by-one-day bug.
 */
export interface AllDaySchedule {
	readonly kind: 'all-day';
	readonly date: IsoDate;
	readonly endDate?: IsoDate;
}

/**
 * Declared event fields, post-validation. Sync touches only declared
 * fields; anything not modeled here survives round trips untouched via the
 * record's base ICS.
 */
export interface EventFields {
	readonly summary?: string;
	/**
	 * Friendly calendar name, resolved through the registry. Never copied
	 * into records — records exclude it structurally.
	 */
	readonly calendar?: string;
	readonly schedule?: Schedule;
	readonly timezone?: TimezoneName;
	/** RFC 5545 RRULE text; one note or record represents the series. */
	readonly rrule?: string;
	readonly type: ItemType;
	/** Block-only: wikilink to the task note this block serves. */
	readonly task?: string;
	readonly due?: IsoDateTime;
	readonly completed?: IsoDateTime;
	readonly priority?: number;
	readonly rsvp?: RsvpResponse;
	/** Pushed as DESCRIPTION; one-way, render-on-push. */
	readonly description?: string;
	/** Vault wikilinks or external URLs, pushed as ATTACH. */
	readonly attachments?: readonly string[];
	/** Reminder offset, e.g. `-15m`, serialized as VALARM. */
	readonly alarm?: string;
	readonly location?: string;
	/** Mapped to CATEGORIES; the Obsidian-tags mapping is prefix-scoped. */
	readonly categories?: readonly string[];
	readonly class?: EventClass;
	readonly transp?: Transparency;
	readonly status?: EventStatus;
}
