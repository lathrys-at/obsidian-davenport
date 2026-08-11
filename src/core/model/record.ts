import type { EventFields } from './event';
import type { EventIdentity } from './identity';
import type { Tombstone } from './tombstone';

/**
 * Record content model: the machine's truth for one synced or tombstoned
 * event. Content model only — the canonical byte format (digest filename,
 * YAML emission, checksum computation) is the record ledger's concern.
 * Records are byte-deterministic pure functions of this data and are
 * machine-owned: the plugin may rewrite them wholesale.
 *
 * No per-device fact — timestamps, cursors, device IDs — ever appears
 * here; per-device content inside a shared file makes divergence
 * structural. The registry's friendly calendar name never appears either:
 * names resolve from the collection href at read time, so a rename
 * rewrites zero records. {@link RecordFields} encodes that exclusion.
 */

/**
 * Venue pointer: a record optionally points at the note (or note section)
 * holding the event's meaning. "Linked" requires the mutual claim — this
 * pointer plus the note's reciprocal calendar-and-uid resolution. A
 * pointer without the reciprocal claim permits record-only application,
 * never a note write.
 */
export interface VenuePointer {
	readonly path: string;
	readonly section?: string;
	/**
	 * Hash of the note's content taken at materialization. Remote-deletion
	 * cleanup may trash a note only while its content still matches — the
	 * guard against deleting words a user wrote.
	 */
	readonly contentHash?: string;
}

/**
 * Per-instance materialization target for recurring series, keyed by
 * instance date in the record's map. The map cannot be rebuilt from the
 * server, so it clears only after a resolution concludes deletion, never
 * eagerly.
 */
export interface MaterializationEntry {
	readonly path: string;
	readonly section?: string;
	/** Same discriminator as {@link VenuePointer.contentHash}, per instance. */
	readonly contentHash?: string;
}

/**
 * Modeled fields as stored in a record. The friendly calendar name is
 * structurally excluded: it is settings-derived and resolves from the
 * collection href at read time.
 */
export type RecordFields = Omit<EventFields, 'calendar'>;

export interface RecordData {
	readonly identity: EventIdentity;
	/** Resource URL within the collection; absent for feed records. */
	readonly resourceHref?: string;
	readonly etag?: string;
	/** Modeled event fields as last synced. */
	readonly fields: RecordFields;
	/**
	 * Last-synced ICS, normalized through canonical serialization — the
	 * base snapshot for three-way comparison and the substrate for
	 * round-trip patching.
	 */
	readonly baseIcs: string;
	readonly venue?: VenuePointer;
	/** Instance date → materialized target. */
	readonly materialization?: Readonly<Record<string, MaterializationEntry>>;
	/**
	 * Hashes over normalized base ICS property values — server state, never
	 * push-time rendered markdown, which only the pushing device could
	 * know.
	 */
	readonly renderHashes?: {
		readonly description?: string;
		readonly attachments?: string;
	};
	readonly tombstone?: Tombstone;
	/**
	 * Byte-determinism stamp: emitter output varies across plugin versions,
	 * so byte-only differences from a newer stamp suppress rewrites on
	 * older devices.
	 */
	readonly normalizationVersion: number;
	/** Self-checksum over canonical bytes with this field blanked. */
	readonly checksum: string;
}
