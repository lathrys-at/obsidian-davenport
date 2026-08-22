/**
 * The HTTP transport port, over the `requestUrl` function of Obsidian.
 *
 * Every network call of the plugin goes through this adapter. CalDAV
 * servers send no CORS headers, so a call that uses the fetch function of
 * the browser fails on a phone. The `requestUrl` function of Obsidian
 * makes the request outside the browser and reaches those servers.
 *
 * The call states `throw: false`. Without that value, `requestUrl` throws
 * for a status of 400 and above. The port states the other contract: a
 * request resolves for every status, and it rejects only when the
 * transport fails. The engine reads the status and decides. A refusal of
 * the server is data, and not an exception.
 *
 * The adapter reads four fields of the answer: the status, the headers,
 * the text, and the octets. It never reads the `json` member, because
 * that member parses the body and throws for a body that is not JSON.
 * The engine parses each body itself.
 *
 * The answer of `requestUrl` carries no reason phrase and no final
 * address after a redirect. The port therefore carries neither.
 *
 * The module takes the platform function as a parameter, and it names no
 * module of the platform. The entry point of the plugin gives it the
 * `requestUrl` function of Obsidian.
 */

import type {
	HttpRequest,
	HttpResponse,
	HttpTransport,
} from '../core/ports/transport';

/** The request that this adapter gives to the platform. */
export interface RequestUrlCall {
	url: string;
	method?: string;
	contentType?: string;
	body?: string | ArrayBuffer;
	headers?: Record<string, string>;
	/** False keeps a status of 400 and above out of the rejection path. */
	throw?: boolean;
}

/** The part of the answer of the platform that this adapter reads. */
export interface RequestUrlAnswer {
	status: number;
	headers: Record<string, string>;
	arrayBuffer: ArrayBuffer;
	text: string;
}

/**
 * The part of the platform that this adapter uses. The `requestUrl`
 * function of Obsidian satisfies this type.
 */
export type RequestUrlHost = (
	call: RequestUrlCall,
) => Promise<RequestUrlAnswer>;

/** The transport that makes each request through one host. */
export function createHttpTransport(host: RequestUrlHost): HttpTransport {
	return {
		async request(req: HttpRequest): Promise<HttpResponse> {
			const answer = await host(callOf(req));
			return {
				status: answer.status,
				headers: { ...answer.headers },
				text: answer.text,
				arrayBuffer: answer.arrayBuffer,
			};
		},
	};
}

/**
 * The call that one request of the port becomes. The function states each
 * optional field only where the request holds that field, because the
 * platform reads an absent field and a field of the value `undefined`
 * differently.
 */
function callOf(req: HttpRequest): RequestUrlCall {
	return {
		url: req.url,
		throw: false,
		...(req.method === undefined ? {} : { method: req.method }),
		...(req.headers === undefined ? {} : { headers: { ...req.headers } }),
		...(req.body === undefined ? {} : { body: req.body }),
		...(req.contentType === undefined
			? {}
			: { contentType: req.contentType }),
	};
}
