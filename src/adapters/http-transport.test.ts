/**
 * The transport port over the request function of the platform.
 *
 * The point of these cases is the contract of the port. The platform
 * function throws for a status of 400 and above unless the call asks it
 * not to, and the port states that every status resolves. A case
 * therefore reads the call that the adapter made, and not the answer
 * alone.
 */

import { describe, expect, it } from 'vitest';
import type { RequestUrlAnswer, RequestUrlCall } from './http-transport';
import { createHttpTransport } from './http-transport';

const encoder = new TextEncoder();

/** An answer of the platform, with the fields that a case does not give. */
function answer(parts: Partial<RequestUrlAnswer> = {}): RequestUrlAnswer {
	const text = parts.text ?? '';
	return {
		status: parts.status ?? 200,
		headers: parts.headers ?? {},
		text,
		arrayBuffer: parts.arrayBuffer ?? encoder.encode(text).buffer,
	};
}

/** A host that records each call and answers from a rule. */
function host(rule: (call: RequestUrlCall) => RequestUrlAnswer = answer): {
	readonly calls: RequestUrlCall[];
	readonly host: (call: RequestUrlCall) => Promise<RequestUrlAnswer>;
} {
	const calls: RequestUrlCall[] = [];
	return {
		calls,
		host: (call) => {
			calls.push(call);
			return Promise.resolve(rule(call));
		},
	};
}

describe('the call that the adapter makes', () => {
	it('asks the platform not to throw for a status of 400 and above', async () => {
		const platform = host();
		await createHttpTransport(platform.host).request({
			url: 'https://caldav.example.com/dav/',
		});
		expect(platform.calls[0]?.throw).toBe(false);
	});

	it('carries the method, the headers, the body, and the content type', async () => {
		const platform = host();
		await createHttpTransport(platform.host).request({
			url: 'https://caldav.example.com/dav/',
			method: 'PROPFIND',
			headers: { authorization: 'Basic dTpw', depth: '0' },
			body: '<propfind/>',
			contentType: 'text/xml; charset=utf-8',
		});
		expect(platform.calls[0]).toEqual({
			url: 'https://caldav.example.com/dav/',
			throw: false,
			method: 'PROPFIND',
			headers: { authorization: 'Basic dTpw', depth: '0' },
			body: '<propfind/>',
			contentType: 'text/xml; charset=utf-8',
		});
	});

	it('states no field that the request does not hold', async () => {
		const platform = host();
		await createHttpTransport(platform.host).request({
			url: 'https://caldav.example.com/dav/',
		});
		expect(Object.keys(platform.calls[0] ?? {}).sort()).toEqual([
			'throw',
			'url',
		]);
	});

	it('copies the headers, so a later change of the request changes no call', async () => {
		const platform = host();
		const headers: Record<string, string> = { depth: '0' };
		await createHttpTransport(platform.host).request({
			url: 'https://caldav.example.com/dav/',
			headers,
		});
		headers.depth = '1';
		expect(platform.calls[0]?.headers).toEqual({ depth: '0' });
	});

	it('sends a body of octets as it stands', async () => {
		const platform = host();
		const body = encoder.encode('BEGIN:VCALENDAR').buffer;
		await createHttpTransport(platform.host).request({
			url: 'https://caldav.example.com/dav/a.ics',
			method: 'PUT',
			body,
		});
		expect(platform.calls[0]?.body).toBe(body);
	});
});

describe('the answer that the adapter gives', () => {
	it('carries the status, the headers, the text, and the octets', async () => {
		const octets = encoder.encode('BEGIN:VCALENDAR').buffer;
		const platform = host(() =>
			answer({
				status: 207,
				headers: { 'content-type': 'application/xml' },
				text: 'BEGIN:VCALENDAR',
				arrayBuffer: octets,
			}),
		);
		const got = await createHttpTransport(platform.host).request({
			url: 'https://caldav.example.com/dav/',
		});
		expect(got.status).toBe(207);
		expect(got.headers).toEqual({ 'content-type': 'application/xml' });
		expect(got.text).toBe('BEGIN:VCALENDAR');
		expect(got.arrayBuffer).toBe(octets);
	});

	it('copies the headers of the platform', async () => {
		const headers: Record<string, string> = { etag: '"one"' };
		const platform = host(() => answer({ headers }));
		const got = await createHttpTransport(platform.host).request({
			url: 'https://caldav.example.com/dav/',
		});
		headers.etag = '"two"';
		expect(got.headers).toEqual({ etag: '"one"' });
	});

	it.each([400, 401, 404, 500, 503])(
		'resolves for status %i',
		async (status) => {
			const platform = host(() => answer({ status }));
			const got = await createHttpTransport(platform.host).request({
				url: 'https://caldav.example.com/dav/',
			});
			expect(got.status).toBe(status);
		},
	);

	it('rejects where the platform fails', async () => {
		const transport = createHttpTransport(() =>
			Promise.reject(new Error('net::ERR_NAME_NOT_RESOLVED')),
		);
		await expect(
			transport.request({ url: 'https://caldav.example.com/dav/' }),
		).rejects.toThrow('net::ERR_NAME_NOT_RESOLVED');
	});
});
