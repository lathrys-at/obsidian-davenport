import type { EventIdentity } from './identity';

/**
 * Tombstone typing by origin (§5.6). Only local-intent tombstones may issue
 * `DELETE`; remote-observed tombstones never write to the server. The
 * typing exists because a tombstone whose origin the reader cannot
 * determine could escalate a misdiagnosed remote deletion into a `DELETE`
 * against a live event.
 */
export type TombstoneType = 'remote-observed' | 'local-intent';

/**
 * Monotone dominance (§5.6): remote-observed may upgrade to local-intent,
 * never the reverse. Devices re-canonicalize to the highest rank seen.
 */
export const TOMBSTONE_RANK = {
	'remote-observed': 0,
	'local-intent': 1,
} as const satisfies Record<TombstoneType, number>;

/**
 * Successor annotation for conversions and calendar moves (§10.4). The
 * orphaned-note banner is typed by it, and the incomplete-operation
 * detector (Appendix B row 13b) reads it: an annotated successor resolving
 * to no record and no claiming note past flight grace is a detectable
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
