import { describe, expect, it } from 'vitest';
import {
	calendarQueryBody,
	componentSetIn,
	icsEvent,
	multigetBody,
	propfindBody,
	propnameBody,
	readMultistatus,
	hrefsIn,
	errorConditionIn,
	syncCollectionBody,
	syncTokenIn,
} from './fixtures';
import { MockCalDavServer } from './server';
import type { MockServerConfig } from './server';
import type { MockServerCapabilities } from './capabilities';

const WORK = '/calendars/alice/work/';

function server(
	capabilities: Partial<MockServerCapabilities> = {},
): MockCalDavServer {
	const config: MockServerConfig = {
		capabilities,
		accounts: [
			{
				name: 'alice',
				displayName: 'Alice',
				collections: [
					{
						name: 'work',
						displayName: 'Work',
						resources: [
							{
								name: 'one.ics',
								ics: icsEvent({
									uid: 'one',
									start: '20260310T090000Z',
									end: '20260310T100000Z',
								}),
							},
							{
								name: 'two.ics',
								ics: icsEvent({
									uid: 'two',
									start: '20260420T090000Z',
									end: '20260420T100000Z',
								}),
							},
						],
					},
					{
						name: 'chores',
						components: ['VTODO'],
					},
				],
			},
		],
	};
	return new MockCalDavServer(config);
}

describe('mock CalDAV server: discovery', () => {
	it('answers each discovery step: the well-known URL leads to the principal, the principal gives the calendar home URL, and the home lists the collections', async () => {
		const mock = server({
			redirects: { '/.well-known/caldav': { location: '/principals/' } },
		});

		const wellKnown = await mock.request({
			url: mock.wellKnownUrl,
			method: 'PROPFIND',
		});
		expect(wellKnown.status).toBe(301);
		expect(wellKnown.headers.Location).toBe(mock.principalRootUrl);

		const root = await mock.request({
			url: mock.principalRootUrl,
			method: 'PROPFIND',
			headers: { Depth: '0' },
			body: propfindBody(['d:current-user-principal']),
		});
		const rootProps = readMultistatus(root.text)[0];
		expect(rootProps?.found.get('d:current-user-principal')).toBe(
			'/principals/alice/',
		);

		const principal = await mock.request({
			url: mock.principalUrl('alice'),
			method: 'PROPFIND',
			headers: { Depth: '0' },
			body: propfindBody(['c:calendar-home-set']),
		});
		expect(
			readMultistatus(principal.text)[0]?.found.get(
				'c:calendar-home-set',
			),
		).toBe('/calendars/alice/');

		const home = await mock.request({
			url: mock.homeUrl('alice'),
			method: 'PROPFIND',
			headers: { Depth: '1' },
			body: propfindBody([
				'd:resourcetype',
				'd:displayname',
				'cs:getctag',
				'd:sync-token',
				'c:supported-calendar-component-set',
			]),
		});
		expect(hrefsIn(home.text)).toStrictEqual([
			'/calendars/alice/',
			'/calendars/alice/work/',
			'/calendars/alice/chores/',
		]);
	});

	it('reads a request that declares the DAV namespace as the default and uses no prefix', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'PROPFIND',
			headers: { Depth: '0' },
			body: '<propfind xmlns="DAV:"><prop><displayname/></prop></propfind>',
		});
		expect(
			readMultistatus(response.text)[0]?.found.get('d:displayname'),
		).toBe('Work');
	});

	it('refuses a PROPFIND that asks for infinite depth', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.homeUrl('alice'),
			method: 'PROPFIND',
			headers: { Depth: 'infinity' },
			body: propfindBody(['d:displayname']),
		});
		expect(response.status).toBe(403);
		expect(errorConditionIn(response.text)).toBe('d:propfind-finite-depth');
	});

	it('lists the collection and its members at depth 1, gives each member its etag, and reports an unknown property as missing', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'PROPFIND',
			headers: { Depth: '1' },
			body: propfindBody(['d:getetag', 'c:calendar-description']),
		});
		const responses = readMultistatus(response.text);
		expect(responses.map((each) => each.href)).toStrictEqual([
			WORK,
			`${WORK}one.ics`,
			`${WORK}two.ics`,
		]);
		expect(responses[1]?.found.get('d:getetag')).toBe(
			mock.resourceEtag('alice', 'work', 'one.ics'),
		);
		expect(responses[1]?.missing).toContain('c:calendar-description');
	});

	it('answers a request for a property in an unknown namespace, and reports the property as missing', async () => {
		const mock = server();
		const vendor = { x: 'http://apple.com/ns/ical/' };
		const propfind = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'PROPFIND',
			headers: { Depth: '0' },
			body: propfindBody(
				['d:displayname', 'x:calendar-color', 'x:calendar-order'],
				vendor,
			),
		});
		expect(propfind.status).toBe(207);
		const [collection] = readMultistatus(propfind.text);
		expect(collection?.found.get('d:displayname')).toBe('Work');
		expect(collection?.missing).toStrictEqual([
			'http://apple.com/ns/ical/:calendar-color',
			'http://apple.com/ns/ical/:calendar-order',
		]);

		const report = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:x="http://apple.com/ns/ical/">
	<D:prop><D:getetag/><x:calendar-color/></D:prop>
	<D:href>${WORK}one.ics</D:href>
