/**
 * What the vault-sync channel moves between devices.
 *
 * A change that the channel captures on one device becomes one delivery
 * for each peer device. Every delivery carries the version of the path
 * that the delivery changes. The destination compares that version
 * against the version that the destination holds for the same path. This
 * comparison answers one question: is the destination only behind the
 * origin, or did the two devices diverge?
 *
 * The destination is only behind when the version of the delivery covers
 * the version of the destination. The destination then holds no change
 * that the origin did not see, so the change applies, however far behind
 * the destination is. The two devices diverged when neither version
 * covers the other. The two devices then made their changes with no
 * knowledge of each other.
 *
 * A delivery also carries the content that the origin replaced. A merge
 * uses this content as its base. This content has no part in the
 * comparison above.
 *
 * A delivery carries a modification time, because the vault port has no
 * member for the modification time of a file. The channel records the
 * time that a sync tool would put on the file, so that a consumer has
 * this fact. The other option is a new member on the vault port, and no
 * production code reads such a member.
 */

import type { PathVersion } from './version';

export type DeviceId = string;

/**
 * Who wrote the content that a path holds, and when they wrote it. This
 * is the authorship of the content. This is not the modification time of
 * the file. A sync tool can stamp a file with the clock of the
 * destination as the file arrives. Such a stamp changes the modification
 * time of the file and never the authorship. The authorship decides a
 * divergence. The modification time has no part in that decision. Both
 * devices hold the same pair of stamps. Thus both devices rank the same
 * pair of changes in the same order.
 */
export interface ContentStamp {
	readonly author: DeviceId;
	readonly at: number;
}

/** The file operation that a delivery asks its destination to do. */
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

/**
 * A change that the channel observed on one device. The channel holds
 * the change in this form before it makes a delivery for each peer
 * device.
 */
export interface CapturedChange {
	readonly change: DeliveryChange;
	/**
	 * The content that the origin replaced. Null when the origin held no
	 * file at the path.
	 */
	readonly previousContent: string | null;
	/** The version that the origin holds for the path after the change. */
	readonly version: PathVersion;
	/** The reading of the origin's clock when the origin made the change. */
	readonly modifiedAt: number;
}

/** One captured change on its way to one peer device. */
export interface Delivery {
	readonly id: number;
	readonly from: DeviceId;
	readonly to: DeviceId;
	readonly change: DeliveryChange;
	readonly previousContent: string | null;
	readonly version: PathVersion;
	readonly modifiedAt: number;
	/**
	 * True when the destination keeps the modification time of the origin.
	 * False when the destination stamps the file with the clock of the
	 * destination as the file arrives.
	 */
	readonly preserveModifiedAt: boolean;
	/**
	 * True when this delivery carries a conflict copy that a landing made,
	 * and not a change that a device made. A conflict copy travels one
	 * time only. The destination writes the copy where the path of the
	 * copy is free. The destination drops the copy where the path is not
	 * free. The destination never resolves a conflict copy against a local
	 * change, and never sends a conflict copy on to another device.
	 */
	readonly conflictCopy: boolean;
}

/**
 * How a delivery landed.
 *
 * Four outcomes say that the destination applied the change cleanly:
 * `created`, `updated`, `renamed`, and `deleted`. The other outcomes say
 * what the destination did in place of a clean application.
 *
 * With two outcomes the destination wrote nothing:
 *
 * - `converged`: the destination already held the content that the
 *   delivery carries.
 * - `superseded`: the version that the destination holds already covers
 *   the version of the delivery.
 *
 * With six outcomes the two devices diverged, and the profile decided
 * the result:
 *
 * - `overwritten`: the content of the delivery replaced the local
 *   content.
 * - `conflict-copy`: the destination moved one of the two contents aside
 *   into a copy.
 * - `merged`: the destination merged the two contents.
 * - `kept-local`: the local content stayed at the path.
 * - `resurrected`: a file that the destination deleted came back.
 * - `duplicated`: a rename could not move a source file that the
 *   destination changed, so the destination left the source file in
 *   place, beside the path that the rename moves to.
 *
 * The outcome `conflict-copy` says that the destination made a copy, and
 * the field `conflictPath` says where the copy is. That path also tells
 * which side lost: a destination that keeps its own content moves the
 * content of the delivery into the copy, and a destination that takes
 * the content of the delivery moves its own content into the copy.
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
	/**
	 * The path of the copy that holds the content of the losing side.
	 * Null when the destination made no copy.
	 */
	readonly conflictPath: string | null;
	/**
	 * The modification time that the destination now holds for the path.
	 * The value is null when the destination holds no such path. Two
	 * cases make the value null. First, the delivery carried a deletion.
	 * Second, the destination deleted the path itself before the delivery
	 * arrived.
	 */
	readonly modifiedAt: number | null;
}

/**
 * Picks deliveries out of the queue of pending deliveries. A member that
 * the caller leaves out matches every delivery. A member that the caller
 * gives matches a delivery that equals one of the values of that member.
 * For a rename, the path member matches the path that the rename moves
 * to, and the path member also matches the path that the rename moves
 * from. Thus a test that scripts a rename gives only the path that the
 * test knows.
 */
export interface DeliverySelector {
	readonly from?: DeviceId | readonly DeviceId[];
	readonly to?: DeviceId | readonly DeviceId[];
	readonly path?: string | readonly string[];
}
