/**
 * The settings that state how the mock server behaves during one test run.
 * Real CalDAV servers behave differently from each other in each of the
 * ways below. A suite therefore states the server behavior that it tests
 * against, and does not inherit one fixed behavior.
 *
 * Every behavior that changes from one real deployment to another belongs
 * in this file. There is one exception. The set of components that a
 * collection accepts is a property of the collection, and not a property
 * of the server. This set therefore does not belong here.
 */

export type SyncCollectionSupport = 'supported' | 'unsupported';

/**
 * How the collection reports its CTag. The server changes the CTag after
 * each write to the collection. A client reads the CTag to find the writes
 * that the client has not seen. With `frozen`, the server gives a
 * CTag and then never changes that CTag. A client that polls such a
 * server misses every write, and sees no sign that a write occurred.
 */
export type CtagBehavior = 'advertised' | 'absent' | 'frozen';

/**
 * How stable the ETag of a resource is. With `per-fetch`, the server
 * makes a new ETag each time that the server reports an ETag.
 */
export type EtagStability = 'stable' | 'per-fetch';

/**
 * How a read returns a stored event. With `re-serialized`, the server
 * formats the stored event again, and never returns the stored octets.
 */
export type GetBodyMode = 'byte-stable' | 're-serialized';

/**
 * A failure that the server applies to the requests that match the fault.
 * A fault of kind `status` answers with the given status code, and does
 * not handle the request. A fault of kind `truncate` handles the request,
 * and then cuts the body short after `truncateAfter` octets.
 */
export interface FaultInjection {
	readonly kind: 'status' | 'truncate';
	/** The fault matches every method when this field is absent. */
	readonly method?: string;
	/** The fault matches every path when this field is absent. */
	readonly pathContains?: string;
	/**
	 * How many matching requests the fault affects. The fault affects
	 * every matching request when this field is absent.
	 */
	readonly times?: number;
	readonly status?: number;
	readonly truncateAfter?: number;
}

/**
 * A step of discovery that the server answers with a redirect, and not
 * with the usual answer.
 */
export interface RedirectInjection {
	readonly location: string;
	readonly status?: number;
}

export interface MockServerCapabilities {
	/** `supported` makes the collection advertise and serve WebDAV-Sync. */
	readonly syncCollection: SyncCollectionSupport;
	/**
	 * When true, the server refuses every sync-token that a client sends,
	 * including a token that the server issued a moment before.
	 */
	readonly rejectSyncToken: boolean;
	readonly ctag: CtagBehavior;
	readonly enforceIfMatch: boolean;
	readonly enforceIfNoneMatch: boolean;
	readonly etags: EtagStability;
	readonly getBodies: GetBodyMode;
	/** When true, a calendar-query accepts a prop-filter on the UID. */
	readonly calendarQueryUidFilter: boolean;
	readonly managedAttachments: boolean;
	/**
	 * Each key is a request path. The value is the redirect that answers a
	 * request for that path.
	 */
	readonly redirects: Readonly<Record<string, RedirectInjection>>;
	readonly faults: readonly FaultInjection[];
}

export const DEFAULT_CAPABILITIES: MockServerCapabilities = {
	syncCollection: 'supported',
	rejectSyncToken: false,
	ctag: 'advertised',
	enforceIfMatch: true,
	enforceIfNoneMatch: true,
	etags: 'stable',
	getBodies: 'byte-stable',
	calendarQueryUidFilter: true,
	managedAttachments: false,
	redirects: {},
	faults: [],
};

export function withCapabilities(
	base: MockServerCapabilities,
	patch: Partial<MockServerCapabilities>,
): MockServerCapabilities {
	return { ...base, ...patch };
}
