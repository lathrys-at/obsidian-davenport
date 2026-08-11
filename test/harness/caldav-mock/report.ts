/**
 * REPORT: sync-collection, calendar-query, and calendar-multiget. Each
 * answers only on a calendar collection, and each refuses with the
 * precondition element its RFC names, so a client can tell an unsupported
 * feature from an empty result.
 */

import { matchesFilter, parseFilter } from './filter';
import type { ReportKind } from './observation';
import { requestedProps } from './propfind';
import { appendResponse, type PropContext } from './props';
import {
	multistatus,
	plain,
	preconditionError,
	statusText,
	type MockResponse,
} from './response';
import type { CollectionState, ResourceState, Route } from './state';
import {
	CALDAV_NS,
	childNamed,
	DAV_NS,
	descendantsNamed,
	isNamed,
	textOf,
	type PropName,
	type XmlDocument,
	type XmlElement,
	type XmlOutput,
} from './xml';

export function reportKindOf(document: XmlDocument | null): ReportKind | null {
	const root = document?.documentElement;
	if (!root) {
		return null;
	}
	if (isNamed(root, DAV_NS, 'sync-collection')) {
		return 'sync-collection';
	}
	if (isNamed(root, CALDAV_NS, 'calendar-query')) {
		return 'calendar-query';
	}
	if (isNamed(root, CALDAV_NS, 'calendar-multiget')) {
		return 'calendar-multiget';
	}
	return null;
}

/** Empty text for an initial sync; null when the body is not a sync. */
export function presentedSyncToken(
	document: XmlDocument | null,
): string | null {
	const root = document?.documentElement;
	if (!root || !isNamed(root, DAV_NS, 'sync-collection')) {
		return null;
	}
	const token = childNamed(root, DAV_NS, 'sync-token');
	return token ? textOf(token) : '';
}

export function handleReport(
	route: Route,
	document: XmlDocument | null,
	context: PropContext,
): MockResponse {
	const kind = reportKindOf(document);
	if (kind === null || document === null) {
		return plain(400);
	}
	if (route.kind !== 'collection') {
		return plain(
			route.kind === 'unknown' || route.kind === 'absent-resource'
				? 404
				: 405,
		);
	}
	const requested = requestedProps(document);
	switch (kind) {
		case 'sync-collection':
			return syncCollection(
				route.collection,
				document,
				requested,
				context,
			);
		case 'calendar-query':
			return calendarQuery(
				route.collection,
				document,
				requested,
				context,
			);
		case 'calendar-multiget':
			return calendarMultiget(
				route.collection,
				document,
				requested,
				context,
			);
	}
}

function syncCollection(
	collection: CollectionState,
	document: XmlDocument,
	requested: readonly PropName[] | null,
	context: PropContext,
): MockResponse {
	const { state, caps } = context;
	if (caps.syncCollection === 'unsupported') {
		return preconditionError(403, DAV_NS, 'supported-report');
	}
	const presented = presentedSyncToken(document) ?? '';
	if (presented !== '' && caps.rejectSyncToken) {
		return preconditionError(403, DAV_NS, 'valid-sync-token');
	}
	const since =
		presented === '' ? 0 : state.parseSyncToken(collection, presented);
	if (since === null) {
		return preconditionError(403, DAV_NS, 'valid-sync-token');
	}

	return multistatus((out, root) => {
		for (const [href, kind] of changesSince(collection, since)) {
			const resource =
				kind === 'removed'
					? undefined
					: resourceByHref(collection, href);
			appendResource(
				out,
				root,
				href,
				collection,
				resource,
				requested,
				context,
			);
		}
		out.child(root, DAV_NS, 'sync-token', state.syncTokenOf(collection));
	});
}

/**
 * The change set a client holding this token has not seen: one entry per
 * href with the latest outcome, and every current member for an initial
 * sync.
 */
function changesSince(
	collection: CollectionState,
	since: number,
): Map<string, 'changed' | 'removed'> {
	const reported = new Map<string, 'changed' | 'removed'>();
	if (since === 0) {
		for (const resource of collection.resources.values()) {
			reported.set(resource.href, 'changed');
		}
		return reported;
	}
	for (const change of collection.changes) {
		if (change.token > since) {
			reported.set(change.href, change.kind);
		}
	}
	return reported;
}

function calendarQuery(
	collection: CollectionState,
	document: XmlDocument,
	requested: readonly PropName[] | null,
	context: PropContext,
): MockResponse {
	const filter = parseFilter(document);
	if (filter.uidMatch !== null && !context.caps.calendarQueryUidFilter) {
		return preconditionError(
			403,
			CALDAV_NS,
			'supported-filter',
			(out, condition) => {
				out.child(condition, CALDAV_NS, 'prop-filter').setAttribute(
					'name',
					'UID',
				);
			},
		);
	}
	return multistatus((out, root) => {
		for (const resource of collection.resources.values()) {
			if (matchesFilter(resource.ics, filter)) {
				appendResource(
					out,
					root,
					resource.href,
					collection,
					resource,
					requested,
					context,
				);
			}
		}
	});
}

function calendarMultiget(
	collection: CollectionState,
	document: XmlDocument,
	requested: readonly PropName[] | null,
	context: PropContext,
): MockResponse {
	const root = document.documentElement;
	const hrefs = root
		? descendantsNamed(root, DAV_NS, 'href').map((el) => pathOf(textOf(el)))
		: [];
	return multistatus((out, envelope) => {
		for (const href of hrefs) {
			appendResource(
				out,
				envelope,
				href,
				collection,
				resourceByHref(collection, href),
				requested,
				context,
			);
		}
	});
}

/** A found resource answers with its properties; a missing one with 404. */
function appendResource(
	out: XmlOutput,
	parent: XmlElement,
	href: string,
	collection: CollectionState,
	resource: ResourceState | undefined,
	requested: readonly PropName[] | null,
	context: PropContext,
): void {
	if (!resource) {
		const response = out.child(parent, DAV_NS, 'response');
		out.child(response, DAV_NS, 'href', href);
		out.child(response, DAV_NS, 'status', statusText(404));
		return;
	}
	appendResponse(
		out,
		parent,
		href,
		{
			kind: 'resource',
			account: context.state.account(collection.accountName),
			collection,
			resource,
		},
		requested,
		context,
	);
}

/** Hrefs arrive as paths or as absolute URLs; both name the same resource. */
function pathOf(href: string): string {
	if (!href.includes('://')) {
		return href;
	}
	const separator = href.indexOf('/', href.indexOf('://') + 3);
	return separator === -1 ? '/' : href.slice(separator);
}

function resourceByHref(
	collection: CollectionState,
	href: string,
): ResourceState | undefined {
	return href.startsWith(collection.href)
		? collection.resources.get(href.slice(collection.href.length))
		: undefined;
}
