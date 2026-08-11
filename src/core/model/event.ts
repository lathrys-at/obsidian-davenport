/**
 * Event field model — the validated form of the frontmatter vocabulary
 * (spec §3.1). Raw-frontmatter parsing and validation produce these types;
 * they never carry machine sync state (§3.1: etags, hrefs, hashes, and
 * base snapshots live in records, not frontmatter).
 */

/** ISO 8601 date-time text; offset optional, resolution per §3.1. */
export type IsoDateTime = string;

/** ISO 8601 calendar date (`YYYY-MM-DD`). */
export type IsoDate = string;

/** Duration shorthand, e.g. `30m`, `1h30m` (§3.1). */
export type DurationText = string;

/** IANA timezone name, e.g. `Europe/London`. */
export type TimezoneName = string;

/**
 * Lifecycle intent (§6.1): `draft` is local planning, `ready` signals push.
 * Liveness is deliberately not a frontmatter value — a note is live when a
 * live record resolves for its identity (§3.1).
 */
export type EventState = 'draft' | 'ready';

/**
 * iCalendar event STATUS (§13). Disjoint from {@link EventState} in key,
 * vocabulary, and identifiers, by rule (§3.1): the two must never share
 * either.
 */
export type EventStatus = 'tentative' | 'confirmed' | 'cancelled';

/** RSVP intent (§12); writing it is a confirm-gated server action. */
export type RsvpResponse = 'accepted' | 'declined' | 'tentative';

/** iCalendar CLASS (§13). */
export type EventClass = 'public' | 'private' | 'confidential';

/** iCalendar TRANSP (§13); blocks default `opaque`. */
export type Transparency = 'opaque' | 'transparent';

/**
 * §10.1: `event` is a fixed-time commitment (VEVENT); `task` maps to VTODO;
 * `block` is a VEVENT claiming time for a task it links via `task:`.
 */
export type ItemType = 'event' | 'task' | 'block';

/**
 * Timed and all-day shapes are mutually exclusive (§3.1): `date` alongside
 * `start` fails validation naming both keys, and plugin writes are
 * shape-exclusive — switching shape removes the departing shape's keys in
 * the same write.
 */
export type Schedule = TimedSchedule | AllDaySchedule;

export interface TimedSchedule {
	readonly kind: 'timed';
	readonly start: IsoDateTime;
	/** Exactly one of `end` or `duration`; both present fails validation
	 * naming both keys (§3.1, §6.2). */
	readonly end?: IsoDateTime;
	readonly duration?: DurationText;
}

/**
 * All-day shape. `endDate` is inclusive; the serializer converts to
 * iCalendar's exclusive `DTEND` (§3.1) — users think inclusively, and the
 * exclusive end is the standard off-by-one-day bug.
 */
export interface AllDaySchedule {
	readonly kind: 'all-day';
	readonly date: IsoDate;
	readonly endDate?: IsoDate;
}

/**
 * Declared event fields (§3.1), post-validation. Sync touches only declared
 * fields (§1 principle 2); anything not modeled here survives round trips
 * untouched via the record's base ICS (§5.5).
 */
export interface EventFields {
	readonly summary?: string;
	/** Friendly calendar name, resolved through the registry (§4.1). */
	readonly calendar?: string;
	readonly schedule?: Schedule;
	readonly timezone?: TimezoneName;
	/** RFC 5545 RRULE text; one note or record represents the series (§11). */
	readonly rrule?: string;
	readonly type: ItemType;
	/** Block-only (§10.1): wikilink to the task note this block serves. */
	readonly task?: string;
	readonly due?: IsoDateTime;
	readonly completed?: IsoDateTime;
	readonly priority?: number;
	readonly rsvp?: RsvpResponse;
	/** Pushed as DESCRIPTION (§9); one-way, render-on-push. */
	readonly description?: string;
	/** Vault wikilinks or external URLs, pushed as ATTACH (§9.4). */
	readonly attachments?: readonly string[];
	/** Reminder offset, e.g. `-15m`, serialized as VALARM (§13). */
	readonly alarm?: string;
	readonly location?: string;
	/** Mapped to CATEGORIES; the tags mapping is prefix-scoped (§13). */
	readonly categories?: readonly string[];
	readonly class?: EventClass;
	readonly transp?: Transparency;
	readonly status?: EventStatus;
}
