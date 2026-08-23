/**
 * The CalDAV protocol layer, over the mock server.
 *
 * The real code of the library runs in every case of this file. The mock
 * server takes the place of the transport adapter, so the run makes no
 * network request and reads no state from outside the run. What these
 * cases drive is therefore the whole path: the plugin builds a request,
 * the library writes the body, the mock answers, and the library parses
 * the answer back.
 */

import { describe, expect, it } from 'vitest';
import { icsEvent } from '../../../test/harness/caldav-mock/fixtures';
import { MockCalDavServer } from '../../../test/harness/caldav-mock/server';
import type { MockServerCapabilities } from '../../../test/harness/caldav-mock/capabilities';
import { FakeTransport } from '../../../test/harness/transport';
import { basicHeaders } from './credentials';
import { CalDavError } from './errors';
import type {
	CollectionDelta,
	ResourceOutcome,
	ResourceReport,
} from './reading';
import { CalDavSession } from './session';

const HOME = '/calendars/alice/home/';

const ONE = icsEvent({
	uid: 'one',
	start: '20260310T090000Z',
	end: '20260310T100000Z',
});
const TWO = icsEvent({
	uid: 'two',
	start: '20260420T090000Z',
	end: '20260420T100000Z',
});

function server(
	capabilities: Partial<MockServerCapabilities> = {},
): MockCalDavServer {
	return new MockCalDavServer({
		capabilities,
		accounts: [
			{
				name: 'alice',
				displayName: 'Alice',
				collections: [
					{
						name: 'home',
						displayName: 'Home',
						resources: [
							{ name: 'one.ics', ics: ONE },
							{ name: 'two.ics', ics: TWO },
						],
					},
					{
						name: 'chores',
						displayName: 'Chores',
						components: ['VTODO'],
					},
				],
			},
		],
	});
}

/** A session over one mock server, signed with an app password. */
function session(mock: MockCalDavServer, serverUrl?: string): CalDavSession {
	return new CalDavSession({
		transport: mock,
		serverUrl: serverUrl ?? mock.principalRootUrl,
		headers: basicHeaders('alice', 'password'),
	});
}

/** The token that a report named, or null where it named none. */
function tokenOf(delta: CollectionDelta): string | null {
	return delta.token.kind === 'token' ? delta.token.value : null;
}

/** The outcomes of a report that the server answered. */
function outcomesOf(report: ResourceReport): readonly ResourceOutcome[] {
	if (!report.ok) {
		throw new Error(
			`the server refused the report with status ${String(report.status)}`,
		);
	}
	return report.outcomes;
}

/** The resources that a report found. */
function found(
	report: ResourceReport,
): readonly Extract<ResourceOutcome, { kind: 'found' }>[] {
	return outcomesOf(report).filter((outcome) => outcome.kind === 'found');
}

/** The methods and the paths of every request that the mock handled. */
function traffic(mock: MockCalDavServer): string[] {
	return mock.log.entries.map((entry) => `${entry.method} ${entry.path}`);
}

describe('the discovery of the addresses', () => {
	it('finds the principal and the calendar home from the server address', async () => {
		const mock = server();
		const found = await session(mock).discover();
		expect(found.principalUrl).toBe(mock.principalUrl('alice'));
		expect(found.homeUrl).toBe(mock.homeUrl('alice'));
	});

	it('signs every request of the discovery', async () => {
		const mock = server();
		await session(mock).discover();
		const signed = mock.log.entries.map(
			(entry) => entry.headers.authorization,
		);
		expect(signed).not.toContain(undefined);
		expect(new Set(signed)).toEqual(
			new Set(['Basic YWxpY2U6cGFzc3dvcmQ=']),
		);
	});

	it('makes no request where the caller holds every address', async () => {
		const mock = server();
		await session(mock).discover({
			rootUrl: mock.principalRootUrl,
			principalUrl: mock.principalUrl('alice'),
			homeUrl: mock.homeUrl('alice'),
		});
		expect(traffic(mock)).toEqual([]);
	});

	it('asks for the calendar home alone where the caller holds the principal', async () => {
		const mock = server();
		const found = await session(mock).discover({
			rootUrl: mock.principalRootUrl,
			principalUrl: mock.principalUrl('alice'),
		});
		expect(traffic(mock)).toEqual(['PROPFIND /principals/alice/']);
		expect(found.homeUrl).toBe(mock.homeUrl('alice'));
	});

	it('follows the redirect of the well-known address', async () => {
		const mock = server({
			redirects: { '/.well-known/caldav': { location: '/principals/' } },
		});
		const found = await session(mock, mock.url('/')).discover();
		expect(traffic(mock)[0]).toBe('PROPFIND /.well-known/caldav');
		expect(found.principalUrl).toBe(mock.principalUrl('alice'));
	});

	it('falls back to the address of the account where no redirect arrives', async () => {
		const mock = server();
		const found = await session(mock).discover();
		expect(traffic(mock).slice(0, 2)).toEqual([
			'PROPFIND /.well-known/caldav',
			'GET /.well-known/caldav',
		]);
		expect(found.rootUrl).toBe(mock.principalRootUrl);
	});

	it('fails where the server refuses the credential', async () => {
		const mock = server({
			faults: [{ kind: 'status', status: 401 }],
		});
		await expect(session(mock).discover()).rejects.toThrow();
	});
});

