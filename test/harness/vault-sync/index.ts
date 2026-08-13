/**
 * The vault-sync simulator. Each device in the simulator holds a copy of
 * the same vault, and a sync tool moves file changes between the copies.
 * The devices are models, and not real machines. Nothing moves on its
 * own: a test writes a script, and the script sets the order in which the
 * changes arrive.
 *
 * The simulator keeps a version for each path. The version counts the
 * changes that each device made to that path.
 *
 * A delivery moves one change from an origin device to a destination
 * device. The delivery carries the version that the origin device holds
 * for the changed path. The simulator compares that version with the
 * version that the destination device holds. A destination device that
 * is only behind the origin device applies the change. Two devices that
 * changed the same path without knowledge of each other are in conflict.
 *
 * Each sync tool has a profile. The profile states how that tool behaves
 * in a conflict. The profile states which of the two contents stays at
 * the path, and what that tool does with the other content. That tool
 * discards the other content, or makes a conflict copy of the other
 * content, or merges the two contents. The profile states whether a
 * conflict copy reaches the other devices of that tool. The profile also
 * states how that tool delivers a rename, and whether that tool keeps
 * the modification time of a file.
 *
 * This file exports the parts of the simulator that a test uses.
 */

export type { PropagateCopy } from './apply';
export { VaultSyncChannel } from './channel';
export type {
	FlightSkew,
	ReleaseHold,
	VaultSyncChannelOptions,
} from './channel';
export { SyncDevice } from './device';
export type { CaptureSink } from './device';
export { declineMerge, lineMergeMangler } from './mangle';
export type {
	LineConflictRule,
	LineMergeOptions,
	MergeInputs,
	MergeMangler,
} from './mangle';
export {
	DEFAULT_SYNC_PROFILE,
	SYNC_TOOL_PROFILES,
	formatTimestamp,
	incomingWins,
	renderConflictPath,
	splitPath,
	syncToolProfile,
} from './profiles';
export type {
	ConflictCopyContext,
	DivergenceWinner,
	DivergentDelivery,
	RenameDelivery,
	SyncToolProfile,
} from './profiles';
export type {
	CapturedChange,
	ContentStamp,
	Delivery,
	DeliveryChange,
	DeliveryOutcome,
	DeliverySelector,
	DeviceId,
	LandedDelivery,
} from './types';
export { INITIAL_VERSION, bumpVersion, covers, mergeVersions } from './version';
export type { PathVersion } from './version';
