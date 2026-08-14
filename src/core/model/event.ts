/**
 * Event field model. A note declares an event in its frontmatter, which is
 * the YAML block at the top of the note. The types in this file hold the
 * same set of fields, in the form that the plugin uses after it parses the
 * raw frontmatter and validates the result.
 *
 * The machine keeps sync state of its own: etags, hrefs, hashes, and base
 * snapshots. This sync state never appears in the frontmatter. The sync
 * state lives in records.
 */

/**
 * A date and a time, written as ISO 8601 text. Three sources can give the
 * offset from UTC. An offset inside the text wins. If the text has no
 * offset, the timezone of the note applies. If the note has no timezone,
 * the default timezone of the calendar applies. The plugin never uses the
 * local timezone of the device as a silent fallback.
 */
export type IsoDateTime = string;

/** A calendar date, written as ISO 8601 text (`YYYY-MM-DD`). */
export type IsoDate = string;

/** A length of time in short form, for example `30m` or `1h30m`. */
export type DurationText = string;

/**
 * The name of a timezone in the IANA database, for example
 * `Europe/London`.
 */
export type TimezoneName = string;

/**
 * The lifecycle intent of a note. The value `draft` means that the user
 * still plans the event inside the vault. The value `ready` is the signal
 * from the user that the plugin can push the event to the server.
 *
 * The frontmatter has no key that states whether the event is live. This
 * absence is deliberate. A note is live when the plugin resolves a live
 * record for the identity of that note.
 */
export type EventState = 'draft' | 'ready';

/**
 * The STATUS property of an iCalendar event. This property describes the
 * event, and the plugin syncs the property with the server.
 *
 * This type stays separate from {@link EventState} in three ways: the
 * frontmatter key, the set of permitted values, and the identifiers in the
 * code. {@link EventState} is a local signal, and that signal drives the
 * creation of an event. If the two types blur together, a value that only
 * describes an event becomes a write to the server.
 */
export type EventStatus = 'tentative' | 'confirmed' | 'cancelled';

/**
 * The RSVP answer of the user to an invitation. The plugin writes this
 * answer to the server. Before each write, the plugin asks the user to
 * confirm that write.
 */
export type RsvpResponse = 'accepted' | 'declined' | 'tentative';

/** The CLASS property of an iCalendar event. */
export type EventClass = 'public' | 'private' | 'confidential';

/**
 * The TRANSP property of an iCalendar event. An item of type `block` is
 * `opaque` by default.
 */
export type Transparency = 'opaque' | 'transparent';

/**
 * The kind of item that a note declares. An item of type `event` is a
 * commitment at a fixed time, and it becomes a VEVENT. An item of type
 * `task` becomes a VTODO. An item of type `block` also becomes a VEVENT: a
 * block claims time for a task, and the `task` field of the block names
 * that task.
 */
export type ItemType = 'event' | 'task' | 'block';

/**
 * A schedule has one of two shapes: the timed shape or the all-day shape.
 * A note can use one shape only. If a note carries both the `date` key and
 * the `start` key, validation fails and names both keys.
 *
 * The plugin keeps the same rule when it writes. If the shape of a note
 * changes, the same write removes the keys of the shape that the note
 * leaves.
 */
export type Schedule = TimedSchedule | AllDaySchedule;

export interface TimedSchedule {
	readonly kind: 'timed';
	readonly start: IsoDateTime;
	/**
	 * A timed schedule carries `end`, or `duration`, or neither of these
	 * two keys. A timed schedule never carries both keys. If a note
	 * carries both keys, validation fails and names both keys. The plugin
	 * pushes the event only when the schedule carries `end` or `duration`.
	 * A draft can carry a start, and no `end`, and no `duration`. Such a
	 * draft is still correct.
	 */
	readonly end?: IsoDateTime;
	readonly duration?: DurationText;
}

/**
 * The all-day shape of a schedule. The `endDate` field is inclusive: the
 * event covers that day. iCalendar uses an exclusive `DTEND`, which names
 * the day after the event, so the serializer converts the value. Users
 * think of the last day as part of the event, and the exclusive end is the
 * usual cause of an off-by-one-day error.
 */
export interface AllDaySchedule {
	readonly kind: 'all-day';
	readonly date: IsoDate;
	readonly endDate?: IsoDate;
}

/**
 * The event fields that a note declares, after validation. Sync touches
 * these fields only. An iCalendar property that this type does not model
 * stays unchanged through a round trip, because the base ICS of the record
 * holds that property.
 */
export interface EventFields {
	readonly summary?: string;
	/**
	 * The name of the calendar that the user sees. The plugin resolves
	 * this name through the registry. A record never holds this name: the
	 * type of the record fields excludes this field.
	 */
	readonly calendar?: string;
	readonly schedule?: Schedule;
	readonly timezone?: TimezoneName;
	/**
	 * The RRULE text of RFC 5545. One note, or one record, represents the
	 * complete series.
	 */
	readonly rrule?: string;
	readonly type: ItemType;
	/**
	 * A wikilink to the task note that this block serves. Only an item of
	 * type `block` uses this field.
	 */
	readonly task?: string;
	readonly due?: IsoDateTime;
	readonly completed?: IsoDateTime;
	readonly priority?: number;
	readonly rsvp?: RsvpResponse;
	/**
	 * The plugin renders this text at push time, then pushes the result as
	 * the DESCRIPTION property. The text moves one way only, from the note
	 * to the server.
	 */
	readonly description?: string;
	/**
	 * Each item in this list is a wikilink into the vault, or an external
	 * URL. The plugin pushes each item as an ATTACH property.
	 */
	readonly attachments?: readonly string[];
	/**
	 * The time of a reminder, as an offset from the start, for example
	 * `-15m`. The serializer writes this reminder as a VALARM.
	 */
	readonly alarm?: string;
	readonly location?: string;
	/**
	 * The plugin maps these values to the CATEGORIES property. The plugin
	 * maps Obsidian tags to categories too, but only the tags that start
	 * with the prefix for this mapping.
	 */
	readonly categories?: readonly string[];
	readonly class?: EventClass;
	readonly transp?: Transparency;
	readonly status?: EventStatus;
}