describe('the calendars of an account', () => {
	it('names each calendar and the components that it takes', async () => {
		const mock = server();
		const found = await session(mock).calendars(
			await session(mock).discover(),
		);
		expect(
			found.map((calendar) => ({
				name: calendar.displayName,
				components: calendar.components,
			})),
		).toEqual([
			{ name: 'Home', components: ['VEVENT'] },
			{ name: 'Chores', components: ['VTODO'] },
		]);
	});

	it('carries the address, the tag of the collection, and the sync token', async () => {
		const mock = server();
		const endpoints = await session(mock).discover();
		const found = await session(mock).calendars(endpoints);
		const home = found.find((calendar) => calendar.displayName === 'Home');
		expect(home?.url).toBe(mock.collectionUrl('alice', 'home'));
		expect(home?.ctag).toBe(mock.collectionCtag('alice', 'home'));
		expect(home?.syncToken).toBe(mock.syncToken('alice', 'home'));
	});

	it('states no tag where the server advertises none', async () => {
		const mock = server({ ctag: 'absent' });
		const endpoints = await session(mock).discover();
		const found = await session(mock).calendars(endpoints);
		expect(found[0]?.ctag).toBeNull();
	});
});

describe('the changes of a collection', () => {
	it('names every member on the first call, and gives a token', async () => {
		const mock = server();
		const delta = await session(mock).changes(
			mock.collectionUrl('alice', 'home'),
			null,
		);
		expect(delta.changes.map((change) => change.href)).toEqual([
			`${HOME}one.ics`,
			`${HOME}two.ics`,
		]);
		expect(delta.token).toEqual({
			kind: 'token',
			value: mock.syncToken('alice', 'home'),
		});
	});

	it('carries the tag of each resource', async () => {
		const mock = server();
		const delta = await session(mock).changes(
			mock.collectionUrl('alice', 'home'),
			null,
		);
		expect(delta.changes[0]?.etag).toBe(
			mock.resourceEtag('alice', 'home', 'one.ics'),
		);
	});

	it('names the resources that changed after the token', async () => {
		const mock = server();
		const first = await session(mock).changes(
			mock.collectionUrl('alice', 'home'),
			null,
		);
		mock.seedResource('alice', 'home', 'three.ics', ONE);
		const next = await session(mock).changes(
			mock.collectionUrl('alice', 'home'),
			tokenOf(first),
		);
		expect(next.changes.map((change) => change.href)).toEqual([
			`${HOME}three.ics`,
		]);
	});

	// One answer carries two kinds of status. The status of the HTTP
	// envelope says whether the report arrived, and it is 207 here. The
	// status inside the one response says what the server holds for that
	// one resource, and it is 404 here. The reader takes the second one.
	it('marks a resource that the server removed', async () => {
		const mock = server();
		const first = await session(mock).changes(
			mock.collectionUrl('alice', 'home'),
			null,
		);
		mock.removeResource('alice', 'home', 'two.ics');
		const next = await session(mock).changes(
			mock.collectionUrl('alice', 'home'),
			tokenOf(first),
		);
		expect(next.changes).toEqual([
			{ href: `${HOME}two.ics`, etag: null, gone: true },
		]);
		expect(mock.log.entries[mock.log.entries.length - 1]?.status).toBe(207);
	});

	it('states that nothing changed where the report names no resource', async () => {
		const mock = server();
		const first = await session(mock).changes(
			mock.collectionUrl('alice', 'home'),
			null,
		);
		const next = await session(mock).changes(
			mock.collectionUrl('alice', 'home'),
			tokenOf(first),
		);
		expect(next.changes).toEqual([]);
		expect(next.token).toEqual({ kind: 'no-change' });
	});
});