</C:calendar-multiget>`,
		});
		expect(report.status).toBe(207);
		expect(readMultistatus(report.text)[0]?.missing).toStrictEqual([
			'http://apple.com/ns/ical/:calendar-color',
		]);
		expect(mock.log.entries.map((entry) => entry.status)).toStrictEqual([
			207, 207,
		]);
	});

	it('answers a PROPFIND for property names with the names only, and with no values', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'PROPFIND',
			headers: { Depth: '0' },
			body: propnameBody(),
		});
		const [collection] = readMultistatus(response.text);
		expect(collection?.found.get('d:displayname')).toBe('');
		expect(collection?.found.has('cs:getctag')).toBe(true);
		expect(collection?.missing).toStrictEqual([]);
	});

	it('refuses a PROPFIND body that is not complete XML, but answers a PROPFIND that has no body', async () => {
		const mock = server();
		const corrupt = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'PROPFIND',
			headers: { Depth: '0' },
			body: '<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/>',
		});
		expect(corrupt.status).toBe(400);

		const absent = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'PROPFIND',
			headers: { Depth: '0' },
		});
		expect(absent.status).toBe(207);
		expect(
			readMultistatus(absent.text)[0]?.found.get('d:displayname'),
		).toBe('Work');
	});

	it('gives each collection its own set of supported components', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.collectionUrl('alice', 'chores'),
			method: 'PROPFIND',
			headers: { Depth: '0' },
			body: propfindBody(['c:supported-calendar-component-set']),
		});
		expect(componentSetIn(response.text)).toStrictEqual(['VTODO']);
	});
});

describe('mock CalDAV server: reports', () => {
	it('reports every member when the sync token is empty, and only the changes after that', async () => {
		const mock = server();
		const initial = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: syncCollectionBody(''),
		});
		expect(hrefsIn(initial.text)).toStrictEqual([
			`${WORK}one.ics`,
			`${WORK}two.ics`,
		]);
		const token = syncTokenIn(initial.text);
		expect(token).toBe(mock.syncToken('alice', 'work'));

		mock.seedResource(
			'alice',
			'work',
			'three.ics',
			icsEvent({ uid: 'three' }),
		);
		const next = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: syncCollectionBody(token ?? ''),
		});
		expect(hrefsIn(next.text)).toStrictEqual([`${WORK}three.ics`]);
		expect(syncTokenIn(next.text)).not.toBe(token);
	});

	it('reports a deleted resource with a 404 status', async () => {
		const mock = server();
		const initial = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: syncCollectionBody(''),
		});
		mock.removeResource('alice', 'work', 'two.ics');
		const next = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: syncCollectionBody(syncTokenIn(initial.text) ?? ''),
		});
		const [only] = readMultistatus(next.text);
		expect(only?.href).toBe(`${WORK}two.ics`);
		expect(only?.status).toContain('404');
	});

	it('refuses a sync token that another collection issued', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: syncCollectionBody(mock.syncToken('alice', 'chores')),
		});
		expect(response.status).toBe(403);
		expect(errorConditionIn(response.text)).toBe('d:valid-sync-token');
	});

	it('refuses each sync token that the server did not issue, even a token that differs only in the spelling of its number', async () => {
		const mock = server();
		const issued = mock.syncToken('alice', 'work');
		const prefix = issued.replace(/\d+$/, '');
		const forged = ['', ' 1', '0x1', '1e0', '01', '+1', '1.0'];

		const answers: Record<string, string> = {};
		for (const suffix of forged) {
			const response = await mock.request({
				url: mock.collectionUrl('alice', 'work'),
				method: 'REPORT',
				body: syncCollectionBody(`${prefix}${suffix}`),
			});
			answers[suffix] =
				`${String(response.status)} ${errorConditionIn(response.text) ?? 'no condition'}`;
		}
		expect(answers).toStrictEqual(
			Object.fromEntries(
				forged.map((suffix) => [suffix, '403 d:valid-sync-token']),
			),
		);

		const genuine = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: syncCollectionBody(issued),
		});
		expect(genuine.status).toBe(207);
	});

	it('treats an all-day event that has no end as one whole day', async () => {
		const mock = server();
		mock.seedResource(
			'alice',
			'work',
			'allday.ics',
			icsEvent({ uid: 'allday', start: '20260501' }),
		);
		const query = async (
			start: string,
			end: string,
		): Promise<readonly string[]> =>
			hrefsIn(
				(
					await mock.request({
						url: mock.collectionUrl('alice', 'work'),
						method: 'REPORT',
						body: calendarQueryBody({ start, end }),
					})
				).text,
			);

		expect(
			await query('20260501T120000Z', '20260502T000000Z'),
		).toStrictEqual([`${WORK}allday.ics`]);
		expect(
			await query('20260430T000000Z', '20260501T000000Z'),
		).toStrictEqual([]);
		expect(
			await query('20260502T000000Z', '20260503T000000Z'),
		).toStrictEqual([]);
		expect(
			await query('20260501T235959Z', '20260502T000000Z'),
		).toStrictEqual([`${WORK}allday.ics`]);
	});

	it('filters a calendar-query by a time range that includes the start and excludes the end', async () => {
		const mock = server();
		const inRange = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: calendarQueryBody({
				start: '20260301T000000Z',
				end: '20260401T000000Z',
			}),
		});
		expect(hrefsIn(inRange.text)).toStrictEqual([`${WORK}one.ics`]);

		const touchingTheEnd = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: calendarQueryBody({
				start: '20260101T000000Z',
				end: '20260310T090000Z',
			}),
		});
		expect(hrefsIn(touchingTheEnd.text)).toStrictEqual([]);

		const touchingTheStart = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: calendarQueryBody({
				start: '20260310T100000Z',
				end: '20260501T000000Z',
			}),
		});
		expect(hrefsIn(touchingTheStart.text)).toStrictEqual([
			`${WORK}two.ics`,
		]);
	});

	it('filters a calendar-query by UID and by component name', async () => {
		const mock = server();
		const byUid = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: calendarQueryBody({ uid: 'two' }),
		});
		expect(hrefsIn(byUid.text)).toStrictEqual([`${WORK}two.ics`]);

		const byComponent = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: calendarQueryBody({ component: 'VTODO' }),
		});
		expect(hrefsIn(byComponent.text)).toStrictEqual([]);
	});

	it('answers a multiget that a client sends to one resource, and not to the collection', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'REPORT',
			body: multigetBody([`${WORK}one.ics`]),
		});
		expect(response.status).toBe(207);
		expect(hrefsIn(response.text)).toStrictEqual([`${WORK}one.ics`]);
	});

	it('answers a multiget with each resource that exists, and with a 404 for each resource that does not exist', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: multigetBody([
				`${WORK}one.ics`,
				`${WORK}gone.ics`,
				mock.resourceUrl('alice', 'work', 'two.ics'),
			]),
		});
		const responses = readMultistatus(response.text);
		expect(responses.map((each) => each.href)).toStrictEqual([
			`${WORK}one.ics`,
			`${WORK}gone.ics`,
			`${WORK}two.ics`,
		]);
		expect(responses[1]?.status).toContain('404');
		expect(responses[0]?.found.get('c:calendar-data')).toContain('UID:one');
	});
});

describe('mock CalDAV server: resources', () => {
	it('creates a resource, updates that resource, and deletes that resource', async () => {
		const mock = server();
		const created = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'new.ics'),
			method: 'PUT',
			headers: { 'If-None-Match': '*' },
			body: icsEvent({ uid: 'new' }),
		});
		expect(created.status).toBe(201);
		expect(created.headers.ETag).toBe(
			mock.resourceEtag('alice', 'work', 'new.ics'),
		);

		const updated = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'new.ics'),
			method: 'PUT',
			headers: { 'If-Match': created.headers.ETag ?? '' },
			body: icsEvent({ uid: 'new', summary: 'later' }),
		});
		expect(updated.status).toBe(204);

		const removed = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'new.ics'),
			method: 'DELETE',
			headers: { 'If-Match': updated.headers.ETag ?? '' },
		});
		expect(removed.status).toBe(204);
		expect(mock.resourceNames('alice', 'work')).toStrictEqual([
			'one.ics',
			'two.ics',
		]);

		const missing = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'new.ics'),
			method: 'GET',
		});
		expect(missing.status).toBe(404);
	});

	it('returns the stored bytes and the calendar content type on GET', async () => {
		const mock = server();
		const body = icsEvent({ uid: 'one', start: '20260310T090000Z' });
		await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			body,
		});
		const fetched = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'GET',
		});
		expect(fetched.text).toBe(body);
		expect(fetched.headers['Content-Type']).toBe(
			'text/calendar; charset=utf-8',
		);
	});

	it('lists the members in name order, whatever order the writes used', async () => {
		const mock = server();
		mock.removeResource('alice', 'work', 'one.ics');
		mock.seedResource('alice', 'work', 'one.ics', icsEvent({ uid: 'one' }));
		const response = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'PROPFIND',
			headers: { Depth: '1' },
			body: propfindBody(['d:getetag']),
		});
		expect(hrefsIn(response.text)).toStrictEqual([
			WORK,
			`${WORK}one.ics`,
			`${WORK}two.ics`,
		]);
		expect(mock.resourceNames('alice', 'work')).toStrictEqual([
			'one.ics',
			'two.ics',
		]);
	});

	it('refuses a component that the collection does not support, and accepts a component that the collection supports', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.resourceUrl('alice', 'chores', 'event.ics'),
			method: 'PUT',
			body: icsEvent({ uid: 'event' }),
		});
		expect(response.status).toBe(403);
		expect(errorConditionIn(response.text)).toBe(
			'c:supported-calendar-component',
		);
		expect(mock.resourceNames('alice', 'chores')).toStrictEqual([]);

		const accepted = await mock.request({
			url: mock.resourceUrl('alice', 'chores', 'task.ics'),
			method: 'PUT',
			body: icsEvent({ uid: 'task', component: 'VTODO' }),
		});
		expect(accepted.status).toBe(201);
	});

	it('answers a 404 for a resource path that ends with a slash', async () => {
		const mock = server();
		const response = await mock.request({
			url: `${mock.resourceUrl('alice', 'work', 'one.ics')}/`,
			method: 'GET',
		});
		expect(response.status).toBe(404);
	});

	it('answers a 409 for a PUT under a collection that does not exist', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.url('/calendars/alice/nowhere/one.ics'),
			method: 'PUT',
			body: icsEvent({ uid: 'one' }),
		});
		expect(response.status).toBe(409);
	});

	it('answers OPTIONS with the DAV header on a known path, and with a 404 on an unknown path', async () => {
		const mock = server();
		const served = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'OPTIONS',
		});
		expect(served.status).toBe(200);
		expect(served.headers.DAV).toContain('calendar-access');

		const nowhere = await mock.request({
			url: mock.url('/nowhere/at/all'),
			method: 'OPTIONS',
		});
		expect(nowhere.status).toBe(404);
	});

	it('refuses a PUT body that is not calendar data', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'junk.ics'),
			method: 'PUT',
			body: 'not an event',
		});
		expect(response.status).toBe(403);
		expect(errorConditionIn(response.text)).toBe('c:valid-calendar-data');
	});

	it('answers the principal root with the principal of the account that is authenticated', async () => {
		const mock = new MockCalDavServer({
			accounts: [
				{ name: 'alice', collections: [{ name: 'work' }] },
				{ name: 'bob', collections: [{ name: 'home' }] },
			],
		});
		const ask = async (): Promise<string | undefined> => {
			const response = await mock.request({
				url: mock.principalRootUrl,
				method: 'PROPFIND',
				headers: { Depth: '0' },
				body: propfindBody(['d:current-user-principal']),
			});
			return readMultistatus(response.text)[0]?.found.get(
				'd:current-user-principal',
			);
		};
		expect(await ask()).toBe('/principals/alice/');
		mock.authenticateAs('bob');
		expect(await ask()).toBe('/principals/bob/');
	});

	it('answers a 404 for a URL on another origin', async () => {
		const mock = server();
		const response = await mock.request({
			url: 'https://elsewhere.example/calendars/alice/work/one.ics',
			method: 'GET',
		});
		expect(response.status).toBe(404);
	});
});
