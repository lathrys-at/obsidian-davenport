/**
 * Managed attachments, limited to the part that a test suite can use. A
 * POST to a calendar object resource adds, replaces, or removes an
 * attachment. The server keeps the bytes, rewrites the ATTACH property of
 * the resource, and serves the attachment again at the URI that the
 * server made. Thus a test suite sees the capability in the resource, and
 * not only in what the server advertises.
 *
 * Three rules control the life of an attachment. A test suite that
 * asserts on the attachment path needs these three rules. Therefore this
 * comment gives the rules, and the suite does not have to find them by
 * experiment.
 *
 * First rule: an attachment POST rewrites the resource. Thus the POST is
 * a write, as a PUT is a write, and the POST obeys the same `If-Match`
 * gate where the run enforces one. A refused POST keeps no bytes,
 * rewrites nothing, and adds no entry to the scheduling record, because
 * nothing left the server.
 *
 * Second rule: an attachment belongs to the resource that the server made
 * the attachment for, and the attachment does not stay after that
 * resource. The removal of that resource can come from a request, or from
 * a change that does not go through a request. In both cases the server
 * also removes the attachments of that resource, and the URIs of those
 * attachments answer 404 from that time. A write that only drops the
 * ATTACH property does not remove the attachment: the bytes stay
 * available, as they stay available on a server that collects unused
 * bytes on its own schedule.
 *
 * Third rule: when the capability is off, the server behaves as a server
 * that does not have the capability. The server keeps the store, but no
 * request reaches the store. Thus a stored attachment answers 404 for as
 * long as the capability is off, and the same attachment is available
 * again when the capability comes on. The switch deletes nothing. Thus a
 * test suite can turn the capability off during a run, and the stored
 * data stays the same.
 *
 * Limits: the server applies no size limit and no count limit, the server
 * gives no access control per attendee, and an attachment belongs to the
 * full resource and not to one recurrence instance.
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
 * Serves the bytes that the server keeps at an attachment URI. A server
 * without the capability has no attachment URI. Thus the server serves
 * these bytes only while the capability is on.
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
 * Gives the attachment that this identifier names, but only when the
 * resource carries that attachment. An identifier that the server made
 * for a different resource is invalid here. An identifier that the server
 * never made is invalid here in the same way.
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

/**
 * Writes the rewritten resource. The server treats this write as it
 * treats every other write.
 */
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

/** Adds a property as the last line of the resource's main component. */
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
 * Tells whether this line is the ATTACH property for the identifier. The
 * comparison includes the delimiter character. Thus the server does not
 * read one identifier as the first part of a longer identifier.
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
 * Gives the line ending for a resource that the server writes again. The
 * ending is CRLF when the text uses CRLF at any place, and LF in all
 * other cases. If a resource mixes the two endings, the rewrite puts the
 * one ending from this function on all of the lines.
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