describe('the calendar objects of a collection', () => {
	it('reads the text and the tag of each named resource', async () => {
		const mock = server();
		const report = await session(mock).resources(
			mock.collectionUrl('alice', 'home'),
			[`${HOME}one.ics`],
		);
		expect(report).toEqual({
			ok: true,
			outcomes: [
				{
					kind: 'found',
					href: `${HOME}one.ics`,
					etag: mock.resourceEtag('alice', 'home', 'one.ics'),
					ics: expect.stringContaining('UID:one') as string,
				},
			],
		});
	});

	it('signs the report', async () => {
		const mock = server();
		await session(mock).resources(mock.collectionUrl('alice', 'home'), [
			`${HOME}one.ics`,
		]);
		expect(mock.log.entries[0]?.headers.authorization).toBe(
			'Basic YWxpY2U6cGFzc3dvcmQ=',
		);
	});

	it('reads a resource whose address does not end in .ics', async () => {
		const mock = server();
		mock.seedResource('alice', 'home', 'events%2F1', ONE);
		const report = await session(mock).resources(
			mock.collectionUrl('alice', 'home'),
			[`${HOME}events%2F1`],
		);
		expect(found(report).map((outcome) => outcome.href)).toEqual([
			`${HOME}events%2F1`,
		]);
	});

	// The answer that confirms a deletion is a response with status 404
	// inside a report that arrived. That response is the observation that
	// the engine asks for, and not a failure of the report. One address
	// that names no resource therefore states its own outcome, and the
	// other addresses of the same report still give their resources back.
	it('states an absent resource beside the resources that it found', async () => {
		const mock = server();
		mock.seedResource('alice', 'home', 'three.ics', ONE);
		mock.removeResource('alice', 'home', 'two.ics');
		const report = await session(mock).resources(
			mock.collectionUrl('alice', 'home'),
			[`${HOME}one.ics`, `${HOME}two.ics`, `${HOME}three.ics`],
		);
		expect(traffic(mock)).toEqual([`REPORT ${HOME}`]);
		expect(report.ok).toBe(true);
		expect(outcomesOf(report)).toEqual([
			expect.objectContaining({ kind: 'found', href: `${HOME}one.ics` }),
			{ kind: 'absent', href: `${HOME}two.ics` },
			expect.objectContaining({
				kind: 'found',
				href: `${HOME}three.ics`,
			}),
		]);
	});

	it('reads the whole set of addresses with one request', async () => {
		const mock = server();
		mock.removeResource('alice', 'home', 'two.ics');
		await session(mock).resources(mock.collectionUrl('alice', 'home'), [
			`${HOME}one.ics`,
			`${HOME}two.ics`,
		]);
		expect(mock.log.entries).toHaveLength(1);
		expect(mock.log.entries[0]?.report).toBe('calendar-multiget');
	});

	it('states the refusal of the whole report, and no outcome', async () => {
		const mock = server({
			faults: [{ kind: 'status', status: 503, method: 'REPORT' }],
		});
		expect(
			await session(mock).resources(mock.collectionUrl('alice', 'home'), [
				`${HOME}one.ics`,
			]),
		).toEqual({ ok: false, status: 503 });
	});

	// The library reads a body that is not a multistatus as one response
	// of its own, and it writes the address of the request into that
	// response. A layer that took such a response for data would state the
	// collection itself as a resource.
	it('names no address of its own where the server refused the report', async () => {
		const mock = server({
			faults: [{ kind: 'status', status: 404, method: 'REPORT' }],
		});
		const report = await session(mock).resources(
			mock.collectionUrl('alice', 'home'),
			[`${HOME}one.ics`],
		);
		expect(report).toEqual({ ok: false, status: 404 });
	});

	it('makes no request for an empty list of addresses', async () => {
		const mock = server();
		expect(
			await session(mock).resources(
				mock.collectionUrl('alice', 'home'),
				[],
			),
		).toEqual({ ok: true, outcomes: [] });
		expect(traffic(mock)).toEqual([]);
	});
});

/**
 * The calendar text that a server writes in each of the four shapes that a
 * parser of XML gives back. A server writes the text itself, or inside a
 * CDATA section, and either form can stand beside an attribute.
 */
const CALENDAR_DATA_SHAPES: readonly (readonly [string, string])[] = [
	['plain text', 'BEGIN:VCALENDAR&#13;\nUID:one&#13;\nEND:VCALENDAR'],
	['a CDATA section', '<![CDATA[BEGIN:VCALENDAR\nUID:one\nEND:VCALENDAR]]>'],
	[
		'text beside an attribute',
		'BEGIN:VCALENDAR&#13;\nUID:one&#13;\nEND:VCALENDAR',
	],
	[
		'a CDATA section beside an attribute',
		'<![CDATA[BEGIN:VCALENDAR\nUID:one\nEND:VCALENDAR]]>',
	],
];

