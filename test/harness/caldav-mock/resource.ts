/**
 * GET, PUT, and DELETE on calendar resources, with the conditional
 * headers the push path depends on. Whether the preconditions are
 * enforced is a per-run capability: a server that ignores them accepts
 * every write, which is the case the engine has to be legible about.
 *
 * A write that succeeds and touches attendees on either side is entered in
 * the scheduling record. A refused write is not: nothing left the server,
 * so nothing would have been mailed.
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
		// A write under a collection that is not there is a conflict, not a
		// missing resource: the parent has to exist first.
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
 * Null when the write may proceed. `If-None-Match` guards creation and
 * `If-Match` guards update; each is only consulted where this run's
 * server enforces it.
 */
function checkPreconditions(
	currentEtag: string | null,
	context: WriteContext,
): MockResponse | null {
	const { caps, ifMatch, ifNoneMatch } = context;
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
	if (caps.enforceIfMatch && ifMatch !== null) {
		const wanted = ifMatch.trim();
		if (currentEtag === null) {
			return plain(412);
		}
		if (wanted !== '*' && !matchesEtag(wanted, currentEtag, 'strong')) {
			return plain(412);
		}
	}
	return null;
}

/**
 * Whether a conditional header's tag list names this ETag; either header
 * may carry a list, and any member matching is a match. `If-Match`
 * compares strongly, so a weak tag never matches it however it is spelled;
 * `If-None-Match` compares weakly, where the marker is dropped from both
 * sides before comparison.
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
