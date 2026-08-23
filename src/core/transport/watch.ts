/**
 * A transport that remembers the status of the last answer.
 *
 * Two callers need that status. The multiget report needs the status of
 * the HTTP envelope, and that status is a fact of the transport and not of
 * the document that the CalDAV library parsed. The connection test needs
 * the status of the last request of a chain, so that it states what the
 * server answered last and not what a probe answered first.
 *
 * The class changes no request and no answer. It keeps the contract of the
 * port: every status resolves, and only a failure of the transport
 * rejects. A request that fails leaves the status of the answer before it.
 */

import type {
	HttpRequest,
	HttpResponse,
	HttpTransport,
} from '../ports/transport';

export interface WatchedTransport {
	/** The transport that a caller uses in the place of the one it gave. */
	readonly transport: HttpTransport;
	/** The status of the last answer, or null where no answer arrived. */
	lastStatus(): number | null;
}

/** Builds a transport that remembers the status of the last answer. */
export function watchStatus(inner: HttpTransport): WatchedTransport {
	let last: number | null = null;
	return {
		transport: {
			async request(req: HttpRequest): Promise<HttpResponse> {
				const answer = await inner.request(req);
				last = answer.status;
				return answer;
			},
		},
		lastStatus: () => last,
	};
}
