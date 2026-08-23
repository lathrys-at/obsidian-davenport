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
 * is gone. The readers below take the status inside the response, because
 * that status is the answer about the resource.
 *
 * A value of the document arrives in more than one shape. A parser of XML
 * gives plain text as the value itself. It gives a CDATA section as a set
 * of named values with one member, and it gives text beside an attribute
 * in the same form. A server can write the calendar text of a resource in
 * any of those shapes, and each shape states the same text. The reader
 * takes the text out of each of them.
 *
 * An answer of the library also arrives in one of two forms, and a caller
 * must tell them apart before it reads anything. Where the body of the
 * answer is a multistatus, the library gives one entry for each response
 * of that document. Where the body is anything else, the library gives one
 * entry that carries the body as it stands, and it writes the address of
 * the request into that entry. `holdsRawEntry` below names the second
 * form.
 */

import type { DAVAccount, DAVResponse } from 'tsdav';

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

/**
 * What one sync-collection report states about the token of the next call.
 *
 * The three conditions are different, and a caller must be able to tell
 * them apart.
 *
 * `token` says that the report carried a token. The caller sends that
 * token on the next call.
 *
 * `no-change` says that the report named no resource and carried no token.
 * The library drops the token of such a report, so the plugin cannot tell
 * whether the server sent one. The collection did not change, and the
 * token that the caller holds still states the same point.
 *
 * `no-token` says that the report named one resource or more and carried
 * no token. The server sent no token. The caller cannot keep the token
 * that it holds and also count the changes as seen, because the next call
 * with that token names the same changes again. What the caller does then
 * is a decision of the sync loop, and this module does not make it.
 */
export type NextSyncToken =
	| { readonly kind: 'token'; readonly value: string }
	| { readonly kind: 'no-change' }
	| { readonly kind: 'no-token' };

/** What one sync-collection report states. */
export interface CollectionDelta {
	readonly token: NextSyncToken;
	readonly changes: readonly CollectionChange[];
}

/**
 * What a multiget report states about one address.
 *
 * `found` says that the server holds a resource at that address. `absent`
 * says that the server holds none, which is the answer that confirms a
 * deletion. `other` says that the server answered about the address in
 * another way, and it carries the status of that answer.
 */
export type ResourceOutcome =
	| {
			readonly kind: 'found';
			readonly href: string;
			readonly etag: string | null;
			/** The iCalendar text, or null where the response carries none. */
			readonly ics: string | null;
	  }
	| { readonly kind: 'absent'; readonly href: string }
	| {
			readonly kind: 'other';
			readonly href: string;
			readonly status: number;
	  };

/**
 * What one multiget report gives back.
 *
 * The two arms answer two different questions, and a caller reads the
 * first one before it can read the second. `ok` true says that the server
 * answered the report, and the outcomes then state what the server holds
 * at each address. `ok` false says that the server refused the report
 * itself, and it carries the status of that refusal. No outcome of a
 * member reaches this arm: a member that is not there is an outcome and
 * not a failure.
 */
export type ResourceReport =
	| { readonly ok: true; readonly outcomes: readonly ResourceOutcome[] }
	| {
			readonly ok: false;
			/**
			 * The status of the answer, or null where the library sent no
			 * request at all.
			 */
			readonly status: number | null;
	  };

/** The statuses that state that a server holds no resource at an address. */
const ABSENT_STATUSES: ReadonlySet<number> = new Set([404, 410]);

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

/**
 * True where the library built this entry from a body that is not a
 * multistatus.
 *
 * The library reads such a body as one response of its own, and it writes
 * the address of the request into that response. A reader that took the
 * entry for data would state the address of a collection as a resource,
 * and it would state the collection of a calendar home as a calendar with
 * no name. The status of the answer does not name this form: a body that
 * carries no XML, a body with no characters, a body that does not parse,
 * and a body that parses to something other than a multistatus each arrive
 * under a status of success as readily as under a status of failure.
 *
 * A multistatus that names no response is not this form. The library holds
 * no document for such an answer, and it therefore writes no address into
 * the entry. That answer is the answer of a collection that did not
 * change.
 */
export function isRawEntry(answer: DAVResponse): boolean {
	return (
		answer.raw !== undefined &&
		reach(answer.raw, ['multistatus']) === undefined
	);
}

/** True where one entry or more of the answer states no multistatus. */
export function holdsRawEntry(answers: readonly DAVResponse[]): boolean {
	return answers.some(isRawEntry);
}

/**
 * The calendar collections that one property report names.
 *
 * The report reads the calendar home to a depth of one, so it names the
 * home itself beside each collection in it. A calendar collection states
 * the type `calendar`, and the home does not, so the type of the resource
 * selects the calendars. The reader keeps every calendar collection and
 * states the component types of each one; the caller chooses the
 * collections that it can use.
 */
