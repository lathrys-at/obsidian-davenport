/**
 * In-process CalDAV server for the engine suites. It stands where the
 * transport adapter would, so a run exercises the real request path with
 * no network and no ambient state.
 */

export { MockCalDavServer, type MockServerConfig } from './server';
export {
	DEFAULT_CAPABILITIES,
	type CtagBehavior,
	type EtagStability,
	type FaultInjection,
	type GetBodyMode,
	type MockServerCapabilities,
	type RedirectInjection,
	type SyncCollectionSupport,
} from './capabilities';
export {
	RequestLog,
	SchedulingRecord,
	type AttendeeTransition,
	type ReportKind,
	type RequestLogEntry,
	type SchedulingEntry,
} from './observation';
export type { AccountSeed, CollectionSeed, ResourceSeed } from './state';
export {
	CALDAV_NS,
	CALENDARSERVER_NS,
	DAV_NS,
	childElements,
	childNamed,
	childrenNamed,
	descendantsNamed,
	isNamed,
	parseXml,
	textOf,
} from './xml';
