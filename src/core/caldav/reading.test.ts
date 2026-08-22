/**
 * The readers that turn the answers of the CalDAV library into the shapes
 * of the engine.
 *
 * A server sends what it wants, and the parser of the library gives back
 * what it found. Every value of an answer is therefore of an unknown type.
 * These cases give the readers the shapes that a server can produce, and
 * they state what each reader takes and what it leaves.
 */

import { describe, expect, it } from 'vitest';
import type { DAVCalendar, DAVResponse } from 'tsdav';
import {
	readCalendar,
	readDelta,
	readEndpoints,
	readResources,
	readSyncToken,
} from './reading';

const ROOT = 'https://caldav.example.com/dav/';
const HOME = 'https://caldav.example.com/dav/calendars/alice/home/';

/** One response of a multistatus, with the fields that a case does not give. */
function response(parts: Partial<DAVResponse> = {}): DAVResponse {
	return {
		status: parts.status ?? 200,
		statusText: parts.statusText ?? '',
		ok: parts.ok ?? (parts.status ?? 200) < 300,
		...parts,
	};
}

/** A response that carries the parsed document with a sync token. */
function withToken(token: unknown): DAVResponse {
	return response({ raw: { multistatus: { syncToken: token } } });
}

describe('the addresses of a discovery', () => {
	it('takes the three addresses of the account', () => {
		expect(
			readEndpoints({
				accountType: 'caldav',
				serverUrl: ROOT,
				rootUrl: ROOT,
				principalUrl: `${ROOT}principals/alice/`,
				homeUrl: HOME,
			}),
		).toEqual({
			rootUrl: ROOT,
			principalUrl: `${ROOT}principals/alice/`,
			homeUrl: HOME,
		});
	});

	it.each([
		['root', { principalUrl: `${ROOT}principals/alice/`, homeUrl: HOME }],
		['principal', { rootUrl: ROOT, homeUrl: HOME }],
		['calendar home', { rootUrl: ROOT, principalUrl: ROOT }],
	])('names the %s address where the discovery found none', (step, held) => {
		expect(() =>
			readEndpoints({ accountType: 'caldav', serverUrl: ROOT, ...held }),
		).toThrow(step);
	});

	it('refuses an address with no characters', () => {
		expect(() =>
			readEndpoints({
				accountType: 'caldav',
				serverUrl: ROOT,
				rootUrl: ROOT,
				principalUrl: ROOT,
				homeUrl: '',
			}),
		).toThrow(/calendar home/u);
	});
});

describe('one calendar of the library', () => {
	it('takes the name, the components, the tag, and the token', () => {
		expect(
			readCalendar({
				url: HOME,
				displayName: 'Home',
				components: ['VEVENT'],
				ctag: '"ctag-3"',
				syncToken: 'sync-3',
			}),
		).toEqual({
			url: HOME,
			displayName: 'Home',
			components: ['VEVENT'],
			ctag: '"ctag-3"',
			syncToken: 'sync-3',
		});
	});

	it('takes the address as the name where the server states none', () => {
		expect(readCalendar({ url: HOME }).displayName).toBe(HOME);
	});

	it('takes the address as the name where the name is not text', () => {
		expect(
			readCalendar({ url: HOME, displayName: { _cdata: 'Home' } })
				.displayName,
		).toBe(HOME);
	});

	it('states no component where the server states none', () => {
		expect(readCalendar({ url: HOME }).components).toEqual([]);
	});

	it('states no tag and no token where the server states none', () => {
		const calendar = readCalendar({ url: HOME });
		expect(calendar.ctag).toBeNull();
		expect(calendar.syncToken).toBeNull();
	});

	it('takes a token that reads as a number, as text', () => {
		const numeric = {
			url: HOME,
			syncToken: 1234,
		} as unknown as DAVCalendar;
		expect(readCalendar(numeric).syncToken).toBe('1234');
	});
});

describe('the token of the next sync', () => {
	it('takes the token out of the parsed document', () => {
		expect(readSyncToken([withToken('sync-4')])).toBe('sync-4');
	});

	it('states no token where the answer carries no document', () => {
		expect(readSyncToken([response()])).toBeNull();
	});

	it('states no token where the document holds no token', () => {
		expect(
			readSyncToken([response({ raw: { multistatus: {} } })]),
		).toBeNull();
	});

	it('states no token where the document is not a set of named values', () => {
		expect(readSyncToken([response({ raw: 'a page of text' })])).toBeNull();
	});

	it('states no token for a token with no characters', () => {
		expect(readSyncToken([withToken('')])).toBeNull();
	});

	it('takes the first token that an answer states', () => {
		expect(readSyncToken([response(), withToken('sync-5')])).toBe('sync-5');
	});
});

describe('the changes of a collection', () => {
	it('takes the address and the tag of each resource', () => {
		expect(
			readDelta([
				response({
					href: `${HOME}one.ics`,
					props: { getetag: '"etag-1"' },
					raw: { multistatus: { syncToken: 'sync-6' } },
				}),
			]),
		).toEqual({
			syncToken: 'sync-6',
			changes: [
				{ href: `${HOME}one.ics`, etag: '"etag-1"', gone: false },
			],
		});
	});

	it.each([404, 410])('marks a resource with status %i as gone', (status) => {
		const delta = readDelta([response({ href: `${HOME}one.ics`, status })]);
		expect(delta.changes[0]?.gone).toBe(true);
	});

	it('leaves out an entry that names no address', () => {
		expect(readDelta([response()]).changes).toEqual([]);
	});

	it('states no tag where the response carries none', () => {
		expect(
			readDelta([response({ href: `${HOME}one.ics` })]).changes,
		).toEqual([{ href: `${HOME}one.ics`, etag: null, gone: false }]);
	});
});

describe('the calendar objects of a report', () => {
	it('takes the address, the tag, and the text of each resource', () => {
		expect(
			readResources([
				response({
					href: `${HOME}one.ics`,
					props: {
						getetag: '"etag-1"',
						calendarData: 'BEGIN:VCALENDAR',
					},
				}),
			]),
		).toEqual([
			{
				href: `${HOME}one.ics`,
				etag: '"etag-1"',
				ics: 'BEGIN:VCALENDAR',
			},
		]);
	});

	it('leaves out a response that states a failure for one resource', () => {
		expect(
			readResources([response({ href: `${HOME}one.ics`, status: 404 })]),
		).toEqual([]);
	});

	it('leaves out a response that names no address', () => {
		expect(
			readResources([response({ props: { getetag: '"one"' } })]),
		).toEqual([]);
	});

	it('states no text where the response carries no calendar data', () => {
		expect(
			readResources([response({ href: `${HOME}one.ics` })])[0]?.ics,
		).toBeNull();
	});
});
