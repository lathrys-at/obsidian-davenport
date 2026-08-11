import type { EventIdentity } from './identity';

/**
 * Tombstone typing by origin. Only local-intent tombstones may issue
 * DELETE; remote-observed tombstones never write to the server. The typing
 * exists because a tombstone whose origin the reader cannot determine
 * could escalate a misdiagnosed remote deletion into a DELETE against a
 * live event.
 */
export type TombstoneType = 'remote-observed' | 'local-intent';

/**
 * Monotone dominance: remote-observed may upgrade to local-intent, never
 * the reverse. Devices re-canonicalize to the highest rank seen.
 */
export const TOMBSTONE_RANK = {
	'remote-observed': 0,
	'local-intent': 1,
} as const satisfies Record<TombstoneType, number>;

/**
 * Successor annotation for conversions and calendar moves. The orphaned
 * note's banner is typed by it, and an annotated successor resolving to no
 * record and no claiming note past the flight grace period is a detectable
 * half-completed operation.
 */
export interface TombstoneAnnotation {
	readonly kind: 'converted' | 'moved';
	readonly successor: EventIdentity;
}

export interface Tombstone {
	readonly type: TombstoneType;
	readonly annotation?: TombstoneAnnotation;
}
