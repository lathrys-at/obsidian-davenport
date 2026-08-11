/**
 * Translation between the transport port's shapes and the server's. The
 * port hands over a URL, headers, and a body that may be text or octets;
 * it expects back a status, headers, and both text and octets of the same
 * response.
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
