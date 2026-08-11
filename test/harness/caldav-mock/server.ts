/**
 * The mock CalDAV server. It implements the transport port directly: the
 * engine under test receives it where the Obsidian adapter would go, and
 * no socket, no `requestUrl`, and no network stack sit in between.
 *
 * Everything the server answers is a function of its seeded state, its
 * capability configuration, and the requests it has received. Identifiers
 * come from counters, so two runs of the same sequence produce the same
 * bytes.
 *
 * The model accessors set a scene or check one without going through a
 * request. None of them touches the request log or the scheduling record:
 * state changed that way stands for another client's work, not for a write
 * by the engine under test.
 */

import type {
	HttpRequest,
	HttpResponse,
	HttpTransport,
} from '../../../src/core/ports/transport';
import {
	DEFAULT_CAPABILITIES,
	withCapabilities,
	type FaultInjection,
	type MockServerCapabilities,
} from './capabilities';
import { attachmentBody, handleAttachmentPost } from './attachments';
import {
	bodyText,
	headerReader,
	pathOf,
	queryOf,
	toHttpResponse,
	type HeaderReader,
} from './http';
import {
	RequestLog,
	SchedulingRecord,
	type SchedulingFact,
} from './observation';
import { handlePropfind } from './propfind';
import type { PropContext } from './props';
import { handleReport, presentedSyncToken, reportKindOf } from './report';
import { plain, type MockResponse } from './response';
import { handleDelete, handleGet, handlePut } from './resource';
import {
	membersOf,
	PRINCIPAL_ROOT_PATH,
	ServerState,
	WELL_KNOWN_PATH,
	type AccountSeed,
} from './state';
import { ABSENT_BODY, documentOf, parseBody, type XmlBody } from './xml';

export interface MockServerConfig {
	readonly accounts: readonly AccountSeed[];
	readonly origin?: string;
	readonly capabilities?: Partial<MockServerCapabilities>;
}

const DEFAULT_ORIGIN = 'https://caldav.davenport.test';
const XML_METHODS = new Set(['PROPFIND', 'REPORT']);

/** A request the server has taken apart and entered in the log. */
interface Incoming {
	readonly method: string;
	readonly path: string;
	readonly headers: HeaderReader;
	readonly body: string;
	readonly parsed: XmlBody;
	readonly query: URLSearchParams;
	readonly contentType: string | null;
	/** Its place in the request log, which a write points back at. */
	readonly index: number;
}

/** A failure inside the mock reads as a server failure, which is a 500. */
function serverFailure(error: unknown): MockResponse {
	return plain(
		500,
		{ 'Content-Type': 'text/plain; charset=utf-8' },
		`mock server failed: ${String(error)}`,
	);
}

export class MockCalDavServer implements HttpTransport {
	readonly log = new RequestLog();
	readonly scheduling = new SchedulingRecord();
	readonly origin: string;

	private readonly state: ServerState;
	private config: MockServerCapabilities;
	private faultUses = new Map<number, number>();

	constructor(config: MockServerConfig) {
		this.origin = config.origin ?? DEFAULT_ORIGIN;
		this.state = new ServerState(config.accounts);
		this.config = withCapabilities(
			DEFAULT_CAPABILITIES,
			config.capabilities ?? {},
		);
	}

	get capabilities(): MockServerCapabilities {
		return this.config;
	}

	/** Changes the server mid-run, for tokens that stop being accepted. */
	configure(patch: Partial<MockServerCapabilities>): void {
		this.config = withCapabilities(this.config, patch);
		if ('faults' in patch) {
			this.faultUses = new Map();
		}
	}

	request(req: HttpRequest): Promise<HttpResponse> {
		return Promise.resolve(this.handle(req));
	}

	authenticateAs(account: string): void {
		this.state.authenticateAs(account);
	}

	seedResource(
		account: string,
		collection: string,
		name: string,
		ics: string,
	): string {
		return this.state.write(
			this.state.collection(account, collection),
			name,
			ics,
		);
	}

	removeResource(account: string, collection: string, name: string): boolean {
		return this.state.remove(
			this.state.collection(account, collection),
			name,
		);
	}

	resourceIcs(
		account: string,
		collection: string,
		name: string,
	): string | null {
		return (
			this.state.collection(account, collection).resources.get(name)
				?.ics ?? null
		);
	}

	resourceEtag(
		account: string,
		collection: string,
		name: string,
	): string | null {
		return (
			this.state.collection(account, collection).resources.get(name)
				?.etag ?? null
		);
	}

	resourceNames(account: string, collection: string): readonly string[] {
		return membersOf(this.state.collection(account, collection)).map(
			(resource) => resource.name,
		);
	}

	collectionCtag(account: string, collection: string): string | null {
		return this.state.ctagOf(
			this.state.collection(account, collection),
			this.config,
		);
	}

	syncToken(account: string, collection: string): string {
		return this.state.syncTokenOf(
			this.state.collection(account, collection),
		);
	}

	url(path: string): string {
		return `${this.origin}${path}`;
	}

	get wellKnownUrl(): string {
		return this.url(WELL_KNOWN_PATH);
	}

	get principalRootUrl(): string {
		return this.url(PRINCIPAL_ROOT_PATH);
	}

	principalUrl(account: string): string {
		return this.url(this.state.account(account).principalHref);
	}

