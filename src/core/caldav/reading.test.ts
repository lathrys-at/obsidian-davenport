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
import type { DAVResponse } from 'tsdav';
import type { ResourceOutcome } from './reading';
import {
	holdsRawEntry,
	isRawEntry,
	readCalendars,
	readDelta,
	readEndpoints,
	readOutcomes,
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

describe('the calendars of a property report', () => {
	/** One response of a report over a calendar home. */
	function collection(
		parts: Partial<DAVResponse['props']> = {},
	): DAVResponse {
		return response({
			href: '/dav/calendars/alice/home/work/',
			props: { resourcetype: { collection: {}, calendar: {} }, ...parts },
		});
	}

	it('takes the name, the components, the tag, and the token', () => {
		expect(
			readCalendars(
				[
					collection({
						displayname: 'Work',
						supportedCalendarComponentSet: {
							comp: { _attributes: { name: 'VEVENT' } },
						},
						getctag: '"ctag-3"',
						syncToken: 'sync-3',
					}),
				],
				ROOT,
			),
		).toEqual([
			{
				url: `${ROOT}calendars/alice/home/work/`,
				displayName: 'Work',
				components: ['VEVENT'],
				ctag: '"ctag-3"',
				syncToken: 'sync-3',
			},
		]);
	});

	// The report reads the home to a depth of one, so it names the home
	// itself beside each calendar in it. The home states no calendar in the
	// type of the resource.
	it('states no calendar for a collection that holds none', () => {
		expect(
			readCalendars(
				[
					response({
						href: '/dav/calendars/alice/home/',
						props: { resourcetype: { collection: {} } },
					}),
				],
				ROOT,
			),
		).toEqual([]);
	});

	it('states no calendar for a response with no property at all', () => {
		expect(
			readCalendars([response({ href: '/calendars/alice/home/' })], ROOT),
		).toEqual([]);
	});

	it('states no calendar for a response that names no address', () => {
		expect(
			readCalendars(
				[response({ props: { resourcetype: { calendar: {} } } })],
				ROOT,
			),
		).toEqual([]);
	});

	it('takes the address as the name where the server states none', () => {
		expect(readCalendars([collection()], ROOT)[0]?.displayName).toBe(
			`${ROOT}calendars/alice/home/work/`,
		);
	});

	it('takes the name out of a CDATA section', () => {
		expect(
			readCalendars(
				[collection({ displayname: { _cdata: 'Work' } })],
				ROOT,
			)[0]?.displayName,
		).toBe('Work');
	});

	it('takes an address that the server states in whole', () => {
		expect(
			readCalendars(
				[
					response({
						href: `${ROOT}calendars/alice/home/work/`,
						props: { resourcetype: { calendar: {} } },
					}),
				],
				ROOT,
			)[0]?.url,
		).toBe(`${ROOT}calendars/alice/home/work/`);
	});

	// A parser gives one element as a value and more than one as a list.
	it('takes one component type', () => {
		expect(
			readCalendars(
				[
					collection({
						supportedCalendarComponentSet: {
							comp: { _attributes: { name: 'VTODO' } },
						},
					}),
				],
				ROOT,
			)[0]?.components,
		).toEqual(['VTODO']);
	});

	it('takes more than one component type', () => {
		expect(
			readCalendars(
				[
					collection({
						supportedCalendarComponentSet: {
							comp: [
								{ _attributes: { name: 'VEVENT' } },
								{ _attributes: { name: 'VTODO' } },
							],
						},
					}),
				],
				ROOT,
			)[0]?.components,
		).toEqual(['VEVENT', 'VTODO']);
	});

	it('states no component where the server states none', () => {
		expect(readCalendars([collection()], ROOT)[0]?.components).toEqual([]);
	});

	it('states no component for an element with no name', () => {
		expect(
			readCalendars(
				[collection({ supportedCalendarComponentSet: { comp: {} } })],
				ROOT,
			)[0]?.components,
		).toEqual([]);
	});

	it('states no tag and no token where the server states none', () => {
		const calendar = readCalendars([collection()], ROOT)[0];
		expect(calendar?.ctag).toBeNull();
		expect(calendar?.syncToken).toBeNull();
	});

	it('takes a token that reads as a number, as text', () => {
		expect(
			readCalendars([collection({ syncToken: 1234 })], ROOT)[0]
				?.syncToken,
		).toBe('1234');
	});

	// The address of the server comes from the settings, and a user writes
	// that value. An address that states no server leaves each address of
	// the answer as the server stated it.
	it('keeps the address of the response where the server address is not one', () => {
		expect(readCalendars([collection()], 'not an address')[0]?.url).toBe(
			'/dav/calendars/alice/home/work/',
		);
	});
});

// The library gives one entry for each response of a multistatus, and one
// entry carrying the whole body where the body is anything else. The
// second form carries the address of the request, so a reader that took it
// for data would state that address as a resource.
describe('the answer that states no multistatus', () => {
	it.each([
		['a body of text', 'the server is behind a login wall'],
		['a body with no characters', ''],
		['a body that does not parse', '<multistatus'],
	])('names the entry of %s', (_name, raw) => {
		expect(isRawEntry(response({ href: ROOT, raw }))).toBe(true);
	});

	it('names the entry of a document that is not a multistatus', () => {
		expect(isRawEntry(response({ href: ROOT, raw: { error: {} } }))).toBe(
			true,
		);
	});

	// The parser can make a scalar of the member, and the library takes a
	// scalar that is not true as no document. The test agrees with the
	// library on every such value.
	it('names the entry of a multistatus that holds a scalar', () => {
		expect(
			isRawEntry(response({ href: ROOT, raw: { multistatus: 0 } })),
		).toBe(true);
		expect(
			isRawEntry(response({ href: ROOT, raw: { multistatus: false } })),
		).toBe(true);
		expect(
			isRawEntry(response({ href: ROOT, raw: { multistatus: '' } })),
		).toBe(true);
	});

	it('names no entry of a multistatus', () => {
		expect(
			isRawEntry(
				response({
					href: HOME,
					raw: { multistatus: { response: {} } },
				}),
			),
		).toBe(false);
	});

	// A multistatus that names no response is not this form. The library
	// holds no document for it, so it writes no address into the entry, and
	// that answer is the answer of a collection that did not change.
	it('names no entry of a multistatus that names no response', () => {
		expect(isRawEntry(response())).toBe(false);
	});

	it('finds one such entry among the entries of an answer', () => {
		expect(holdsRawEntry([response({ href: ROOT, raw: 'a page' })])).toBe(
			true,
		);
		expect(
			holdsRawEntry([
				response({ href: HOME, raw: { multistatus: {} } }),
				response(),
			]),
		).toBe(false);
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
			token: { kind: 'token', value: 'sync-6' },
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

// The three conditions below are different, and a caller that cannot tell
// the second from the third keeps a token that no longer states the point
// it reached, and reports the same change on every call.
describe('what a report states about the token of the next call', () => {
	it('names the token where the report carried one', () => {
		expect(readDelta([withToken('sync-7')]).token).toEqual({
			kind: 'token',
			value: 'sync-7',
		});
	});

	it('states no change where the report named no resource', () => {
		expect(readDelta([response()]).token).toEqual({ kind: 'no-change' });
	});

	it('states no token where the report named a resource and carried none', () => {
		const delta = readDelta([
			response({
				href: `${HOME}one.ics`,
				props: { getetag: '"etag-1"' },
				raw: { multistatus: {} },
			}),
		]);
		expect(delta.changes).toHaveLength(1);
		expect(delta.token).toEqual({ kind: 'no-token' });
	});
});

describe('the calendar objects of a report', () => {
	const ONE = `${HOME}one.ics`;

	/**
	 * The outcomes for one asked-about address. The reader answers null
	 * where the report left an address out, and a case that means that
	 * asks for it by name.
	 */
	function outcomes(
		answers: readonly DAVResponse[],
		asked: readonly string[] = [ONE],
	): readonly ResourceOutcome[] {
		const found = readOutcomes(answers, asked, HOME);
		if (found === null) {
			throw new Error('the report answered about no named address');
		}
		return found;
	}

	it('states a resource that the server holds, with its tag and its text', () => {
		expect(
			outcomes([
				response({
					href: ONE,
					props: {
						getetag: '"etag-1"',
						calendarData: 'BEGIN:VCALENDAR',
					},
				}),
			]),
		).toEqual([
			{
				kind: 'found',
				href: ONE,
				etag: '"etag-1"',
				ics: 'BEGIN:VCALENDAR',
			},
		]);
	});

	it.each([404, 410])(
		'states a resource that is not there for status %i',
		(status) => {
			expect(outcomes([response({ href: ONE, status })])).toEqual([
				{ kind: 'absent', href: ONE },
			]);
		},
	);

	it('states the status where the server answered in another way', () => {
		expect(outcomes([response({ href: ONE, status: 403 })])).toEqual([
			{ kind: 'other', href: ONE, status: 403 },
		]);
	});

	// A report that leaves an address out answered nothing about it, and a
	// caller cannot read that silence as an absence.
	it('answers null where the report names no address', () => {
		expect(
			readOutcomes(
				[response({ props: { getetag: '"one"' } })],
				[ONE],
				HOME,
			),
		).toBeNull();
	});

	// A body that was cut short can still parse as a multistatus, and the
	// response that the cut left behind names an address of its own. That
	// address is not the question the caller asked.
	it('answers null where the report names another address alone', () => {
		expect(
			readOutcomes(
				[
					response({ href: `${HOME}other.ics`, props: {} }),
					response({ href: HOME, props: {} }),
				],
				[ONE],
				HOME,
			),
		).toBeNull();
	});

	it('answers null where the report left one address of two out', () => {
		expect(
			readOutcomes(
				[response({ href: ONE })],
				[ONE, `${HOME}two.ics`],
				HOME,
			),
		).toBeNull();
	});

	it('answers every address that the caller named', () => {
		expect(
			outcomes(
				[
					response({ href: ONE }),
					response({ href: `${HOME}two.ics`, status: 404 }),
				],
				[ONE, `${HOME}two.ics`],
			).map((outcome) => outcome.kind),
		).toEqual(['found', 'absent']);
	});

	it('takes the first response where a server states two for one address', () => {
		expect(
			outcomes([
				response({ href: ONE, props: { getetag: '"first"' } }),
				response({ href: ONE, props: { getetag: '"second"' } }),
			]),
		).toEqual([{ kind: 'found', href: ONE, etag: '"first"', ics: null }]);
	});

	it('reads a name that the caller stated two times one time', () => {
		expect(outcomes([response({ href: ONE })], [ONE, ONE])).toHaveLength(1);
	});

	it('takes the address in the spelling that the caller used', () => {
		expect(
			outcomes([response({ href: '/dav/calendars/alice/home/one.ics' })]),
		).toEqual([{ kind: 'found', href: ONE, etag: null, ics: null }]);
	});

	it('states no text where the response carries no calendar data', () => {
		expect(outcomes([response({ href: ONE })])[0]).toEqual({
			kind: 'found',
			href: ONE,
			etag: null,
			ics: null,
		});
	});

	// A parser of XML gives a CDATA section, and text beside an attribute,
	// as a set of named values with one member. A server writes the
	// calendar text of a resource in any of these shapes.
	it.each([
		['plain text', 'BEGIN:VCALENDAR'],
		['a CDATA section', { _cdata: 'BEGIN:VCALENDAR' }],
		['text beside an attribute', { _text: 'BEGIN:VCALENDAR' }],
		[
			'a CDATA section beside an attribute',
			{
				_attributes: { 'content-type': 'text/calendar' },
				_cdata: 'BEGIN:VCALENDAR',
			},
		],
	])('takes the calendar text from %s', (_name, calendarData) => {
		expect(
			outcomes([response({ href: ONE, props: { calendarData } })])[0],
		).toMatchObject({ kind: 'found', ics: 'BEGIN:VCALENDAR' });
	});

	it('states no text where a wrapper holds no text', () => {
		expect(
			outcomes([response({ href: ONE, props: { calendarData: {} } })])[0],
		).toMatchObject({ kind: 'found', ics: null });
	});

	it('takes a tag out of a CDATA section as well', () => {
		expect(
			outcomes([
				response({
					href: ONE,
					props: { getetag: { _cdata: '"etag-2"' } },
				}),
			])[0],
		).toMatchObject({ kind: 'found', etag: '"etag-2"' });
	});
});
