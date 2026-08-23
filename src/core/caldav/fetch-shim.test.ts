/**
 * The bridge from the transport port to the shape that the CalDAV library
 * calls.
 *
 * The library reads seven members of the answer, and it reads them in code
 * that this repository does not own. Each case below therefore reads one
 * of those members through the bridge. A member that the bridge stops
 * giving turns a case red here, and not in a report of a user whose server
 * answered in a shape that nobody drove.
 */

import { describe, expect, it } from 'vitest';
import { FakeTransport } from '../../../test/harness/transport';
import type { HttpRequest } from '../ports/transport';
import type { CalDavAnswer } from './fetch-shim';
import { PASSED_OVER_FIELDS, calDavFetch } from './fetch-shim';

const ADDRESS = 'https://caldav.example.com/dav/principals/user/';

/**
 * The bridge, in the shape that these cases read. The library declares the
 * parameter as the fetch function of the platform, and the bridge answers
 * with the seven members that the library reads. A case reads those seven
 * members, so it names that shape here.
 */
function bridge(
	transport: FakeTransport,
): (input: string | URL, init?: RequestInit) => Promise<CalDavAnswer> {
	return calDavFetch(transport);
}

/** The one request that a transport recorded. */
function only(transport: FakeTransport): HttpRequest {
	expect(transport.requests).toHaveLength(1);
	const request = transport.requests[0];
	if (!request) {
		throw new Error('the transport recorded no request');
	}
	return request;
}

describe('the request that the bridge sends', () => {
	it('takes the address as text', async () => {
		const transport = new FakeTransport({});
		await bridge(transport)(ADDRESS);
		expect(only(transport).url).toBe(ADDRESS);
	});

	it('takes the address as a URL object', async () => {
		const transport = new FakeTransport({});
		await bridge(transport)(new URL(ADDRESS));
		expect(only(transport).url).toBe(ADDRESS);
	});

	it('takes GET where the call names no method', async () => {
		const transport = new FakeTransport({});
		await bridge(transport)(ADDRESS);
		expect(only(transport).method).toBe('GET');
	});

	it('writes the method in capital letters', async () => {
		const transport = new FakeTransport({});
		await bridge(transport)(ADDRESS, { method: 'propfind' });
		expect(only(transport).method).toBe('PROPFIND');
	});

	it('carries the headers, with each name in lower case', async () => {
		const transport = new FakeTransport({});
		await bridge(transport)(ADDRESS, {
			headers: { 'Content-Type': 'text/xml', Depth: '0' },
		});
		expect(only(transport).headers).toEqual({
			'content-type': 'text/xml',
			depth: '0',
		});
	});

	it('carries the body of text', async () => {
		const transport = new FakeTransport({});
		await bridge(transport)(ADDRESS, {
			method: 'PROPFIND',
			body: '<propfind/>',
		});
		expect(only(transport).body).toBe('<propfind/>');
	});

	it('states no body where the call carries none', async () => {
		const transport = new FakeTransport({});
		await bridge(transport)(ADDRESS);
		expect('body' in only(transport)).toBe(false);
	});

	it('passes over a field that the port cannot express', async () => {
		const transport = new FakeTransport({});
		await bridge(transport)(ADDRESS, {
			method: 'PROPFIND',
			redirect: 'manual',
			cache: 'no-store',
		});
		const request = only(transport);
		expect(request.method).toBe('PROPFIND');
		for (const field of PASSED_OVER_FIELDS) {
			expect(field in request).toBe(false);
		}
	});

	it('names the redirect field among the fields that it passes over', () => {
		expect(PASSED_OVER_FIELDS).toContain('redirect');
	});

	it('refuses a request object in the place of an address', async () => {
		const transport = new FakeTransport({});
		const call = calDavFetch(transport);
		await expect(call(new Request(ADDRESS))).rejects.toThrow(
			/takes an address/u,
		);
	});

	it('refuses a body that is not text', async () => {
		const transport = new FakeTransport({});
		await expect(
			bridge(transport)(ADDRESS, {
				method: 'PUT',
				body: new Uint8Array([1, 2, 3]),
			}),
		).rejects.toThrow(/body of text/u);
	});
});

describe('the answer that the bridge gives', () => {
	it('states the status', async () => {
		const transport = new FakeTransport({ status: 207 });
		expect((await bridge(transport)(ADDRESS)).status).toBe(207);
	});

	it.each([
		[200, true],
		[207, true],
		[299, true],
		[300, false],
		[401, false],
		[500, false],
	])('states ok as %s for status %i', async (status, ok) => {
		const transport = new FakeTransport({ status });
		expect((await bridge(transport)(ADDRESS)).ok).toBe(ok);
	});

	it('states an empty reason phrase, because the port carries none', async () => {
		const transport = new FakeTransport({ status: 404 });
		expect((await bridge(transport)(ADDRESS)).statusText).toBe('');
	});

	it('stamps the address of the request on the answer', async () => {
		const transport = new FakeTransport({});
		expect((await bridge(transport)(ADDRESS)).url).toBe(ADDRESS);
	});

	it('gives the body back as text', async () => {
		const transport = new FakeTransport({ text: '<multistatus/>' });
		expect(await (await bridge(transport)(ADDRESS)).text()).toBe(
			'<multistatus/>',
		);
	});

	it('reads the body as JSON', async () => {
		const transport = new FakeTransport({ text: '{"access_token":"a"}' });
		expect(await (await bridge(transport)(ADDRESS)).json()).toEqual({
			access_token: 'a',
		});
	});

	it('fails the JSON read where the body is not JSON', async () => {
		const transport = new FakeTransport({ text: 'BEGIN:VCALENDAR' });
		await expect(
			(await bridge(transport)(ADDRESS)).json(),
		).rejects.toThrow();
	});

	it('answers a header name in any letter case', async () => {
		const transport = new FakeTransport({
			headers: { 'Content-Type': 'application/xml; charset=utf-8' },
		});
		const got = await bridge(transport)(ADDRESS);
		expect(got.headers.get('content-type')).toBe(
			'application/xml; charset=utf-8',
		);
		expect(got.headers.get('CONTENT-TYPE')).toBe(
			'application/xml; charset=utf-8',
		);
	});

	it('carries the location header of a redirect', async () => {
		const transport = new FakeTransport({
			status: 301,
			headers: { Location: '/dav/principals/user/' },
		});
		const got = await bridge(transport)(ADDRESS);
		expect(got.status).toBe(301);
		expect(got.headers.get('Location')).toBe('/dav/principals/user/');
	});

	it('keeps the rest of the answer where the platform refuses a header name', async () => {
		const transport = new FakeTransport({
			headers: { 'bad name': 'x', etag: '"one"' },
		});
		const got = await bridge(transport)(ADDRESS);
		expect(got.headers.get('etag')).toBe('"one"');
		expect(got.status).toBe(200);
	});

	it('gives an answer for a status that is not 2xx, and does not fail', async () => {
		const transport = new FakeTransport({ status: 401, text: 'no' });
		const got = await bridge(transport)(ADDRESS);
		expect(got.status).toBe(401);
		expect(got.ok).toBe(false);
		expect(await got.text()).toBe('no');
	});

	it('fails where the transport fails', async () => {
		const transport = new FakeTransport({ fails: 'the network is down' });
		await expect(bridge(transport)(ADDRESS)).rejects.toThrow(
			'the network is down',
		);
	});
});
