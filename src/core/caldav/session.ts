/**
 * The CalDAV protocol layer.
 *
 * The layer calls the per-function API of the library: one function for
 * one request. It does not use the client class of the library, and it
 * does not use the sync helper of the library. Those two hold a session
 * and a model of the sync state, and the engine of this plugin owns both.
 * A session here holds the transport, the address of the server, and the
 * headers that sign each request. It holds nothing that a request found.
 *
 * Every call gives the library the fetch bridge of this plugin. No call
 * leaves that parameter out. The library then reaches the network through
 * the transport port alone.
 *
 * A caller keeps the addresses that a discovery found and gives them back
 * on the next call. Each address that the caller gives takes one step out
 * of the discovery. A caller that holds all three addresses makes no
 * discovery request at all.
 *
 * A failure of a step leaves this layer as a `CalDavError`, which carries
 * the name of the step and no word of the library and no word of the
 * server.
 *
 * Two rules of this layer come from the same fact, and the fact is this:
 * one answer carries two kinds of status. The status of the HTTP envelope
 * says whether the request arrived. The status inside each response of the
 * document says what the server did with one resource.
 *
 * The first rule. Where the envelope states a failure, the layer refuses
 * the answer whole. The library reads a body that is not a multistatus as
 * one response of its own, and it writes the address of the request into
 * that response. A reader that took such a response for data would state
 * the collection itself as a resource that is gone, and a report that no
 * server answered would read as a collection with no calendar in it.
 *
 * The second rule. Where the envelope states success, the status inside a
 * response is an observation and never a failure. A response with status
 * 404 states that the server holds no resource at that address, and that
 * is the answer which confirms a deletion. The report gives an outcome for
 * each address, and one absent member refuses nothing.
 *
 * The layer builds the multiget report itself, and two functions of the
 * library are therefore not in use. The first fetches the objects of a
 * collection and drops every address that does not end in `.ics`; Google
 * states an address of another form. The second is the query wrapper of
 * the library, which reads the status of each response and refuses the
 * whole report where one response states a failure; that wrapper refuses
 * the answer which confirms a deletion.
 */

import {
	createAccount,
	davRequest,
	fetchCalendars,
	getDAVAttribute,
	syncCollection,
	DAVNamespace,
	DAVNamespaceShort,
} from 'tsdav';
import type { DAVAccount } from 'tsdav';
import type { HttpTransport } from '../ports/transport';
import { watchStatus } from '../transport/watch';
import type { RequestHeaders } from './credentials';
import { CalDavError } from './errors';
import { calDavFetch, type CalDavFetch } from './fetch-shim';
import type {
	CalDavCalendar,
	CalDavEndpoints,
	CollectionDelta,
	KnownEndpoints,
	ResourceReport,
} from './reading';
import {
	readCalendar,
	readDelta,
	readEndpoints,
	readOutcomes,
} from './reading';

/** The properties that a sync-collection report asks for. */
const CHANGE_PROPS = { 'd:getetag': {} };

/** The properties that a multiget report asks for. */
const OBJECT_PROPS = { 'd:getetag': {}, 'c:calendar-data': {} };

/** The depth of a sync-collection report over the members of a collection. */
const SYNC_LEVEL = 1;

/** The depth of a multiget report over the members of a collection. */
const MEMBER_DEPTH = '1';

/** True where a status states that the server answered the request. */
function answered(status: number | null): status is number {
	return status !== null && status >= 200 && status < 300;
}

export interface CalDavSessionParts {
	readonly transport: HttpTransport;
	/** The address that the account states for its server. */
	readonly serverUrl: string;
	/** The headers that sign each request of the account. */
	readonly headers: RequestHeaders;
}

/** One call of the library, with the status of the last answer it read. */
interface Attempt<T> {
	readonly answer: T;
	/** The status of the last answer, or null where no answer arrived. */
	readonly status: number | null;
}

export class CalDavSession {
	private readonly transport: HttpTransport;
	private readonly serverUrl: string;
	private readonly headers: RequestHeaders;
	private readonly fetch: CalDavFetch;

	constructor(parts: CalDavSessionParts) {
		this.transport = parts.transport;
		this.serverUrl = parts.serverUrl;
		this.headers = parts.headers;
		this.fetch = calDavFetch(parts.transport);
	}

	/**
	 * The three addresses of the calendar service. The call makes a request
	 * for each address that the caller does not give.
	 *
	 * This step reads no status of an envelope. The discovery probes an
	 * address that most servers do not serve, and a failure of a probe is
	 * one of the steps of the discovery.
	 */
	async discover(known: KnownEndpoints = {}): Promise<CalDavEndpoints> {
		const found = await this.call('discovery', () =>
			createAccount({
				account: this.account(known),
				headers: { ...this.headers },
				loadCollections: false,
				loadObjects: false,
				fetch: this.fetch,
			}),
		);
		return readEndpoints(found);
	}

