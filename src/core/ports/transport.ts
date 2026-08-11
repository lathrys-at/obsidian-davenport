/**
 * HTTP transport port. Every network call flows through here, and the
 * Obsidian adapter backs it with `requestUrl` (§2.2): CalDAV servers send
 * no CORS headers, so any other transport breaks on mobile. The test
 * harness poisons global `fetch` to enforce this seam (IV-13).
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
	/** Resolves for non-2xx statuses; rejects only on transport failure. */
	request(req: HttpRequest): Promise<HttpResponse>;
}