/** A multistatus that states one resource with the calendar text in it. */
function multistatusWith(body: string, attributes: boolean): string {
	const open = attributes
		? '<C:calendar-data content-type="text/calendar" version="2.0">'
		: '<C:calendar-data>';
	return `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>${HOME}one.ics</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"etag-1"</D:getetag>
        ${open}${body}</C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
}

// A server can write the calendar text of a resource in four shapes, and
// each shape states the same text. A reader that takes only one of them
// gives a record with no event content back, and it does so in silence:
// the report arrives as 207 and the sync log states a clean request.
describe('the calendar text in each shape that a server writes', () => {
	it.each(
		CALENDAR_DATA_SHAPES.map(
			([name, body], index) => [name, body, index >= 2] as const,
		),
	)('reads the text out of %s', async (_name, body, attributes) => {
		const transport = new FakeTransport({
			status: 207,
			headers: { 'content-type': 'application/xml; charset=utf-8' },
			text: multistatusWith(body, attributes),
		});
		const caldav = new CalDavSession({
			transport,
			serverUrl: 'https://caldav.example.com/dav/',
			headers: basicHeaders('alice', 'password'),
		});
		const report = await caldav.resources(
			'https://caldav.example.com/dav/calendars/alice/home/',
			[`${HOME}one.ics`],
		);
		expect(found(report)[0]?.ics).toContain('UID:one');
		expect(found(report)[0]?.etag).toBe('"etag-1"');
	});
});

/**
 * A session over a transport that answers every request the same way. The
 * cases below drive a failure of the whole request, which the mock server
 * answers correctly and therefore cannot produce for every step.
 */
function overOneAnswer(status: number, text = FAILURE_PAGE): CalDavSession {
	return new CalDavSession({
		transport: new FakeTransport({
			status,
			headers: { 'content-type': 'text/html; charset=utf-8' },
			text,
		}),
		serverUrl: 'https://caldav.example.com/dav/',
		headers: basicHeaders('alice', 'password'),
	});
}

const FAILURE_PAGE =
	'<html><body>the server of the provider says that user alice-2026 has no calendar named private-work</body></html>';

const ENDPOINTS = {
	rootUrl: 'https://caldav.example.com/dav/',
	principalUrl: 'https://caldav.example.com/dav/principals/alice/',
	homeUrl: 'https://caldav.example.com/dav/calendars/alice/',
};

// The library reads a body that is not a multistatus as one response of
// its own, and it writes the address of the request into that response. A
// report that no server answered would then read as data: the collection
// itself as a resource that is gone, or a calendar home with no calendar
// in it. Each case below asks for the refusal instead.
describe('a request that the server refused whole', () => {
	it.each([404, 500, 503])(
		'refuses a change report that answered %i',
		async (status) => {
			await expect(
				overOneAnswer(status).changes(
					'https://caldav.example.com/dav/calendars/alice/home/',
					null,
				),
			).rejects.toBeInstanceOf(CalDavError);
		},
	);

	it('names the step of the change report that failed', async () => {
		await expect(
			overOneAnswer(500).changes(
				'https://caldav.example.com/dav/calendars/alice/home/',
				null,
			),
		).rejects.toThrow(/change report/u);
	});

	it.each([404, 500, 503])(
		'refuses a calendar list that answered %i',
		async (status) => {
			await expect(
				overOneAnswer(status).calendars(ENDPOINTS),
			).rejects.toBeInstanceOf(CalDavError);
		},
	);

	it('refuses a discovery that answered a failure', async () => {
		await expect(
			overOneAnswer(500).discover({
				rootUrl: ENDPOINTS.rootUrl,
				principalUrl: ENDPOINTS.principalUrl,
			}),
		).rejects.toBeInstanceOf(CalDavError);
	});
});

// A server writes what it wants into the body of a failure: a page of
// HTML, the name of a user, the name of a calendar. The log of this plugin
// holds only words that the plugin wrote, and the words of the library
// carry that body. No failure of this layer carries them out.
describe('the words of a failure', () => {
	const steps: readonly (readonly [
		string,
		(s: CalDavSession) => Promise<unknown>,
	])[] = [
		[
			'the change report',
			(s) =>
				s.changes(
					'https://caldav.example.com/dav/calendars/alice/home/',
					null,
				),
		],
		['the calendar list', (s) => s.calendars(ENDPOINTS)],
		[
			'the discovery',
			(s) =>
				s.discover({
					rootUrl: ENDPOINTS.rootUrl,
					principalUrl: ENDPOINTS.principalUrl,
				}),
		],
	];

	it.each(steps)(
		'carries no word of the server out of %s',
		async (_name, run) => {
			const error = await run(overOneAnswer(500)).then(
				() => null,
				(thrown: unknown) => thrown,
			);
			expect(error).toBeInstanceOf(CalDavError);
			const written = `${String(error)} ${(error as Error).stack ?? ''}`;
			expect(written).not.toContain('alice-2026');
			expect(written).not.toContain('private-work');
			expect(written).not.toContain('<html>');
		},
	);

	it('states the name of the step and nothing else', () => {
		expect(new CalDavError('change report').message).toBe(
			'the change report step with the calendar server failed',
		);
		expect(new CalDavError('change report').step).toBe('change report');
	});
});
