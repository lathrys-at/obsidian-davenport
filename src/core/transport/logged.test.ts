/**
 * The transport that writes one log entry for each request.
 *
 * The point of these cases is what an entry holds and what an entry never
 * holds. The log reaches the sync activity view, and a user reads it. A
 * header of a request carries the credential of that user. A body carries
 * the calendar of that user. A message of a server carries whatever the
 * server wrote. None of the three reaches an entry.
 */

import { describe, expect, it } from 'vitest';
import { ControlledClock } from '../../../test/harness/clock';
import { FakeTransport } from '../../../test/harness/transport';
import type { Logger, SyncLogEntry } from '../ports/logger';
import { loggedAddress, loggedTransport, outcomeOf } from './logged';

const ADDRESS = 'https://caldav.example.com/dav/principals/user/';

/** A transport that logs, with the entries and the clock that a case reads. */
function logging(
	transport: FakeTransport,
	step = 0,
): {
	readonly request: (url?: string, method?: string) => Promise<unknown>;
	readonly entries: SyncLogEntry[];
	readonly clock: ControlledClock;
} {
	const entries: SyncLogEntry[] = [];
	const logger: Logger = {
		log: (entry) => {
			entries.push(entry);
		},
	};
	const clock = new ControlledClock({ start: 0 });
	const stepping = {
		now: () => {
			const at = clock.now();
			clock.advance(step);
			return at;
		},
		after: clock.after.bind(clock),
		every: clock.every.bind(clock),
	};
	const logged = loggedTransport({ transport, logger, clock: stepping });
	return {
		request: (url = ADDRESS, method = 'PROPFIND') =>
			logged.request({ url, method }),
		entries,
		clock,
	};
}

describe('the entry of one request', () => {
	it('states the method, the address, the status, and the time', async () => {
		const run = logging(new FakeTransport({ status: 207 }), 12);
		await run.request();
		expect(run.entries).toEqual([
			{
				time: expect.any(Number) as number,
				action: 'PROPFIND',
				item: ADDRESS,
				outcome: 'success',
				reason: 'status 207, 12 ms',
			},
		]);
	});

	it('reads the time from the clock port', async () => {
		const run = logging(new FakeTransport({}), 5);
		await run.request();
		expect(run.entries[0]?.time).toBe(5);
	});

	it('takes GET where the request names no method', async () => {
		const transport = new FakeTransport({});
		const entries: SyncLogEntry[] = [];
		const logged = loggedTransport({
			transport,
			logger: {
				log: (entry) => {
					entries.push(entry);
				},
			},
			clock: new ControlledClock(),
		});
		await logged.request({ url: ADDRESS });
		expect(entries[0]?.action).toBe('GET');
	});

	it('states one entry for one request', async () => {
		const run = logging(new FakeTransport({}));
		await run.request();
		await run.request();
		expect(run.entries).toHaveLength(2);
	});

	it('holds no header, no body, and no word of the server', async () => {
		const transport = new FakeTransport({
			status: 401,
			headers: {
				'www-authenticate': 'Basic realm="the realm of the server"',
			},
			text: 'the server says that the password is wrong',
		});
		const entries: SyncLogEntry[] = [];
		const logged = loggedTransport({
			transport,
			logger: {
				log: (entry) => {
					entries.push(entry);
				},
			},
			clock: new ControlledClock(),
		});
		await logged.request({
			url: ADDRESS,
			method: 'PROPFIND',
			headers: { authorization: 'Basic dXNlcjpwYXNzd29yZA==' },
			body: '<propfind/>',
		});
		const written = JSON.stringify(entries);
		expect(written).not.toContain('dXNlcjpwYXNzd29yZA');
		expect(written).not.toContain('propfind/');
		expect(written).not.toContain('realm');
		expect(written).not.toContain('the server says');
	});
});

describe('the answer that the transport passes through', () => {
	it('gives the answer of the transport back unchanged', async () => {
		const transport = new FakeTransport({ status: 207, text: '<ms/>' });
		const entries: SyncLogEntry[] = [];
		const logged = loggedTransport({
			transport,
			logger: {
				log: (entry) => {
					entries.push(entry);
				},
			},
			clock: new ControlledClock(),
		});
		const answer = await logged.request({ url: ADDRESS });
		expect(answer.status).toBe(207);
		expect(answer.text).toBe('<ms/>');
	});

	it('writes an entry and rejects where the transport fails', async () => {
		const run = logging(
			new FakeTransport({ fails: 'net::ERR_NAME_NOT_RESOLVED' }),
			7,
		);
		await expect(run.request()).rejects.toThrow(
			'net::ERR_NAME_NOT_RESOLVED',
		);
		expect(run.entries[0]).toMatchObject({
			outcome: 'failed',
			reason: 'no answer, 7 ms',
		});
	});

	it('holds no word of the failure of the platform', async () => {
		const run = logging(
			new FakeTransport({ fails: 'net::ERR_NAME_NOT_RESOLVED' }),
		);
		await expect(run.request()).rejects.toThrow();
		expect(JSON.stringify(run.entries)).not.toContain('ERR_NAME');
	});
});

describe('the address that an entry states', () => {
	it('leaves out the query text', () => {
		expect(loggedAddress('https://a.test/dav/?token=secret-value')).toBe(
			'https://a.test/dav/',
		);
	});

	it('leaves out the fragment', () => {
		expect(loggedAddress('https://a.test/dav/#part')).toBe(
			'https://a.test/dav/',
		);
	});

	it('leaves out a username and a password of the address', () => {
		expect(loggedAddress('https://user:password@a.test/dav/')).toBe(
			'https://a.test/dav/',
		);
	});

	it('keeps the path', () => {
		expect(loggedAddress('https://a.test/dav/calendars/user/home/')).toBe(
			'https://a.test/dav/calendars/user/home/',
		);
	});

	it('keeps the port', () => {
		expect(loggedAddress('https://a.test:8443/dav/')).toBe(
			'https://a.test:8443/dav/',
		);
	});

	it('cuts an address that states no host at the query text', () => {
		expect(loggedAddress('/dav/?token=secret-value')).toBe('/dav/');
	});
});

describe('the outcome of one status', () => {
	it.each([
		[200, 'success'],
		[207, 'success'],
		[301, 'success'],
		[400, 'refused'],
		[401, 'refused'],
		[404, 'refused'],
		[499, 'refused'],
		[500, 'failed'],
		[503, 'failed'],
		[100, 'failed'],
	])('states %i as %s', (status, outcome) => {
		expect(outcomeOf(status)).toBe(outcome);
	});
});
