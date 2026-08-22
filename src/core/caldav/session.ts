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
 * The layer reads the calendar objects with a multiget report, and it
 * names each address itself. The library also has a function that fetches
 * the objects of a collection, and that function drops every address that
 * does not end in `.ics`. Google states an address of another form, so
 * this layer does not use that function.
 */

import {
	calendarMultiGet,
	createAccount,
	fetchCalendars,
	syncCollection,
} from 'tsdav';
import type { DAVAccount } from 'tsdav';
import type { HttpTransport } from '../ports/transport';
import type { RequestHeaders } from './credentials';
import { calDavFetch, type CalDavFetch } from './fetch-shim';
import type {
	CalDavCalendar,
	CalDavEndpoints,
	CalendarResource,
	CollectionDelta,
	KnownEndpoints,
} from './reading';
import {
	readCalendar,
	readDelta,
	readEndpoints,
	readResources,
} from './reading';

/** The properties that a sync-collection report asks for. */
const CHANGE_PROPS = { 'd:getetag': {} };

/** The properties that a multiget report asks for. */
const OBJECT_PROPS = { 'd:getetag': {}, 'c:calendar-data': {} };

/** The depth of a sync-collection report over the members of a collection. */
const SYNC_LEVEL = 1;

export interface CalDavSessionParts {
	readonly transport: HttpTransport;
	/** The address that the account states for its server. */
	readonly serverUrl: string;
	/** The headers that sign each request of the account. */
	readonly headers: RequestHeaders;
}

export class CalDavSession {
	private readonly serverUrl: string;
	private readonly headers: RequestHeaders;
	private readonly fetch: CalDavFetch;

	constructor(parts: CalDavSessionParts) {
		this.serverUrl = parts.serverUrl;
		this.headers = parts.headers;
		this.fetch = calDavFetch(parts.transport);
	}

	/**
	 * The three addresses of the calendar service. The call makes a request
	 * for each address that the caller does not give.
	 */
	async discover(known: KnownEndpoints = {}): Promise<CalDavEndpoints> {
		const found = await createAccount({
			account: this.account(known),
			headers: { ...this.headers },
			loadCollections: false,
			loadObjects: false,
			fetch: this.fetch,
		});
		return readEndpoints(found);
	}

	/** The calendar collections of the account. */
	async calendars(
		endpoints: CalDavEndpoints,
	): Promise<readonly CalDavCalendar[]> {
		const found = await fetchCalendars({
			account: this.account(endpoints),
			headers: { ...this.headers },
			fetch: this.fetch,
		});
		return found.map(readCalendar);
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
		const answers = await syncCollection({
			url: calendarUrl,
			props: CHANGE_PROPS,
			syncLevel: SYNC_LEVEL,
			syncToken: syncToken ?? '',
			headers: { ...this.headers },
			fetch: this.fetch,
		});
		return readDelta(answers);
	}

	/**
	 * The iCalendar text and the tag of each named resource.
	 *
	 * The library refuses the whole report where the server states a
	 * failure for one resource of it. An address that named a resource a
	 * moment ago, and names none now, therefore fails the call and not that
	 * one address. A caller that reads a set of addresses which another
	 * client can change must answer for that failure.
	 */
	async resources(
		calendarUrl: string,
		hrefs: readonly string[],
	): Promise<readonly CalendarResource[]> {
		if (hrefs.length === 0) {
			return [];
		}
		const answers = await calendarMultiGet({
			url: calendarUrl,
			props: OBJECT_PROPS,
			objectUrls: [...hrefs],
			depth: '1',
			headers: { ...this.headers },
			fetch: this.fetch,
		});
		return readResources(answers);
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
