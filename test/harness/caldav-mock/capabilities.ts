/**
 * The per-run switchboard. Providers disagree on every one of these, so a
 * suite states the server it is testing against rather than inheriting one
 * shape of server. Anything a real deployment varies belongs here; the
 * component set a collection accepts is the exception, since it is a
 * property of the collection rather than of the server.
 */

export type SyncCollectionSupport = 'supported' | 'unsupported';

/**
 * `frozen` models a server that advertises a CTag and never changes it —
 * the failure mode that makes CTag polling silently miss writes.
 */
export type CtagBehavior = 'advertised' | 'absent' | 'frozen';

/** `per-fetch` mints a new ETag every time one is reported. */
export type EtagStability = 'stable' | 'per-fetch';

/** `re-serialized` returns the stored event reformatted, never verbatim. */
export type GetBodyMode = 'byte-stable' | 're-serialized';

/**
 * A response failure aimed at matching requests. `status` answers with the
 * given code instead of handling the request; `truncate` handles it and
 * then cuts the body short at `truncateAfter` octets.
 */
export interface FaultInjection {
	readonly kind: 'status' | 'truncate';
	/** Matches every method when absent. */
	readonly method?: string;
	/** Matches every path when absent. */
	readonly pathContains?: string;
	/** Number of matching requests to affect; unlimited when absent. */
	readonly times?: number;
	readonly status?: number;
	readonly truncateAfter?: number;
}

/** A discovery hop answered with a redirect instead of a response. */
export interface RedirectInjection {
	readonly location: string;
	readonly status?: number;
}

export interface MockServerCapabilities {
	/** Whether the collection advertises and serves WebDAV-Sync. */
	readonly syncCollection: SyncCollectionSupport;
	/** Rejects every presented sync-token, including ones it just issued. */
	readonly rejectSyncToken: boolean;
	readonly ctag: CtagBehavior;
	readonly enforceIfMatch: boolean;
	readonly enforceIfNoneMatch: boolean;
	readonly etags: EtagStability;
	readonly getBodies: GetBodyMode;
	/** Whether calendar-query accepts a prop-filter on UID. */
	readonly calendarQueryUidFilter: boolean;
	readonly managedAttachments: boolean;
	/** Request path to the redirect that answers it. */
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
