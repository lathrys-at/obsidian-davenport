import type { EventIdentity } from './identity';

/**
 * A tombstone marks a record whose event is gone. The type of the
 * tombstone says where the deletion came from. A local-intent tombstone
 * records a retraction or a deletion that a user decided on one device. A
 * remote-observed tombstone records that the event is no longer on the
 * server. Only a local-intent tombstone can send a DELETE request to the
 * server. A remote-observed tombstone never writes to the server.
 *
 * The type is necessary. Without the type, two mistakes can act together
 * and delete a live event. The first mistake belongs to the device that
 * writes the tombstone. That device can decide wrongly that the server
 * deleted the event. The event is in fact still on the server.
 *
 * The second mistake belongs to the device that reads the tombstone. That
 * device cannot tell an observation of the server from a decision of a
 * user. The device can therefore read the tombstone as a decision of a
 * user. The device then sends a DELETE request for an event that is still
 * live.
 */
export type TombstoneType = 'remote-observed' | 'local-intent';

/**
 * This table gives each tombstone type a rank, and the ranks put the two
 * types in order. A remote-observed tombstone can change to local-intent.
 * A local-intent tombstone never changes back to remote-observed. Each
 * device rewrites the record with the highest rank that the device saw.
 */
export const TOMBSTONE_RANK = {
	'remote-observed': 0,
	'local-intent': 1,
} as const satisfies Record<TombstoneType, number>;

/**
 * A conversion or a calendar move ends one event and starts another event
 * under a new identity. The tombstone of the old event carries this
 * annotation, and the annotation names the new identity. The new identity
 * is the successor. The note that claimed the old event is now an orphaned
 * note. The banner of that note takes its type from the annotation:
 * converted, or moved.
 *
 * The annotation also makes an incomplete operation visible. Vault sync
 * can still carry the files of the successor between devices, so a grace
 * period runs first. After that grace period ends, the successor identity
 * can still resolve to no record and to no note that claims the identity.
 * That state is an operation that stopped half way, and the plugin can
 * detect this state.
 */
export interface TombstoneAnnotation {
	readonly kind: 'converted' | 'moved';
	readonly successor: EventIdentity;
}

export interface Tombstone {
	readonly type: TombstoneType;
	readonly annotation?: TombstoneAnnotation;
}
