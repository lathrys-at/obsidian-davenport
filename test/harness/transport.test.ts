/**
 * The doubles of the transport port.
 *
 * A double answers a request or fails it, and it records what it received.
 * These cases state that contract, so a case that reads a recorded request
 * reads what the code under test really sent.
 */

import { describe, expect, it } from 'vitest';
import { FakeTransport, answerOf, refusingTransport } from './transport';

const ADDRESS = 'https://caldav.example.com/dav/';

describe('the answer of one specification', () => {
	it('takes the status 200 and an empty body where the caller states none', () => {
		const answer = answerOf({});
		expect(answer.status).toBe(200);
		expect(answer.text).toBe('');
		expect(answer.headers).toEqual({});
		expect(answer.arrayBuffer.byteLength).toBe(0);
	});

	it('carries the status, the headers, and the body', () => {
		const answer = answerOf({
			status: 207,
			headers: { 'content-type': 'application/xml' },
			text: '<multistatus/>',
		});
		expect(answer.status).toBe(207);
		expect(answer.headers).toEqual({ 'content-type': 'application/xml' });
		expect(answer.text).toBe('<multistatus/>');
	});

	it('writes the body as octets of UTF-8', () => {
		const answer = answerOf({ text: 'é' });
		expect(new Uint8Array(answer.arrayBuffer)).toEqual(
			new Uint8Array([0xc3, 0xa9]),
		);
	});
});

describe('the transport that answers from a rule', () => {
	it('records each request in order', async () => {
		const transport = new FakeTransport({});
		await transport.request({ url: ADDRESS, method: 'PROPFIND' });
		await transport.request({ url: `${ADDRESS}two`, method: 'REPORT' });
		expect(transport.requests.map((req) => req.method)).toEqual([
			'PROPFIND',
			'REPORT',
		]);
	});

	it('answers one specification to every request', async () => {
		const transport = new FakeTransport({ status: 404 });
		expect((await transport.request({ url: ADDRESS })).status).toBe(404);
		expect((await transport.request({ url: ADDRESS })).status).toBe(404);
	});

	it('answers from the request where the rule is a function', async () => {
		const transport = new FakeTransport((req) => ({
			status: req.method === 'PROPFIND' ? 207 : 405,
		}));
		expect(
			(await transport.request({ url: ADDRESS, method: 'PROPFIND' }))
				.status,
		).toBe(207);
		expect((await transport.request({ url: ADDRESS })).status).toBe(405);
	});

	it('fails the request where the rule states a failure', async () => {
		const transport = new FakeTransport({ fails: 'the network is down' });
		await expect(transport.request({ url: ADDRESS })).rejects.toThrow(
			'the network is down',
		);
	});

	it('records a request that it failed', async () => {
		const transport = new FakeTransport({ fails: 'the network is down' });
		await expect(transport.request({ url: ADDRESS })).rejects.toThrow();
		expect(transport.requests).toHaveLength(1);
	});
});

describe('the transport that refuses every request', () => {
	it('fails with the reason that the caller gave', async () => {
		await expect(
			refusingTransport('this test makes no request').request({
				url: ADDRESS,
			}),
		).rejects.toThrow('this test makes no request');
	});
});
