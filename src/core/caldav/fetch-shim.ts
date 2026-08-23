/**
 * The bridge from the transport port to the shape that `tsdav` calls.
 *
 * `tsdav` takes a `fetch` parameter at every entry point, and the plugin
 * gives it this bridge. Thus the CalDAV library reaches the network only
 * through the port, and the plugin makes every request with `requestUrl`.
 *
 * `tsdav` reads seven members of the answer: `ok`, `status`, `statusText`,
 * `url`, `headers.get(name)`, `text()`, and `json()`. This module builds an
 * object with those seven members and no other member. Two of them need a
 * word here.
 *
 * `url` carries the address of the request. A response object that a
 * program builds carries an empty address, and the service discovery of
 * `tsdav` reads the address of the answer. This module writes the address
 * of the request into that member.
 *
 * `statusText` is the reason phrase, and it holds words that the server
 * wrote. `requestUrl` does not report it, so the port does not carry it,
 * and this member is therefore always empty. The engine states each result
 * in words of its own, from the status number.
 *
 * The headers of the answer stand in a `Headers` object. A reader of a
 * header names that header in any letter case, and `Headers` answers each
 * of those spellings. A header name that the platform refuses stays out of
 * the object, and the rest of the answer still arrives.
 *
 * The port expresses an address, a method, a set of headers, and a body of
 * text. It expresses no other field of a request. This module therefore
 * passes over every other field, and `PASSED_OVER_FIELDS` names them. The
 * field `redirect` is one of them: the service discovery of `tsdav` asks
 * for `redirect: "manual"`, and the plugin cannot ask the platform for
 * that behavior. Where the platform follows a redirect, the discovery sees
 * no redirect and falls back to the candidate addresses of the server.
 *
 * Two shapes of a call are outside the port, and each of them throws:
 * a request object in the place of an address, and a body that is not
 * text. No call of the plugin makes either shape.
 */

import type { propfind } from 'tsdav';
import type { HttpRequest, HttpTransport } from '../ports/transport';

/**
 * The type of the `fetch` parameter of `tsdav`. The type comes from the
 * library, so a change of the library signature reaches this file.
 */
export type CalDavFetch = NonNullable<Parameters<typeof propfind>[0]['fetch']>;

/**
 * The fields of a request that the transport port cannot express. A call
 * that states one of these fields still goes out, and the field has no
 * effect.
 */
export const PASSED_OVER_FIELDS: readonly string[] = [
	'cache',
	'credentials',
	'integrity',
	'keepalive',
	'mode',
	'redirect',
	'referrer',
	'referrerPolicy',
	'signal',
];

/** What this module gives `tsdav` in the place of a fetch answer. */
export interface CalDavAnswer {
	readonly ok: boolean;
	readonly status: number;
	readonly statusText: string;
	readonly url: string;
	readonly headers: Headers;
	text(): Promise<string>;
	json(): Promise<unknown>;
}

/** Builds the callable that `tsdav` uses in the place of fetch. */
export function calDavFetch(transport: HttpTransport): CalDavFetch {
	const call = async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<CalDavAnswer> => {
		const url = addressOf(input);
		const answer = await transport.request(requestOf(url, init));
		return {
			ok: answer.status >= 200 && answer.status < 300,
			status: answer.status,
			statusText: '',
			url,
			headers: headersOf(answer.headers),
			text: () => Promise.resolve(answer.text),
			// A body that is not JSON fails the read. The read happens
			// inside the promise, so the failure arrives as a rejection, as
			// it does from the platform.
			json: () =>
				Promise.resolve().then(
					() => JSON.parse(answer.text) as unknown,
				),
		};
	};
	// The library declares the parameter as the fetch function of the
	// platform. This module answers with the members that the library
	// reads, and with no other member, so the compiler cannot see the two
	// types as one.
	return call as unknown as CalDavFetch;
}

/** The request of the port that one call becomes. */
function requestOf(url: string, init: RequestInit | undefined): HttpRequest {
	const body = bodyOf(init?.body);
	return {
		url,
		method: (init?.method ?? 'GET').toUpperCase(),
		headers: requestHeaders(init?.headers),
		...(body === null ? {} : { body }),
	};
}

/** The address that a call names. */
function addressOf(input: RequestInfo | URL): string {
	if (typeof input === 'string') {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	throw new TypeError(
		'the CalDAV transport takes an address and not a request object',
	);
}

/** The body of a call, or null where the call carries none. */
function bodyOf(body: BodyInit | null | undefined): string | null {
	if (body === null || body === undefined) {
		return null;
	}
	if (typeof body === 'string') {
		return body;
	}
	throw new TypeError('the CalDAV transport takes a body of text alone');
}

/** The headers of a call, with each name in lower case. */
function requestHeaders(
	init: HeadersInit | undefined,
): Readonly<Record<string, string>> {
	const headers: Record<string, string> = {};
	new Headers(init).forEach((value, name) => {
		headers[name] = value;
	});
	return headers;
}

/**
 * The headers of the answer, as an object that answers a name in any
 * letter case. A name that the platform refuses stays out.
 */
function headersOf(source: Readonly<Record<string, string>>): Headers {
	const headers = new Headers();
	for (const [name, value] of Object.entries(source)) {
		try {
			headers.set(name, value);
		} catch {
			continue;
		}
	}
	return headers;
}
