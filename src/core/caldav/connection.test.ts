/**
 * The connection test of one account.
 *
 * The test runs the first step of every later operation, so it states
 * whether the address, the username, and the password work together. These
 * cases drive that step against the mock server and against a transport
 * that fails, and they state which of the results each condition gives.
 */

import { describe, expect, it } from 'vitest';
import { MockCalDavServer } from '../../../test/harness/caldav-mock/server';
import type { MockServerCapabilities } from '../../../test/harness/caldav-mock/capabilities';
import { FakeTransport } from '../../../test/harness/transport';
import type { AccountCredential } from '../model/credential';
import type { HttpTransport } from '../ports/transport';
import { checkConnection } from './connection';

const PASSWORD: AccountCredential = {
	type: 'app-password',
	password: 'password',
};

function server(
	capabilities: Partial<MockServerCapabilities> = {},
): MockCalDavServer {
	return new MockCalDavServer({
		capabilities,
		accounts: [{ name: 'alice', collections: [{ name: 'home' }] }],
	});
}

function check(
	transport: HttpTransport,
	serverUrl: string,
	credential: AccountCredential = PASSWORD,
): Promise<string> {
	return checkConnection({
		transport,
		serverUrl,
		username: 'alice',
		credential,
	});
}

describe('what the connection test states', () => {
	it('states a sign-in where the server answers the discovery', async () => {
		const mock = server();
		expect(await check(mock, mock.principalRootUrl)).toBe('signed-in');
	});

	it('states a refusal where the server answers 401', async () => {
		const mock = server({ faults: [{ kind: 'status', status: 401 }] });
		expect(await check(mock, mock.principalRootUrl)).toBe('refused');
	});

	it('states a refusal where the server answers 403', async () => {
		const mock = server({ faults: [{ kind: 'status', status: 403 }] });
		expect(await check(mock, mock.principalRootUrl)).toBe('refused');
	});

	it('states no server where the transport fails', async () => {
		const transport = new FakeTransport({ fails: 'the network is down' });
		expect(await check(transport, 'https://caldav.example.com/dav/')).toBe(
			'not-reached',
		);
	});

	it('states no server where the address holds no calendar service', async () => {
		const transport = new FakeTransport({ status: 404, text: 'not here' });
		expect(await check(transport, 'https://caldav.example.com/dav/')).toBe(
			'not-reached',
		);
	});

	it('states no server where the server fails', async () => {
		const mock = server({ faults: [{ kind: 'status', status: 503 }] });
		expect(await check(mock, mock.principalRootUrl)).toBe('not-reached');
	});

	it('states a sign-in where a refusal came before a step that passed', async () => {
		const mock = server({
			faults: [{ kind: 'status', status: 401, times: 1 }],
		});
		expect(await check(mock, mock.principalRootUrl)).toBe('signed-in');
	});

	// The discovery starts with two probes of the well-known address. A
	// server can answer a probe with 401 and still sign the plugin in at
	// the address of the principal. A test that read every status of the
	// chain would send the user to enter the app password again, where the
	// address is the thing to correct.
	it('states no server where a probe answered 401 and another step stopped the discovery', async () => {
		const mock = server({
			faults: [
				{ kind: 'status', status: 401, pathContains: '.well-known' },
			],
		});
		expect(await check(mock, mock.url('/'))).toBe('not-reached');
	});

	it('states a refusal where the server refused the last request as well', async () => {
		const mock = server({ faults: [{ kind: 'status', status: 401 }] });
		expect(await check(mock, mock.url('/'))).toBe('refused');
	});
});

describe('the conditions that stop the test before a request', () => {
	it('names the alphabet where the password stands outside it', async () => {
		const transport = new FakeTransport({});
		expect(
			await check(transport, 'https://caldav.example.com/dav/', {
				type: 'app-password',
				password: 'пароль',
			}),
		).toBe('credential-alphabet');
	});

	it('names the missing token flow for an OAuth account', async () => {
		const transport = new FakeTransport({});
		expect(
			await check(transport, 'https://caldav.example.com/dav/', {
				type: 'oauth',
				tokens: {
					clientId: 'client',
					clientSecret: 'secret',
					refreshToken: 'refresh',
				},
			}),
		).toBe('no-token-flow');
	});

	it('makes no request where it names one of those conditions', async () => {
		const transport = new FakeTransport({});
		await check(transport, 'https://caldav.example.com/dav/', {
			type: 'app-password',
			password: 'пароль',
		});
		expect(transport.requests).toEqual([]);
	});
});