export function readCalendars(
	answers: readonly DAVResponse[],
	rootUrl: string,
): readonly CalDavCalendar[] {
	const found: CalDavCalendar[] = [];
	for (const answer of answers) {
		const href = text(answer.href);
		if (href === null || !isCalendarCollection(answer)) {
			continue;
		}
		const url = absolute(href, rootUrl);
		found.push({
			url,
			displayName: text(reach(answer.props, ['displayname'])) ?? url,
			components: componentNames(
				reach(answer.props, ['supportedCalendarComponentSet', 'comp']),
			),
			ctag: text(reach(answer.props, ['getctag'])),
			syncToken: text(reach(answer.props, ['syncToken'])),
		});
	}
	return found;
}

/** True where the response states a collection that holds a calendar. */
function isCalendarCollection(answer: DAVResponse): boolean {
	return reach(answer.props, ['resourcetype', 'calendar']) !== undefined;
}

/**
 * The component types that a collection takes. The property holds one
 * element for each type, and a parser gives one element as a value and
 * more than one as a list.
 */
function componentNames(value: unknown): readonly string[] {
	const held: readonly unknown[] = Array.isArray(value) ? value : [value];
	const names: string[] = [];
	for (const comp of held) {
		const name = text(reach(comp, ['_attributes', 'name']));
		if (name !== null) {
			names.push(name);
		}
	}
	return names;
}

/** The address of a response, against the address of the server. */
function absolute(href: string, rootUrl: string): string {
	try {
		return new URL(href, rootUrl).href;
	} catch {
		return href;
	}
}

/**
 * The token that a report carried, or null where no answer of the report
 * carried one.
 *
 * The library gives the whole parsed document back on each response of the
 * answer. A report that names no resource carries no response, and the
 * library then builds one entry that holds no document. The token of such
 * a report therefore never reaches this reader. `readDelta` below tells
 * that condition apart from a report that named resources and carried no
 * token.
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
			gone: ABSENT_STATUSES.has(answer.status),
		});
	}
	return {
		token: nextToken(readSyncToken(answers), changes.length),
		changes,
	};
}

/** What the report states about the token of the next call. */
function nextToken(found: string | null, changes: number): NextSyncToken {
	if (found !== null) {
		return { kind: 'token', value: found };
	}
	return changes === 0 ? { kind: 'no-change' } : { kind: 'no-token' };
}

/**
 * What one multiget report states about each address that the caller
 * named.
 *
 * The reader answers the question that the caller asked, and it answers no
 * other question. A response for an address that the caller did not name
 * states nothing that the caller can use, and it gets no outcome. A body
 * that was cut short can still parse as a multistatus, and the response
 * that the cut left behind names an address of its own; without this rule
 * that address would arrive as a resource.
 *
 * Each outcome carries the address in the spelling that the caller used.
 * A server states an address as a path or as a whole address, and the two
 * forms name one resource, so the caller would otherwise have to match the
 * two spellings itself. Where a server states two responses for one
 * address, the first of them states the outcome.
 *
 * The result is null where the report did not answer about every address
 * that the caller named. A server answers a report about a set of
 * addresses with one response for each of them, so a report that leaves an
 * address out did not answer the question. An address with no response
 * states nothing: a caller cannot tell "the resource is not there" from
 * "the server did not say", and the first of those two readings would mint
 * a deletion that no server confirmed.
 */
export function readOutcomes(
	answers: readonly DAVResponse[],
	asked: readonly string[],
	base: string,
): readonly ResourceOutcome[] | null {
	const wanted = new Map(asked.map((href) => [absolute(href, base), href]));
	const found = new Map<string, ResourceOutcome>();
	for (const answer of answers) {
		const href = text(answer.href);
		if (href === null) {
			continue;
		}
		const at = absolute(href, base);
		const named = wanted.get(at);
		if (named === undefined || found.has(at)) {
			continue;
		}
		found.set(at, outcomeOf(named, answer));
	}
	return found.size === wanted.size ? [...found.values()] : null;
}

/** The outcome of one response of a multiget report. */
function outcomeOf(href: string, answer: DAVResponse): ResourceOutcome {
	if (ABSENT_STATUSES.has(answer.status)) {
		return { kind: 'absent', href };
	}
	if (answer.status < 200 || answer.status >= 300) {
		return { kind: 'other', href, status: answer.status };
	}
	return {
		kind: 'found',
		href,
		etag: text(reach(answer.props, ['getetag'])),
		ics: text(reach(answer.props, ['calendarData'])),
	};
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
 * The text of a value, or null where the value states no text with
 * characters. The value arrives as the text itself, or inside a wrapper
 * that the parser builds for a CDATA section and for text beside an
 * attribute.
 */
function text(value: unknown): string | null {
	return plain(value) ?? plain(unwrapped(value));
}

/**
 * The text of a value that is text or a number. The parser gives a number
 * back for a value that reads as a number, and a server can state a token
 * or a tag in that form, so a number becomes its text here.
 */
function plain(value: unknown): string | null {
	if (typeof value === 'string') {
		return value === '' ? null : value;
	}
	if (typeof value === 'number' || typeof value === 'bigint') {
		return String(value);
	}
	return null;
}

/**
 * The value inside the wrapper of a CDATA section or of a text node, or
 * undefined where the value carries no such wrapper.
 */
function unwrapped(value: unknown): unknown {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const cdata: unknown = Reflect.get(value, '_cdata');
	return cdata === undefined ? Reflect.get(value, '_text') : cdata;
}
