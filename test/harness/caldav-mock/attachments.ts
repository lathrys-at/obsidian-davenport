/**
 * Managed attachments, the part a suite can exercise: a POST against a
 * calendar object resource adds, replaces, or removes an attachment. The
 * server stores the bytes, rewrites the resource's ATTACH property, and
 * serves the attachment back at the URI it minted, so the capability is
 * observable in the resource and not only in what the server advertises.
 *
 * Three rules bound an attachment's life, because a suite asserting on the
 * attachment path is entitled to know them rather than discover them:
 *
 * An attachment POST rewrites the resource, so it is a write like a PUT
 * and carries the same `If-Match` gate where the run enforces one. A
 * refused POST stores no bytes, rewrites nothing, and enters nothing in
 * the scheduling record, since nothing left the server.
 *
 * An attachment belongs to the resource it was minted against and does not
 * outlive it: removing that resource, by request or out of band, removes
 * its attachments and their URIs answer 404 from then on. A write that
 * merely drops the ATTACH property is not a removal — the bytes stay
 * reachable, as they do on a server that collects them on its own schedule.
 *
 * Turning the capability off is the server not having it: the store is kept
 * but nothing reaches it, so a stored attachment answers 404 for as long as
 * the capability is off and is reachable again when it comes back. Nothing
 * is deleted by the toggle, so a suite can turn the capability off mid-run
 * without the state under it changing.
 *
 * Boundaries: there are no size or count limits, no per-attendee access
 * control, and an attachment belongs to the whole resource rather than to
 * one recurrence instance.
 */

import type { MockServerCapabilities } from './capabilities';
import { icsLineParts, isFoldedContinuation } from '../ics-lines';
import { octetLength } from '../ics-octets';
import { readIcs } from './ics';
import type { SchedulingFact } from './observation';
import { checkIfMatch } from './resource';
import { plain, preconditionError, type MockResponse } from './response';
import type { AttachmentState, Route, ServerState } from './state';
import { CALDAV_NS } from './xml';

export const MANAGED_ID_HEADER = 'Cal-Managed-ID';

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
const DEFAULT_FILENAME = 'attachment';

export interface AttachmentContext {
	readonly state: ServerState;
	readonly caps: MockServerCapabilities;
	readonly origin: string;
	readonly contentType: string | null;
	readonly disposition: string | null;
	readonly ifMatch: string | null;
	readonly recordScheduling: (fact: SchedulingFact) => void;
}

type ResourceRoute = Extract<Route, { kind: 'resource' }>;

export function handleAttachmentPost(
	route: Route,
	query: URLSearchParams,
	body: string,
	context: AttachmentContext,
): MockResponse {
	const action = query.get('action');
	if (!context.caps.managedAttachments || action === null) {
		return plain(405);
	}
	if (route.kind === 'absent-resource' || route.kind === 'unknown') {
		return plain(404);
	}
	if (route.kind !== 'resource') {
		return plain(405);
	}
	const refusal = checkIfMatch(route.resource.etag, context);
	if (refusal) {
		return refusal;
	}
	const managedId = query.get('managed-id');
	switch (action) {
		case 'attachment-add':
			return addAttachment(route, body, context);
		case 'attachment-update':
			return updateAttachment(route, managedId, body, context);
		case 'attachment-remove':
			return removeAttachment(route, managedId, context);
		default:
			return plain(405);
	}
}

/**
 * The bytes stored at an attachment URI. A server without the capability
 * has no such URI, so one is served only while the capability is on.
 */
export function handleAttachmentGet(
	attachment: AttachmentState,
	caps: MockServerCapabilities,
): MockResponse {
	if (!caps.managedAttachments) {
		return plain(404);
	}
	return plain(
		200,
		{
			'Content-Type': attachment.contentType,
			'Content-Disposition': `attachment; filename="${attachment.filename}"`,
		},
		attachment.body,
	);
}

function addAttachment(
	route: ResourceRoute,
	body: string,
	context: AttachmentContext,
): MockResponse {
	const attachment = context.state.addAttachment({
		owner: route.resource.href,
		filename: filenameOf(context.disposition),
		contentType: context.contentType ?? DEFAULT_CONTENT_TYPE,
		body,
	});
	const etag = store(
		route,
		withProperty(
			route.resource.ics,
			attachLine(attachment, context.origin),
		),
		context,
	);
	return plain(201, {
		ETag: etag,
		[MANAGED_ID_HEADER]: attachment.managedId,
	});
}

