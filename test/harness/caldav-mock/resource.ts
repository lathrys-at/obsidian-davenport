/**
 * This module answers GET, PUT, and DELETE on calendar resources. The
 * handlers read the conditional headers `If-Match` and `If-None-Match`.
 * The push path depends on those headers. The push path is the code that
 * sends local changes to the server. Each run selects whether the mock
 * enforces the preconditions in those headers. A server that does not
 * enforce the preconditions accepts every write. A reader must still be
 * able to follow what the engine does against such a server.
 *
 * The mock enters a write in the scheduling record when the write
 * succeeds and the resource has attendees before the write or after the
 * write. The mock does not enter a write that it refused. A refused write
 * changes nothing on the server, and a real server therefore sends no
 * mail.
 */

import type { MockServerCapabilities } from './capabilities';
import { readIcs } from './ics';
import type { SchedulingFact } from './observation';
import { servedBody } from './prop-values';
import { plain, preconditionError, type MockResponse } from './response';
import type { Route, ServerState } from './state';
import { CALDAV_NS } from './xml';

const CALENDAR_CONTENT_TYPE = 'text/calendar; charset=utf-8';

export interface WriteContext {
	readonly state: ServerState;
	readonly caps: MockServerCapabilities;
	readonly ifMatch: string | null;
	readonly ifNoneMatch: string | null;
	readonly recordScheduling: (fact: SchedulingFact) => void;
}

export function handleGet(
	route: Route,
	state: ServerState,
	caps: MockServerCapabilities,
): MockResponse {
	if (route.kind === 'absent-resource' || route.kind === 'unknown') {
		return plain(404);
	}
	if (route.kind !== 'resource') {
		return plain(405);
	}
	return plain(
		200,
		{
			'Content-Type': CALENDAR_CONTENT_TYPE,
			ETag: state.reportedEtag(route.resource, caps.etags),
		},
		servedBody(route.resource.ics, caps),
	);
}

export function handlePut(
	route: Route,
	body: string,
	context: WriteContext,
): MockResponse {
	if (route.kind !== 'resource' && route.kind !== 'absent-resource') {
		// A write below a collection that does not exist is a conflict, and
		// not a missing resource. The parent collection must exist first.
		return plain(route.kind === 'unknown' ? 409 : 405);
	}
	if (!body.includes('BEGIN:VCALENDAR')) {
		return preconditionError(403, CALDAV_NS, 'valid-calendar-data');
	}
	const incoming = readIcs(body);
	if (
		incoming.component !== null &&
		!route.collection.components.includes(incoming.component)
	) {
		return preconditionError(
			403,
			CALDAV_NS,
			'supported-calendar-component',
		);
	}
	const existing = route.kind === 'resource' ? route.resource : null;
	const refusal = checkPreconditions(existing?.etag ?? null, context);
	if (refusal) {
		return refusal;
	}

	const name = route.kind === 'resource' ? route.resource.name : route.name;
	const before = existing ? readIcs(existing.ics).attendees : [];
	const after = incoming.attendees;
	const etag = context.state.write(route.collection, name, body);
	context.recordScheduling({
		method: 'PUT',
		href: `${route.collection.href}${name}`,
		attendeesBefore: before,
		attendeesAfter: after,
	});
	return plain(existing ? 204 : 201, { ETag: etag });
}

export function handleDelete(
	route: Route,
	context: WriteContext,
): MockResponse {
	if (route.kind === 'absent-resource' || route.kind === 'unknown') {
		return plain(404);
	}
	if (route.kind !== 'resource') {
		return plain(405);
	}
	const refusal = checkPreconditions(route.resource.etag, context);
	if (refusal) {
		return refusal;
	}
	const before = readIcs(route.resource.ics).attendees;
	context.state.remove(route.collection, route.resource.name);
	context.recordScheduling({
		method: 'DELETE',
		href: route.resource.href,
		attendeesBefore: before,
		attendeesAfter: [],
	});
	return plain(204);
}

/**
 * Checks the conditional headers of a write. The result is null when the
 * write can continue. `If-None-Match` guards the creation of a resource.
 * `If-Match` guards the update of a resource. The mock reads a header
 * only when the server of this run enforces that header.
 */
function checkPreconditions(
	currentEtag: string | null,
	context: WriteContext,
): MockResponse | null {
	const { caps, ifNoneMatch } = context;
	if (caps.enforceIfNoneMatch && ifNoneMatch !== null) {
		const wanted = ifNoneMatch.trim();
		const blocked =
			wanted === '*'
				? currentEtag !== null
				: currentEtag !== null &&
					matchesEtag(wanted, currentEtag, 'weak');
		if (blocked) {
			return plain(412);
		}
	}
	return checkIfMatch(currentEtag, context);
}

/**
 * Checks `If-Match` alone, for the write paths that create nothing. A
 * resource that is not there fails the header in every form, because
 * that resource has no ETag for the header to name.
 */
export function checkIfMatch(
	currentEtag: string | null,
	context: Pick<WriteContext, 'caps' | 'ifMatch'>,
): MockResponse | null {
	const { caps, ifMatch } = context;
	if (!caps.enforceIfMatch || ifMatch === null) {
		return null;
	}
	const wanted = ifMatch.trim();
	if (currentEtag === null) {
		return plain(412);
	}
	if (wanted !== '*' && !matchesEtag(wanted, currentEtag, 'strong')) {
		return plain(412);
	}
	return null;
}

/**
 * Tells if the tag list of a conditional header names the current ETag.
 * Each of the two headers can carry a list of tags, and one tag that
 * matches makes the whole list match. `If-Match` uses a strong
 * comparison, so a weak tag never matches, in any form. `If-None-Match`
 * uses a weak comparison: the mock removes the `W/` marker from both
 * tags before it compares them.
 */
function matchesEtag(
	header: string,
	current: string,
	comparison: 'strong' | 'weak',
): boolean {
	return header
		.split(',')
		.map((candidate) => candidate.trim())
		.some((candidate) =>
			comparison === 'strong'
				? candidate === current
				: strongTag(candidate) === strongTag(current),
		);
}

function strongTag(tag: string): string {
	return tag.startsWith('W/') ? tag.slice(2) : tag;
}
