/**
 * The invariant-sweep framework: the evidence one simulation leaves, the
 * registry of standing assertions over it, and the helper that runs a
 * simulation and evaluates them all when it ends.
 */

export type {
	CalDavEvidence,
	EvidenceString,
	FeedEvidence,
	NetworkCursor,
	NetworkEvidence,
	NetworkSurface,
	RecordedRequest,
	RemoteObservedWindow,
	RunEvidence,
	SensitiveValue,
	VaultChange,
	VaultEvidence,
} from './evidence';
export {
	NETWORK_SURFACES,
	evidence,
	evidenceStrings,
	networkCursor,
} from './evidence';
export type { FetchAttempt } from './fetch-poison';
export {
	NetworkAccessError,
	clearFetchAttempts,
	fetchPoisonHolds,
	poisonFetch,
	recordedFetchAttempts,
	restoreFetch,
} from './fetch-poison';
export {
	SweepRegistry,
	registerSweep,
	registeredSweeps,
	resetSweeps,
	sweeps,
} from './registry';
export type { SimulationOptions, SimulationRun } from './run';
export { runSimulation } from './run';
export { STANDING_SWEEPS } from './standing';
export type { Sweep, SweepReport, SweepViolation } from './sweep';
export { SweepFailure, describeReports } from './sweep';
