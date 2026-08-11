/**
 * What the vault-sync channel moves between devices.
 *
 * A change captured on one device becomes one delivery per peer. Every
 * delivery carries the content the origin replaced, and that is what lets
 * a destination tell a clean fast-forward from a divergence: a destination
 * holding exactly that content has seen everything the origin had seen, so
 * the change applies; holding anything else means a local edit the origin
 * never saw.
 *
 * Modification times ride on the delivery because the vault port exposes
 * none. The channel records the time a sync tool would leave on the file
 * so consumers have the fact, rather than growing the port a member no
 * production code reads.
 */

export type DeviceId = string;

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
	readonly modifiedAt: number;
	/**
	 * Whether the destination keeps the origin's modification time. False
	 * means the file is stamped with the destination's clock on arrival.
	 */
	readonly preserveModifiedAt: boolean;
}

/**
 * How a delivery landed. The first four are clean applications; the rest
 * name what happened instead: `converged` where the destination already
 * held the delivered content, and `overwritten`, `conflict-copy`,
 * `merged`, and `kept-local` where a local edit stood in the way and the
 * profile decided the outcome.
 */
export type DeliveryOutcome =
	| 'created'
	| 'updated'
	| 'renamed'
	| 'deleted'
	| 'converged'
	| 'overwritten'
	| 'conflict-copy'
	| 'merged'
	| 'kept-local';

export interface LandedDelivery {
	readonly delivery: Delivery;
	readonly outcome: DeliveryOutcome;
	/** Where displaced local content went, where a copy was made. */
	readonly conflictPath: string | null;
	/** The modification time the destination now holds for the path. */
	readonly modifiedAt: number;
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
