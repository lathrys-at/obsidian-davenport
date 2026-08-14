import type { EventFields } from './event';
import type { EventIdentity } from './identity';
import type { Tombstone } from './tombstone';

/**
 * The content of one record. A record holds what the machine knows about
 * one event. That event is an event that the plugin syncs, or an event
 * that a tombstone marks as deleted.
 *
 * This file models the content only. The record ledger owns the canonical
 * byte format: the digest filename, the YAML output, and the checksum
 * computation. The bytes of a record follow from this content alone, and
 * the same content always gives the same bytes. Records belong to the
 * machine, and the plugin can rewrite a whole record.
 *
 * Some facts belong to one device only: a timestamp, a cursor, a device
 * id. Such a fact never appears here. Devices share these files, and a
 * per-device fact inside a shared file makes the copies of that file
 * differ by construction. The calendar name from the registry never
 * appears here either. The plugin resolves that name from the collection
 * href at read time, so a rename rewrites no record at all.
 * {@link RecordFields} states this exclusion in the type.
 */

/**
 * A pointer from a record to the place that holds the meaning of the
 * event. That place is a note, or one section of a note. A record does
 * not always carry this pointer.
 *
 * A record and a note are linked only when each one claims the other. The
 * record claims the note with this pointer. The note claims the record
 * when the calendar and the uid of the note resolve to that record. If the
 * note does not claim the record back, the plugin can apply a change to
 * the record only. The plugin must not write the note.
 */
export interface VenuePointer {
	readonly path: string;
	readonly section?: string;
	/**
	 * The hash of the content of the note. The plugin takes this hash when
	 * the plugin materializes the venue. The venue is the note, or one
	 * section of a note. After a remote deletion, the cleanup step can
	 * move the note to the trash, but only while the content of the note
	 * still gives this same hash. The check stops the plugin from deleting
	 * words that a user wrote.
	 */
	readonly contentHash?: string;
}

/**
 * The target that one instance of a recurring series materializes into.
 * The record holds a map of these entries, and the key of each entry is
 * the date of the instance. The server does not hold this map, so the
 * plugin cannot build the map again from the server. The plugin clears the
 * map only after a resolution concludes deletion, and never before that
 * conclusion.
 */
export interface MaterializationEntry {
	readonly path: string;
	readonly section?: string;
	/**
	 * The same hash and the same rule as
	 * {@link VenuePointer.contentHash}, for one instance.
	 */
	readonly contentHash?: string;
}

/**
 * The modeled fields as a record stores them. The type removes the
 * calendar name that the user sees: that name comes from the settings, and
 * the plugin resolves it from the collection href at read time.
 */
export type RecordFields = Omit<EventFields, 'calendar'>;

export interface RecordData {
	readonly identity: EventIdentity;
	/**
	 * The URL of the resource inside the collection. A feed record has no
	 * such URL.
	 */
	readonly resourceHref?: string;
	readonly etag?: string;
	/** The modeled event fields, as the last sync left them. */
	readonly fields: RecordFields;
	/**
	 * The ICS text of the last sync, after canonical serialization
	 * normalizes it. This text is the base snapshot when the plugin
	 * compares three versions. This text is also the material that the
	 * plugin patches, so that a round trip keeps the properties that the
	 * plugin does not model.
	 */
	readonly baseIcs: string;
	readonly venue?: VenuePointer;
	/** A map from the date of an instance to the materialized target. */
	readonly materialization?: Readonly<Record<string, MaterializationEntry>>;
	/**
	 * Hashes of property values from the normalized base ICS. These values
	 * are the state on the server. The plugin never hashes the markdown
	 * that it renders at push time, because only the device that pushes
	 * can know that markdown.
	 */
	readonly renderHashes?: {
		readonly description?: string;
		readonly attachments?: string;
	};
	readonly tombstone?: Tombstone;
	/**
	 * The stamp that makes the bytes deterministic. The emitter of one
	 * plugin version writes different bytes from the emitter of another
	 * version. Sometimes a device reads a record that carries a stamp
	 * newer than the stamp of that device. If the differences are in the
	 * bytes only, the older device makes no rewrite.
	 */
	readonly normalizationVersion: number;
	/**
	 * The checksum of the record over its own canonical bytes. The plugin
	 * blanks this field before it computes the checksum.
	 */
	readonly checksum: string;
}
