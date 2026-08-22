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
import { basicHeaders } from './credentials';
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
		expect(delta.syncToken).toBe(mock.syncToken('alice', 'home'));
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
			first.syncToken,
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
			first.syncToken,
		);
		expect(next.changes).toEqual([
			{ href: `${HOME}two.ics`, etag: null, gone: true },
		]);
		expect(mock.log.entries[mock.log.entries.length - 1]?.status).toBe(207);
	});

	it('states no token where the report names no resource', async () => {
		const mock = server();
		const first = await session(mock).changes(
			mock.collectionUrl('alice', 'home'),
			null,
		);
		const next = await session(mock).changes(
			mock.collectionUrl('alice', 'home'),
			first.syncToken,
		);
		expect(next.changes).toEqual([]);
		expect(next.syncToken).toBeNull();
	});
});

describe('the calendar objects of a collection', () => {
	it('reads the text and the tag of each named resource', async () => {
		const mock = server();
		const found = await session(mock).resources(
			mock.collectionUrl('alice', 'home'),
			[`${HOME}one.ics`],
		);
		expect(found).toHaveLength(1);
		expect(found[0]?.href).toBe(`${HOME}one.ics`);
		expect(found[0]?.etag).toBe(
			mock.resourceEtag('alice', 'home', 'one.ics'),
		);
		expect(found[0]?.ics).toContain('UID:one');
	});

	it('reads a resource whose address does not end in .ics', async () => {
		const mock = server();
		mock.seedResource('alice', 'home', 'events%2F1', ONE);
		const found = await session(mock).resources(
			mock.collectionUrl('alice', 'home'),
			[`${HOME}events%2F1`],
		);
		expect(found.map((resource) => resource.href)).toEqual([
			`${HOME}events%2F1`,
		]);
	});

	// The library reads the status of each response of the report, and it
	// refuses the whole report where one response states a failure. One
	// address that names no resource therefore fails the call, and the
	// other addresses of the same call give nothing back. A caller that
	// reads addresses which another client can remove must answer for that
	// failure.
	it('fails the whole report where one address names no resource', async () => {
		const mock = server();
		await expect(
			session(mock).resources(mock.collectionUrl('alice', 'home'), [
				`${HOME}one.ics`,
				`${HOME}gone.ics`,
			]),
		).rejects.toThrow(/404/u);
	});

	it('makes no request for an empty list of addresses', async () => {
		const mock = server();
		const found = await session(mock).resources(
			mock.collectionUrl('alice', 'home'),
			[],
		);
		expect(found).toEqual([]);
		expect(traffic(mock)).toEqual([]);
	});

	it('reads the resources with one multiget report', async () => {
		const mock = server();
		await session(mock).resources(mock.collectionUrl('alice', 'home'), [
			`${HOME}one.ics`,
			`${HOME}two.ics`,
		]);
		expect(traffic(mock)).toEqual([`REPORT ${HOME}`]);
		expect(mock.log.entries[0]?.report).toBe('calendar-multiget');
	});
});
