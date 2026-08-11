/**
 * Translation between the transport port's shapes and the server's. The
 * port hands over a URL, headers, and a body that may be text or octets;
 * it expects back a status, headers, and both text and octets of the same
 * response.
 *
 * The octets counted here are an HTTP body's and not an iCalendar line's —
 * a multistatus and an error page cross this module too — so the encoder
 * and its decoder stay together here rather than coming from the module
 * that holds the iCalendar line arithmetic.
 */

import type { HttpResponse } from '../../../src/core/ports/transport';
import type { MockResponse } from './response';

export type HeaderReader = (name: string) => string | null;

/** Header names are case-insensitive; clients spell them as they please. */
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
 * The headers a request carried, keyed by their lowercased names. Nothing
 * is filtered out and nothing is redacted: the log exists to be asserted
 * against and swept, and a credential the sweeps cannot see is one they
 * cannot report. `Authorization` is therefore here like any other header,
 * and a request that states its content type through the port's own member
 * rather than a header is recorded as having sent the header.
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
	return typeof body === 'string' ? body : new TextDecoder().decode(body);
}

/** Null when the request names a different server, which answers nothing. */
export function pathOf(url: string, origin: string): string | null {
	let parsed: URL;
	try {
		parsed = new URL(url, origin);
	} catch {
		return null;
	}
	return parsed.origin === new URL(origin).origin ? parsed.pathname : null;
}

/** The query the request carries; empty for a URL that will not parse. */
export function queryOf(url: string, origin: string): URLSearchParams {
	try {
		return new URL(url, origin).searchParams;
	} catch {
		return new URLSearchParams();
	}
}

/**
 * A truncated response keeps its status and headers: the failure is in the
 * body, and cutting octets mid-character is part of what it does.
 */
export function toHttpResponse(
	response: MockResponse,
	truncateAfter: number | null,
): HttpResponse {
	const encoded = new TextEncoder().encode(response.body);
	const kept =
		truncateAfter === null ? encoded : encoded.slice(0, truncateAfter);
	const buffer = new ArrayBuffer(kept.byteLength);
	new Uint8Array(buffer).set(kept);
	return {
		status: response.status,
		headers: response.headers,
		text: new TextDecoder().decode(kept),
		arrayBuffer: buffer,
	};
}
