/**
 * Changes data between the shapes of the transport port and the shapes of
 * the server. The port gives a URL, headers, and a body that is text or
 * octets. The port expects back a status, headers, and both the text and
 * the octets of the same response.
 *
 * The octets that this module counts are the octets of an HTTP body, and
 * not the octets of an iCalendar line. A multistatus document and an
 * error page also pass through this module. Thus this module holds its
 * own encoder and its own decoder.
 */

import type { HttpResponse } from '../../../src/core/ports/transport';
import type { MockResponse } from './response';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type HeaderReader = (name: string) => string | null;

/**
 * Reads a header by name and ignores the letter case, because a client
 * can write a header name in any letter case.
 */
export function headerReader(
	headers: Readonly<Record<string, string>> | undefined,
): HeaderReader {
	const lowered = new Map<string, string>();
	for (const [key, value] of Object.entries(headers ?? {})) {
		lowered.set(key.toLowerCase(), value);
	}
	return (name) => lowered.get(name.toLowerCase()) ?? null;
}

/**
 * Gives the headers that a request carried, with the header names in
 * lower case. This function removes no header and hides no value. The
 * reason: tests assert on this log and sweeps search this log, and a
 * sweep cannot report a credential that the sweep cannot see. Therefore
 * the `Authorization` header is here in the same way as every other
 * header.
 *
 * A request can give its content type through the `contentType` member of
 * the port instead of a header. This function records that content type
 * as a header. If a request gives the member and the header, this
 * function keeps the value from the header, because a server reads the
 * header.
 */
export function headerEntries(
	headers: Readonly<Record<string, string>> | undefined,
	contentType: string | undefined,
): Readonly<Record<string, string>> {
	const lowered: Record<string, string> = {};
	if (contentType !== undefined) {
		lowered['content-type'] = contentType;
	}
	for (const [key, value] of Object.entries(headers ?? {})) {
		lowered[key.toLowerCase()] = value;
	}
	return lowered;
}

export function bodyText(body: string | ArrayBuffer | undefined): string {
	if (body === undefined) {
		return '';
	}
	return typeof body === 'string' ? body : decoder.decode(body);
}

/**
 * Gives the path of the request URL, or null when the URL names a
 * different server. The mock answers no request for a different server.
 */
export function pathOf(url: string, origin: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(url, origin);
	} catch {
		return null;
	}
	return parsed.origin === new URL(origin).origin ? parsed.pathname : null;
}

/**
 * Gives the query that the request carries. The query is empty when the
 * URL does not parse.
 */
export function queryOf(url: string, origin: string): URLSearchParams {
	try {
		return new URL(url, origin).searchParams;
	} catch {
		return new URLSearchParams();
	}
}

/**
 * Makes the response that the transport port receives. A response that
 * this function truncates keeps its status and its headers, because the
 * failure is in the body only. The cut can fall in the middle of a
 * character, and this result is part of the truncation.
 */
export function toHttpResponse(
	response: MockResponse,
	truncateAfter: number | null,
): HttpResponse {
	const encoded = encoder.encode(response.body);
	const kept =
		truncateAfter === null ? encoded : encoded.slice(0, truncateAfter);
	const buffer = new ArrayBuffer(kept.byteLength);
	new Uint8Array(buffer).set(kept);
	return {
		status: response.status,
		headers: response.headers,
		text: decoder.decode(kept),
		arrayBuffer: buffer,
	};
}
