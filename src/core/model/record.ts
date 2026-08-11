import type { EventFields } from './event';
import type { EventIdentity } from './identity';
import type { Tombstone } from './tombstone';

/**
 * Record content model (§3.2): the machine's truth for one synced or
 * tombstoned event. This is the content model only — the canonical byte
 * format (digest filename, YAML emission, self-checksum computation) is the
 * record ledger's design (#23). Records are byte-deterministic pure
 * functions of this data and are machine-owned: the plugin may rewrite them
 * wholesale.
 *
 * No per-device fact — timestamps, cursors, device IDs — ever appears here
 * (§3.2); those are device-local (§3.3). The registry's friendly calendar
 * name never appears either: names resolve from the href at read time.
 */

/**
 * Venue pointer (§7.1): a record optionally points at the note (or note
 * section) holding the event's meaning. "Linked" requires the mutual claim —
 * this pointer plus the note's reciprocal `calendar:` + `uid` resolution; a
 * pointer without the reciprocal claim permits record-only application,
 * never a note write.
 */
export interface VenuePointer {
	readonly path: string;
	readonly section?: string;
}

/**
 * Per-instance materialization target for series (§11), keyed by instance
 * date in the record's map. The map is a crown-jewel field: rebuild cannot
 * recover it (§3.2), so it clears only after a resolution concludes
 * deletion, never eagerly (§5.6).
 */
export interface MaterializationEntry {
	readonly path: string;
	readonly section?: string;
	/**
	 * Content hash taken at materialization (§7.3) — the untouched
	 * discriminator for the remote-deletion remove option (§5.4).
	 */
	readonly contentHash?: string;
}

export interface RecordData {
	readonly identity: EventIdentity;
	/** Resource URL within the collection; absent for feed records (§5.2). */
	readonly resourceHref?: string;
	readonly etag?: string;
	/** Modeled event fields as last synced (§3.2). */
	readonly fields: EventFields;
	/**
	 * Last-synced ICS, normalized through canonical serialization — the base
	 * snapshot for three-way comparison (§5.4) and the substrate for
	 * round-trip patching (§5.5).
	 */
	readonly baseIcs: string;
	readonly venue?: VenuePointer;
	/** Instance date → materialized target (§11). */
	readonly materialization?: Readonly<Record<string, MaterializationEntry>>;
	/** Hashes over normalized base ICS property values (§3.2, §9.5) — server
	 * state, never push-time rendered markdown. */
	readonly renderHashes?: {
		readonly description?: string;
		readonly attachments?: string;
	};
	readonly tombstone?: Tombstone;
	/**
	 * Byte-determinism stamp (§3.2): emitter output depends on plugin
	 * versions, so byte-only differences from a newer stamp suppress
	 * rewrites on older devices.
	 */
	readonly normalizationVersion: number;
	/** Self-checksum over canonical bytes with this field blanked (§3.2). */
	readonly checksum: string;
}
