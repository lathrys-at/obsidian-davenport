/**
 * The entry point of the sweep harness. A sweep is a standing assertion
 * about one simulation run. This module re-exports the parts of the
 * harness, so that a test imports the harness from one path.
 *
 * The harness has four parts:
 *
 * - The evidence is the record of what one simulation run leaves behind.
 * - The fetch poison replaces the global fetch with a function that
 *   throws. A call that does not go through the transport port therefore
 *   fails in the test that makes the call.
 * - The registry holds the sweeps that a run evaluates. Every run starts
 *   with the standing set.
 * - The run helper runs one simulation. When the simulation ends, the
 *   helper collects the evidence and evaluates every registered sweep
 *   over that evidence.
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
	VaultSyncEvidence,
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
