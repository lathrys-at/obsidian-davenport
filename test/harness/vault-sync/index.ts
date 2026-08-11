/**
 * The vault-sync simulator: simulated devices exchanging file changes
 * under a scripted delivery order, with per-tool conflict, rename, and
 * modification-time behavior.
 */

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
	renderConflictPath,
	splitPath,
	syncToolProfile,
} from './profiles';
export type {
	ConflictCopyContext,
	DivergentDelivery,
	RenameDelivery,
	SyncToolProfile,
} from './profiles';
export type {
	CapturedChange,
	Delivery,
	DeliveryChange,
	DeliveryOutcome,
	DeliverySelector,
	DeviceId,
	LandedDelivery,
} from './types';