function updateAttachment(
	route: ResourceRoute,
	managedId: string | null,
	body: string,
	context: AttachmentContext,
): MockResponse {
	const attachment = attachedTo(route, managedId, context);
	if (!attachment) {
		return preconditionError(409, CALDAV_NS, 'valid-managed-id');
	}
	attachment.body = body;
	const rewritten = withProperty(
		withoutProperty(route.resource.ics, attachment.managedId),
		attachLine(attachment, context.origin),
	);
	const etag = store(route, rewritten, context);
	return plain(200, {
		ETag: etag,
		[MANAGED_ID_HEADER]: attachment.managedId,
	});
}

function removeAttachment(
	route: ResourceRoute,
	managedId: string | null,
	context: AttachmentContext,
): MockResponse {
	const attachment = attachedTo(route, managedId, context);
	if (!attachment) {
		return preconditionError(409, CALDAV_NS, 'valid-managed-id');
	}
	const etag = store(
		route,
		withoutProperty(route.resource.ics, attachment.managedId),
		context,
	);
	context.state.removeAttachment(attachment.managedId);
	return plain(204, { ETag: etag });
}

/**
 * The attachment this identifier names, and only where the resource
 * actually carries it: an identifier minted for some other resource is as
 * invalid here as one the server never minted.
 */
function attachedTo(
	route: ResourceRoute,
	managedId: string | null,
	context: AttachmentContext,
): AttachmentState | null {
	if (managedId === null) {
		return null;
	}
	const attachment = context.state.attachments.get(managedId);
	if (!attachment || !carriesAttachment(route.resource.ics, managedId)) {
		return null;
	}
	return attachment;
}

/** Writes the rewritten resource, which is a write like any other. */
function store(
	route: ResourceRoute,
	ics: string,
	context: AttachmentContext,
): string {
	const before = readIcs(route.resource.ics).attendees;
	const etag = context.state.write(
		route.collection,
		route.resource.name,
		ics,
	);
	context.recordScheduling({
		method: 'POST',
		href: route.resource.href,
		attendeesBefore: before,
		attendeesAfter: readIcs(ics).attendees,
	});
	return etag;
}

function attachLine(attachment: AttachmentState, origin: string): string {
	const size = octetLength(attachment.body);
	return [
		'ATTACH',
		`;MANAGED-ID=${attachment.managedId}`,
		`;FMTTYPE=${attachment.contentType}`,
		`;SIZE=${String(size)}`,
		`;FILENAME="${attachment.filename}"`,
		`:${origin}${attachment.href}`,
	].join('');
}

/** Places a property last in the component the resource is about. */
function withProperty(ics: string, property: string): string {
	const lines = icsLineParts(ics);
	const component = readIcs(ics).component;
	const end =
		component === null
			? -1
			: lines.findIndex(
					(line) => line.toUpperCase().trim() === `END:${component}`,
				);
	lines.splice(end === -1 ? lines.length : end, 0, property);
	return lines.join(endingOf(ics));
}

function withoutProperty(ics: string, managedId: string): string {
	const kept: string[] = [];
	let dropping = false;
	for (const line of icsLineParts(ics)) {
		if (dropping && isFoldedContinuation(line)) {
			continue;
		}
		dropping = namesAttachment(line, managedId);
		if (!dropping) {
			kept.push(line);
		}
	}
	return kept.join(endingOf(ics));
}

function carriesAttachment(ics: string, managedId: string): boolean {
	return icsLineParts(ics).some((line) => namesAttachment(line, managedId));
}

/**
 * Whether this line is the ATTACH property for the identifier. The
 * delimiter is part of the comparison, so one identifier is not read as
 * the prefix of a longer one.
 */
function namesAttachment(line: string, managedId: string): boolean {
	const upper = line.toUpperCase();
	if (!upper.startsWith('ATTACH;')) {
		return false;
	}
	const parameter = `MANAGED-ID=${managedId.toUpperCase()}`;
	return (
		upper.includes(`${parameter};`) ||
		upper.includes(`${parameter}:`) ||
		upper.endsWith(parameter)
	);
}

/**
 * The ending a rewritten resource is written back with: CRLF where the
 * text uses one anywhere, and LF otherwise. A resource whose breaks
 * disagree is normalized onto one of them by the rewrite.
 */
function endingOf(ics: string): string {
	return ics.includes('\r\n') ? '\r\n' : '\n';
}

function filenameOf(disposition: string | null): string {
	const quoted = /filename="([^"]*)"/i.exec(disposition ?? '');
	if (quoted?.[1] !== undefined && quoted[1] !== '') {
		return quoted[1];
	}
	const bare = /filename=([^;]+)/i.exec(disposition ?? '');
	return bare?.[1]?.trim() ?? DEFAULT_FILENAME;
}
