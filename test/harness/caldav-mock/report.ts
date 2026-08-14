/**
 * This module answers the REPORT method. The module supports three
 * reports: `sync-collection`, `calendar-query`, and `calendar-multiget`.
 * Each report works only on a calendar collection. When the mock refuses
 * a report, the mock names the precondition element that the RFC for that
 * report defines. The named element lets a client see the difference
 * between a feature that the server does not support and a result that
 * is empty.
 */

import { matchesFilter, parseFilter } from './filter';
import type { ReportKind } from './observation';
import { requestedProps } from './propfind';
import { appendResponse, type PropContext, type PropRequest } from './props';
import {
	multistatus,
	plain,
	preconditionError,
	statusText,
	type MockResponse,
} from './response';
import { membersOf } from './state';
import type { CollectionState, ResourceState, Route } from './state';
import {
	CALDAV_NS,
	childNamed,
	DAV_NS,
	descendantsNamed,
	documentOf,
	isNamed,
	textOf,
	type XmlBody,
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

/**
 * The sync token that the body of the request presents. The value is
 * empty text for an initial sync, which presents no token. The value is
 * null when the body is not a `sync-collection` report.
 */
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
	body: XmlBody,
	context: PropContext,
): MockResponse {
	const document = documentOf(body);
	const kind = reportKindOf(document);
	if (kind === null || document === null) {
		return plain(400);
	}
	// A client can also send a multiget to one calendar object resource.
	// The mock then reads the hrefs in the request against the collection
	// that holds that resource.
	const collection =
		route.kind === 'collection'
			? route.collection
			: route.kind === 'resource' && kind === 'calendar-multiget'
				? route.collection
				: null;
	if (collection === null) {
		return plain(
			route.kind === 'unknown' || route.kind === 'absent-resource'
				? 404
				: 405,
		);
	}
	const requested = requestedProps(document);
	switch (kind) {
		case 'sync-collection':
			return syncCollection(collection, document, requested, context);
		case 'calendar-query':
			return calendarQuery(collection, document, requested, context);
		case 'calendar-multiget':
			return calendarMultiget(collection, document, requested, context);
	}
}

function syncCollection(
	collection: CollectionState,
	document: XmlDocument,
	requested: PropRequest,
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
 * The changes that a client has not seen. The `since` parameter is the
 * counter from the token that the client holds. The result holds one
 * entry for each href, and that entry gives the last outcome for the
 * href. An initial sync presents no token, and the counter is then zero.
 * The result then holds every current member of the collection.
 */
function changesSince(
	collection: CollectionState,
	since: number,
): Map<string, 'changed' | 'removed'> {
	const reported = new Map<string, 'changed' | 'removed'>();
	if (since === 0) {
		for (const resource of membersOf(collection)) {
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
	requested: PropRequest,
	context: PropContext,
): MockResponse {
	const filter = parseFilter(document);
	if (filter.unsupportedCollation !== null) {
		return preconditionError(403, CALDAV_NS, 'supported-collation');
	}
	// The mock returns the name of a filter element that the mock cannot
	// apply, and does not drop that element. A dropped element would
	// answer a different question from the question that the client
	// asked, and that wrong answer would still look complete.
	const unsupported = filter.unsupported;
	if (unsupported !== null) {
		return preconditionError(
			403,
			CALDAV_NS,
			'supported-filter',
			(out, condition) => {
				const element = out.child(
					condition,
					CALDAV_NS,
					unsupported.local,
				);
				if (unsupported.name !== null) {
					element.setAttribute('name', unsupported.name);
				}
			},
		);
	}
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
		for (const resource of membersOf(collection)) {
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
	requested: PropRequest,
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

/**
 * Appends one `<response>` element for one href. A resource that exists
 * answers with its properties. A resource that is not there answers with
 * status 404.
 */
function appendResource(
	out: XmlOutput,
	parent: XmlElement,
	href: string,
	collection: CollectionState,
	resource: ResourceState | undefined,
	requested: PropRequest,
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

/**
 * The path part of an href. An href arrives as a path or as an absolute
 * URL, and the two forms name the same resource.
 */
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
