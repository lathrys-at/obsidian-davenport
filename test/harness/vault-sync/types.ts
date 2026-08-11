/**
 * What the vault-sync channel moves between devices.
 *
 * A change captured on one device becomes one delivery per peer. Every
 * delivery carries the version of the path it changes, and comparing that
 * against the version the destination holds is what tells a fast-forward
 * from a divergence: a destination whose version the delivery covers has
 * seen nothing the origin missed, so the change applies, however far
 * behind it is; two versions where neither covers the other are edits
 * made without knowledge of each other. The content the origin replaced
 * rides along as the base a merge needs, not as the discriminator.
 *
 * Modification times ride on the delivery because the vault port exposes
 * none. The channel records the time a sync tool would leave on the file
 * so consumers have the fact, rather than growing the port a member no
 * production code reads.
 */

import type { PathVersion } from './version';

export type DeviceId = string;

/**
 * Who wrote the content a path holds, and when they wrote it. This is
 * authorship, not the file's modification time: a tool that stamps an
 * arrival with the destination's clock changes the second and never the
 * first, and it is the first that decides a divergence, so both devices
 * rank the same pair of edits the same way.
 */
export interface ContentStamp {
	readonly author: DeviceId;
	readonly at: number;
}

/** The file operation a delivery asks its destination to perform. */
export type DeliveryChange =
	| {
			readonly kind: 'upsert';
			readonly path: string;
			readonly content: string;
	  }
	| { readonly kind: 'delete'; readonly path: string }
	| {
			readonly kind: 'rename';
			readonly path: string;
			readonly oldPath: string;
			readonly content: string;
	  };

/** A local change the channel observed, before it is aimed at a peer. */
export interface CapturedChange {
	readonly change: DeliveryChange;
	/** Content the origin replaced; null where the file was absent. */
	readonly previousContent: string | null;
	/** The origin's version of the path once the change was made. */
	readonly version: PathVersion;
	/** The origin's clock reading when the change was made. */
	readonly modifiedAt: number;
}

/** One captured change in flight to one peer. */
export interface Delivery {
	readonly id: number;
	readonly from: DeviceId;
	readonly to: DeviceId;
	readonly change: DeliveryChange;
	readonly previousContent: string | null;
	readonly version: PathVersion;
	readonly modifiedAt: number;
	/**
	 * Whether the destination keeps the origin's modification time. False
	 * means the file is stamped with the destination's clock on arrival.
	 */
	readonly preserveModifiedAt: boolean;
	/**
	 * Whether this delivery carries a conflict copy a landing made rather
	 * than a change a device made. A copy travels once: it is written
	 * where the destination has the path free, dropped where it does not,
	 * and never resolved or propagated further.
	 */
	readonly conflictCopy: boolean;
}

/**
 * How a delivery landed. `created`, `updated`, `renamed`, and `deleted`
 * are clean applications; the rest name what happened instead.
 * `converged` is a destination that already held the delivered content
 * and `superseded` one whose version already covered the delivery, so
 * neither wrote anything. `overwritten`, `conflict-copy`, `merged`,
 * `kept-local`, `resurrected`, and `duplicated` are divergences the
 * profile decided: the local content was replaced by the delivery, one of
 * the two was moved aside into a copy, the two were merged, the local
 * content stood, a locally deleted file came back, or a rename could not
 * move a source the destination had edited and left it in place beside
 * the path it was moving to. `conflict-copy` says a copy was made and
 * `conflictPath` says where; which side lost is read from there, since a
 * destination whose own content wins moves the delivery's aside instead.
 */
export type DeliveryOutcome =
	| 'created'
	| 'updated'
	| 'renamed'
	| 'deleted'
	| 'converged'
	| 'superseded'
	| 'overwritten'
	| 'conflict-copy'
	| 'merged'
	| 'kept-local'
	| 'resurrected'
	| 'duplicated';

export interface LandedDelivery {
	readonly delivery: Delivery;
	readonly outcome: DeliveryOutcome;
	/** Where the losing side's content went, where a copy was made. */
	readonly conflictPath: string | null;
	/**
	 * The modification time the destination now holds for the path, or
	 * null where it holds no such path — a delivered deletion, or one it
	 * had already made itself.
	 */
	readonly modifiedAt: number | null;
}

/**
 * Picks deliveries out of the pending queue. An omitted member matches
 * everything; a member matches when the delivery equals one of its values.
 * A rename matches on either the path it moves to or the one it moves
 * from, so scripting a rename needs only the name the test knows.
 */
export interface DeliverySelector {
	readonly from?: DeviceId | readonly DeviceId[];
	readonly to?: DeviceId | readonly DeviceId[];
	readonly path?: string | readonly string[];
}