	/** The calendar collections of the account. */
	async calendars(
		endpoints: CalDavEndpoints,
	): Promise<readonly CalDavCalendar[]> {
		const step = 'calendar list';
		const attempt = await this.attempt(step, (fetch) =>
			fetchCalendars({
				account: this.account(endpoints),
				headers: { ...this.headers },
				fetch,
			}),
		);
		this.refuseFailure(step, attempt.status);
		return attempt.answer.map(readCalendar);
	}

	/**
	 * The resources of a collection that changed since a token. A caller
	 * that holds no token gives null, and the answer then names every
	 * member of the collection.
	 */
	async changes(
		calendarUrl: string,
		syncToken: string | null,
	): Promise<CollectionDelta> {
		const step = 'change report';
		const attempt = await this.attempt(step, (fetch) =>
			syncCollection({
				url: calendarUrl,
				props: CHANGE_PROPS,
				syncLevel: SYNC_LEVEL,
				syncToken: syncToken ?? '',
				headers: { ...this.headers },
				fetch,
			}),
		);
		this.refuseFailure(step, attempt.status);
		return readDelta(attempt.answer);
	}

	/**
	 * What the server holds at each of the named addresses.
	 *
	 * One call sends one report, whatever the number of addresses. Where
	 * the server answered the report, the outcome of each address states
	 * the resource with its text, or the absence of a resource, or another
	 * status. Where the server refused the report itself, the answer
	 * carries that status and no outcome. Only a failure of the transport
	 * rejects.
	 */
	async resources(
		calendarUrl: string,
		hrefs: readonly string[],
	): Promise<ResourceReport> {
		if (hrefs.length === 0) {
			return { ok: true, outcomes: [] };
		}
		const attempt = await this.attempt('calendar object report', (fetch) =>
			davRequest({
				url: calendarUrl,
				init: multigetRequest(hrefs, this.headers),
				fetch,
			}),
		);
		return answered(attempt.status)
			? { ok: true, outcomes: readOutcomes(attempt.answer) }
			: { ok: false, status: attempt.status };
	}

	/**
	 * Runs one call of the library over a transport that remembers the
	 * status of the last answer. The caller reads that status to tell a
	 * failure of the whole request from the answer of one resource.
	 */
	private async attempt<T>(
		step: string,
		body: (fetch: CalDavFetch) => Promise<T>,
	): Promise<Attempt<T>> {
		const watched = watchStatus(this.transport);
		const answer = await this.call(step, () =>
			body(calDavFetch(watched.transport)),
		);
		return { answer, status: watched.lastStatus() };
	}

	/** Refuses an answer whose envelope states a failure of the request. */
	private refuseFailure(step: string, status: number | null): void {
		if (!answered(status)) {
			throw new CalDavError(step);
		}
	}

	/**
	 * Runs one call of the library and names the step that failed. The
	 * words of the library never leave this method, because those words can
	 * carry the body that a server sent.
	 */
	private async call<T>(step: string, body: () => Promise<T>): Promise<T> {
		try {
			return await body();
		} catch {
			throw new CalDavError(step);
		}
	}

	/**
	 * The account that the library takes. The account states each address
	 * that the caller holds, and it leaves out each address that the caller
	 * does not hold. The library makes a request for an address that the
	 * account leaves out, and it makes no request for an address that the
	 * account states.
	 */
	private account(known: KnownEndpoints): DAVAccount {
		return {
			accountType: 'caldav',
			serverUrl: this.serverUrl,
			...(known.rootUrl === undefined ? {} : { rootUrl: known.rootUrl }),
			...(known.principalUrl === undefined
				? {}
				: { principalUrl: known.principalUrl }),
			...(known.homeUrl === undefined ? {} : { homeUrl: known.homeUrl }),
		};
	}
}

/**
 * The multiget report over a set of addresses. The body names each address
 * and the two properties that the engine reads. The library writes the XML
 * of that body and parses the answer. The request carries the headers that
 * sign it, as every other request of the layer does.
 */
function multigetRequest(
	hrefs: readonly string[],
	headers: RequestHeaders,
): Parameters<typeof davRequest>[0]['init'] {
	return {
		method: 'REPORT',
		namespace: DAVNamespaceShort.CALDAV,
		headers: { ...headers, depth: MEMBER_DEPTH },
		body: {
			'calendar-multiget': {
				_attributes: getDAVAttribute([
					DAVNamespace.DAV,
					DAVNamespace.CALDAV,
				]),
				[`${DAVNamespaceShort.DAV}:prop`]: OBJECT_PROPS,
				[`${DAVNamespaceShort.DAV}:href`]: [...hrefs],
			},
		},
	};
}
