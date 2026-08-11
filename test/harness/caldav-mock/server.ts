/**
 * The mock CalDAV server. It implements the transport port directly: the
 * engine under test receives it where the Obsidian adapter would go, and
 * no socket, no `requestUrl`, and no network stack sit in between.
 *
 * Everything the server answers is a function of its seeded state, its
 * capability configuration, and the requests it has received. Identifiers
 * come from counters, so two runs of the same sequence produce the same
 * bytes.
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
import {
	bodyText,
	headerReader,
	pathOf,
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
	PRINCIPAL_ROOT_PATH,
	ServerState,
	WELL_KNOWN_PATH,
	type AccountSeed,
} from './state';
import { parseXml, type XmlDocument } from './xml';

export interface MockServerConfig {
	readonly accounts: readonly AccountSeed[];
	readonly origin?: string;
	readonly capabilities?: Partial<MockServerCapabilities>;
}

const DEFAULT_ORIGIN = 'https://caldav.davenport.test';
const XML_METHODS = new Set(['PROPFIND', 'REPORT']);

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

	// Model access for setting a scene or checking one. None of it touches
	// the request log or the scheduling record: state changed this way
	// stands for another client's work, not for a write by the engine.

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
		return Array.from(
			this.state.collection(account, collection).resources.keys(),
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

	// URL helpers, so tests and engine wiring name the same places.

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
		const method = (req.method ?? 'GET').toUpperCase();
		const headers = headerReader(req.headers);
		const body = bodyText(req.body);
		const path = pathOf(req.url, this.origin);
		const document =
			path !== null && XML_METHODS.has(method) ? parseXml(body) : null;

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

		const fault = this.matchFault(method, path ?? req.url);
		const response =
			fault?.kind === 'status'
				? plain(fault.status ?? 503)
				: this.route(method, path, headers, body, document, index);

		this.log.complete(index, response.status);
		return toHttpResponse(
			response,
			fault?.kind === 'truncate' ? (fault.truncateAfter ?? 0) : null,
		);
	}

	private route(
		method: string,
		path: string | null,
		headers: HeaderReader,
		body: string,
		document: XmlDocument | null,
		requestIndex: number,
	): MockResponse {
		if (path === null) {
			return plain(404);
		}
		const redirect = this.config.redirects[path];
		if (redirect) {
			return plain(redirect.status ?? 301, {
				Location: this.url(redirect.location),
			});
		}
		const route = this.state.resolve(path);
		const context: PropContext = { state: this.state, caps: this.config };

		if (method === 'OPTIONS') {
			return plain(200, {
				DAV: this.davHeader(),
				Allow: 'OPTIONS, GET, PUT, DELETE, PROPFIND, REPORT',
			});
		}
		if (route.kind === 'well-known') {
			// Nothing is served here: a well-known URI either redirects to
			// the principal or is not there at all.
			return plain(404);
		}
		switch (method) {
			case 'PROPFIND':
				return handlePropfind(
					route,
					headers('depth'),
					document,
					context,
					this.state.currentAccount,
				);
			case 'REPORT':
				return handleReport(route, document, context);
			case 'GET':
				return handleGet(route, this.state, this.config);
			case 'PUT':
				return handlePut(route, body, {
					state: this.state,
					caps: this.config,
					ifMatch: headers('if-match'),
					ifNoneMatch: headers('if-none-match'),
					recordScheduling: (fact: SchedulingFact) => {
						this.scheduling.record(requestIndex, fact);
					},
				});
			case 'DELETE':
				return handleDelete(route, {
					state: this.state,
					caps: this.config,
					ifMatch: headers('if-match'),
					ifNoneMatch: headers('if-none-match'),
					recordScheduling: (fact: SchedulingFact) => {
						this.scheduling.record(requestIndex, fact);
					},
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
