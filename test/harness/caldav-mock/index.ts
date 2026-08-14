/**
 * A CalDAV server that runs in the same process as the engine test
 * suites. This server takes the place of the transport adapter. Thus a
 * run uses the real request path, the run makes no network request, and
 * the run uses no state from outside the run.
 */

export { MockCalDavServer, type MockServerConfig } from './server';
export { MANAGED_ID_HEADER } from './attachments';
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
	REQUEST_BODY_CAP,
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
