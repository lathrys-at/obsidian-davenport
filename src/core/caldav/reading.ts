/**
 * The shapes that the CalDAV layer gives the engine, and the readers that
 * build them from the answers of the library.
 *
 * The library answers with the parsed WebDAV document, and every value in
 * that document is of an unknown type: a server sends what it wants, and
 * the parser gives back what it found. These readers therefore test each
 * value before they take it, and they leave out a value of another shape.
 *
 * One answer carries two kinds of status, and a reader must take the one
 * that it means. The status of the HTTP envelope says whether the request
 * arrived. The status inside each response of the document says what the
 * server did with that one resource. A report that arrives as 207 can hold
 * a response with status 404, and that response states one resource that
 * is gone. The `ok` member of the library follows the status inside the
 * response, and it falls back to the status of the envelope where the
 * response states none.
 */

import type { DAVAccount, DAVCalendar, DAVResponse } from 'tsdav';

/** The addresses of the calendar service of one account. */
export interface CalDavEndpoints {
	readonly rootUrl: string;
	readonly principalUrl: string;
	readonly homeUrl: string;
}

/** The addresses that the plugin holds before a discovery. */
export type KnownEndpoints = Partial<CalDavEndpoints>;

/** One calendar collection of an account. */
export interface CalDavCalendar {
	readonly url: string;
	/** The name that the server states, or the address where it states none. */
	readonly displayName: string;
	/** The component types that the collection takes. */
	readonly components: readonly string[];
	readonly ctag: string | null;
	readonly syncToken: string | null;
}

/** One resource that changed since the token that the caller held. */
export interface CollectionChange {
	readonly href: string;
	readonly etag: string | null;
	/** True where the resource is no longer a member of the collection. */
	readonly gone: boolean;
}

/** What one sync-collection report states. */
export interface CollectionDelta {
	/**
	 * The token that the report gives for the next call, or null where the
	 * answer carries none. See `readSyncToken` for the second condition.
	 */
	readonly syncToken: string | null;
	readonly changes: readonly CollectionChange[];
}

/** One calendar object, as a multiget report states it. */
export interface CalendarResource {
	readonly href: string;
	readonly etag: string | null;
	/** The iCalendar text, or null where the response carries none. */
	readonly ics: string | null;
}

/**
 * The three addresses of an account of the library. The call throws where
 * the discovery gave no address, because a later request needs each of the
 * three and a request to no address reaches no server.
 */
export function readEndpoints(account: DAVAccount): CalDavEndpoints {
	return {
		rootUrl: address(account.rootUrl, 'root'),
		principalUrl: address(account.principalUrl, 'principal'),
		homeUrl: address(account.homeUrl, 'calendar home'),
	};
}

/** One address of a discovery, or a failure that names the missing step. */
function address(found: string | undefined, step: string): string {
	if (found === undefined || found === '') {
		throw new Error(`the calendar server stated no ${step} address`);
	}
	return found;
}

/** One calendar of the library, in the shape of the engine. */
export function readCalendar(found: DAVCalendar): CalDavCalendar {
	return {
		url: found.url,
		displayName: text(found.displayName) ?? found.url,
		components: found.components ?? [],
		ctag: text(found.ctag),
		syncToken: text(found.syncToken),
	};
}

/**
 * The token of the next sync, or null where the answer carries none.
 *
 * The library gives the whole parsed document back on each response of the
 * answer. A report that names no resource carries no response, and the
 * library then builds one entry that holds no document. The token of such
 * a report does not reach this reader, and the result is null. The caller
 * keeps the token that it holds: the collection did not change, so that
 * token still states the same point.
 */
export function readSyncToken(answers: readonly DAVResponse[]): string | null {
	for (const answer of answers) {
		const found = text(reach(answer.raw, ['multistatus', 'syncToken']));
		if (found !== null) {
			return found;
		}
	}
	return null;
}

/** The changes that one sync-collection report states. */
export function readDelta(answers: readonly DAVResponse[]): CollectionDelta {
	const changes: CollectionChange[] = [];
	for (const answer of answers) {
		const href = text(answer.href);
		if (href === null) {
			continue;
		}
		changes.push({
			href,
			etag: text(reach(answer.props, ['getetag'])),
			gone: answer.status === 404 || answer.status === 410,
		});
	}
	return { syncToken: readSyncToken(answers), changes };
}

/** The resources that one multiget report states. */
export function readResources(
	answers: readonly DAVResponse[],
): readonly CalendarResource[] {
	const found: CalendarResource[] = [];
	for (const answer of answers) {
		const href = text(answer.href);
		if (href === null || !answer.ok) {
			continue;
		}
		found.push({
			href,
			etag: text(reach(answer.props, ['getetag'])),
			ics: text(reach(answer.props, ['calendarData'])),
		});
	}
	return found;
}

/**
 * The value under a path of names, or undefined where the path names
 * nothing. The parsed document holds values of every shape, so the walk
 * stops at the first step that does not lead to a set of named values.
 */
function reach(value: unknown, path: readonly string[]): unknown {
	let held = value;
	for (const name of path) {
		if (typeof held !== 'object' || held === null) {
			return undefined;
		}
		held = Reflect.get(held, name);
	}
	return held;
}

/**
 * The text of a value, or null where the value is not text with
 * characters. The parser gives a number back for a value that reads as a
 * number, and a server can state a token or a tag in that form, so a
 * number becomes its text here.
 */
function text(value: unknown): string | null {
	if (typeof value === 'string') {
		return value === '' ? null : value;
	}
	if (typeof value === 'number' || typeof value === 'bigint') {
		return String(value);
	}
	return null;
}