	homeUrl(account: string): string {
		return this.url(this.state.account(account).homeHref);
	}

	collectionUrl(account: string, collection: string): string {
		return this.url(this.state.collection(account, collection).href);
	}

	resourceUrl(account: string, collection: string, name: string): string {
		return `${this.collectionUrl(account, collection)}${name}`;
	}

	private handle(req: HttpRequest): HttpResponse {
		try {
			return this.answer(req);
		} catch (error) {
			// The port rejects only for transport failure, so a fault in the
			// mock's own code has to come back as a response like any other.
			return toHttpResponse(serverFailure(error), null);
		}
	}

	private answer(req: HttpRequest): HttpResponse {
		const method = (req.method ?? 'GET').toUpperCase();
		const headers = headerReader(req.headers);
		const body = bodyText(req.body);
		const path = pathOf(req.url, this.origin);
		const parsed =
			path !== null && XML_METHODS.has(method)
				? parseBody(body)
				: ABSENT_BODY;
		const document = documentOf(parsed);

		const index = this.log.begin({
			method,
			url: req.url,
			path: path ?? req.url,
			depth: headers('depth'),
			ifMatch: headers('if-match'),
			ifNoneMatch: headers('if-none-match'),
			report: reportKindOf(document),
			syncToken: presentedSyncToken(document),
		});

		const answered =
			path === null
				? { response: plain(404), truncateAfter: null }
				: this.serve({
						method,
						path,
						headers,
						body,
						parsed,
						query: queryOf(req.url, this.origin),
						contentType:
							headers('content-type') ?? req.contentType ?? null,
						index,
					});
		this.log.complete(index, answered.response.status);
		return toHttpResponse(answered.response, answered.truncateAfter);
	}

	/**
	 * Faults are matched only once the request is one this server would
	 * have handled, so a request for another origin and a redirected hop
	 * leave a fault's budget alone.
	 */
	private serve(incoming: Incoming): {
		response: MockResponse;
		truncateAfter: number | null;
	} {
		const redirect = this.config.redirects[incoming.path];
		if (redirect) {
			return {
				response: plain(redirect.status ?? 301, {
					Location: this.url(redirect.location),
				}),
				truncateAfter: null,
			};
		}
		const fault = this.matchFault(incoming.method, incoming.path);
		if (fault?.kind === 'status') {
			return {
				response: plain(fault.status ?? 503),
				truncateAfter: null,
			};
		}
		let response: MockResponse;
		try {
			response = this.route(incoming);
		} catch (error) {
			response = serverFailure(error);
		}
		return {
			response,
			truncateAfter:
				fault?.kind === 'truncate' ? (fault.truncateAfter ?? 0) : null,
		};
	}

	private route(incoming: Incoming): MockResponse {
		const { method, headers, body, parsed } = incoming;
		const route = this.state.resolve(incoming.path);
		const context: PropContext = { state: this.state, caps: this.config };
		const writeContext = {
			state: this.state,
			caps: this.config,
			ifMatch: headers('if-match'),
			ifNoneMatch: headers('if-none-match'),
			recordScheduling: (fact: SchedulingFact) => {
				this.scheduling.record(incoming.index, fact);
			},
		};

		if (route.kind === 'well-known') {
			// Nothing is served here: a well-known URI either redirects to
			// the principal or is not there at all.
			return plain(404);
		}
		if (method === 'OPTIONS') {
			return route.kind === 'unknown'
				? plain(404)
				: plain(200, {
						DAV: this.davHeader(),
						Allow: this.allowHeader(),
					});
		}
		switch (method) {
			case 'PROPFIND':
				return handlePropfind(
					route,
					headers('depth'),
					parsed,
					context,
					this.state.currentAccount,
				);
			case 'REPORT':
				return handleReport(route, parsed, context);
			case 'GET':
				return route.kind === 'attachment'
					? attachmentBody(route.attachment)
					: handleGet(route, this.state, this.config);
			case 'PUT':
				return handlePut(route, body, writeContext);
			case 'DELETE':
				return handleDelete(route, writeContext);
			case 'POST':
				return handleAttachmentPost(route, incoming.query, body, {
					...writeContext,
					origin: this.origin,
					contentType: incoming.contentType,
					disposition: headers('content-disposition'),
				});
			default:
				return plain(405);
		}
	}

	private davHeader(): string {
		const tokens = ['1', '3', 'calendar-access'];
		if (this.config.managedAttachments) {
			tokens.push('calendar-managed-attachments');
		}
		return tokens.join(', ');
	}

	private allowHeader(): string {
		const methods = [
			'OPTIONS',
			'GET',
			'PUT',
			'DELETE',
			'PROPFIND',
			'REPORT',
		];
		if (this.config.managedAttachments) {
			methods.push('POST');
		}
		return methods.join(', ');
	}

	private matchFault(method: string, path: string): FaultInjection | null {
		for (const [position, fault] of this.config.faults.entries()) {
			if (fault.method !== undefined && fault.method !== method) {
				continue;
			}
			if (
				fault.pathContains !== undefined &&
				!path.includes(fault.pathContains)
			) {
				continue;
			}
			const used = this.faultUses.get(position) ?? 0;
			if (fault.times !== undefined && used >= fault.times) {
				continue;
			}
			this.faultUses.set(position, used + 1);
			return fault;
		}
		return null;
	}
}
