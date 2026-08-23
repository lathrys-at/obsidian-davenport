/**
 * Network discipline over the CalDAV library.
 *
 * Every network call of the plugin goes through the transport port, and
 * the adapter of that port uses `requestUrl`. A CalDAV server sends no
 * CORS headers, so a call that uses the fetch function of the browser
 * fails on a phone and nowhere else. The library that this plugin uses
 * takes a fetch parameter at every entry point, and the plugin gives it
 * the bridge over the port at every call.
 *
 * The harness replaces the global fetch with a function that throws. The
 * first case below drives the library without the parameter and reads that
 * throw, so the poison is a fact of this run and not an assumption. The
 * other cases drive the whole protocol layer and read the count of refused
 * calls, which stays at zero.
 *
 * One ordering constraint holds this proof together. The library reads the
 * global fetch one time, at the moment the module loads, and it keeps that
 * value as its fallback. The poison must therefore stand before any test
 * module imports the library. The setup file of the test runner installs
 * the poison at its top level, and the runner runs that file before it
 * imports a test module.
 */

import { describe, expect, it } from 'vitest';
import { propfind } from 'tsdav';
import { icsEvent } from '../../harness/caldav-mock/fixtures';
import { MockCalDavServer } from '../../harness/caldav-mock/server';
import {
	NetworkAccessError,
	fetchPoisonHolds,
	recordedFetchAttempts,
	runSimulation,
} from '../../harness/sweeps';
import { basicHeaders } from '../../../src/core/caldav/credentials';
import { CalDavSession } from '../../../src/core/caldav/session';

const EVENT = icsEvent({
	uid: 'one',
	start: '20260310T090000Z',
	end: '20260310T100000Z',
});

function server(): MockCalDavServer {
	return new MockCalDavServer({
		accounts: [
			{
				name: 'alice',
				collections: [
					{
						name: 'home',
						displayName: 'Home',
						resources: [{ name: 'one.ics', ics: EVENT }],
					},
				],
			},
		],
	});
}

function session(mock: MockCalDavServer): CalDavSession {
	return new CalDavSession({
		transport: mock,
		serverUrl: mock.principalRootUrl,
		headers: basicHeaders('alice', 'password'),
	});
}

/** Drives every operation of the protocol layer against one mock server. */
async function driveEveryOperation(mock: MockCalDavServer): Promise<void> {
	const caldav = session(mock);
	const endpoints = await caldav.discover();
	const calendars = await caldav.calendars(endpoints);
	const home = calendars[0];
	if (!home) {
		throw new Error('the mock server stated no calendar');
	}
	const delta = await caldav.changes(home.url, null);
	await caldav.changes(
		home.url,
		delta.token.kind === 'token' ? delta.token.value : null,
	);
	await caldav.resources(
		home.url,
		delta.changes.map((change) => change.href),
	);
}

describe('IV-13 network discipline over the CalDAV library', () => {
	it('IV-13: a call of the library without the injection trips the poison', async () => {
		await expect(
			propfind({
				url: 'https://caldav.example.com/dav/',
				props: { 'd:displayname': {} },
				depth: '0',
			}),
		).rejects.toBeInstanceOf(NetworkAccessError);
	});

	it('IV-13: the poison holds while the tests of this file run', () => {
		expect(fetchPoisonHolds()).toBe(true);
	});

	it('IV-13: every operation of the protocol layer passes the injection', async () => {
		const mock = server();
		const before = recordedFetchAttempts().length;
		await driveEveryOperation(mock);
		expect(recordedFetchAttempts().slice(before)).toEqual([]);
		expect(mock.log.entries.length).toBeGreaterThan(0);
	});

	it('IV-13: a simulated run of the protocol layer keeps the poison', async () => {
		const mock = server();
		const evidence = await runSimulation(
			{ name: 'caldav protocol', caldav: mock },
			async (run) => {
				await driveEveryOperation(mock);
				return run.evidence();
			},
		);
		expect(evidence.network.poisoned).toBe(true);
		expect(evidence.network.attempts).toEqual([]);
		expect(evidence.caldav.requests.length).toBeGreaterThan(0);
	});

	it('IV-13: every request of a simulated run reached the mock server', async () => {
		const mock = server();
		const evidence = await runSimulation(
			{ name: 'caldav protocol requests', caldav: mock },
			async (run) => {
				await driveEveryOperation(mock);
				return run.evidence();
			},
		);
		const methods = new Set(
			evidence.caldav.requests.map((entry) => entry.method),
		);
		expect(methods).toEqual(new Set(['PROPFIND', 'GET', 'REPORT']));
	});
});
