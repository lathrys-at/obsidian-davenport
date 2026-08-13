/**
 * The HTTP transport port. Every network call of the plugin goes through
 * this port. The Obsidian adapter implements the port with `requestUrl`.
 * CalDAV servers send no CORS headers, so a transport that does not use
 * `requestUrl` fails on mobile. The test harness replaces the global `fetch`
 * function with a function that throws. A call that goes around this port
 * therefore fails at once.
 */

export interface HttpRequest {
	readonly url: string;
	readonly method?: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: string | ArrayBuffer;
	readonly contentType?: string;
}

export interface HttpResponse {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly text: string;
	readonly arrayBuffer: ArrayBuffer;
}

export interface HttpTransport {
	/**
	 * Resolves for every status, including a status that is not 2xx. Rejects
	 * only when the transport fails.
	 */
	request(req: HttpRequest): Promise<HttpResponse>;
}
