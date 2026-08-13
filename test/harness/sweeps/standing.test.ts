import { describe, expect, it } from 'vitest';
import type { RequestLogEntry } from '../caldav-mock/observation';
import type { FeedRequestRecord } from '../feed-fixture/server';
import type { LandedDelivery } from '../vault-sync/types';
import {
	evidence,
	evidenceStrings,
	networkCursor,
	type RunEvidence,
} from './evidence';
import { STANDING_SWEEPS } from './standing';
import type { Sweep } from './sweep';

const PASSWORD = 'hunter2-app-specific-password';

function standing(name: string): Sweep {
	const sweep = STANDING_SWEEPS.find((held) => held.name === name);
	if (!sweep) {
		throw new Error(
			`no standing sweep has the name ${name}; add the sweep to STANDING_SWEEPS or correct the name`,
		);
	}
	return sweep;
}

function request(index: number, patch: Partial<RequestLogEntry> = {}) {
	return {
		index,
		method: 'PUT',
		url: `https://caldav.davenport.test/calendars/alice/work/${String(index)}.ics`,
		path: `/calendars/alice/work/${String(index)}.ics`,
		depth: null,
		ifMatch: null,
		ifNoneMatch: null,
		report: null,
		syncToken: null,
		headers: {},
		body: '',
		bodyTruncated: false,
		status: 204,
		...patch,
	} satisfies RequestLogEntry;
}

/**
 * Makes a delivery that landed. The delivery carries the given file
 * content from one device to a peer device.
 */
function delivery(content: string) {
	return {
		delivery: {
			id: 1,
			from: 'laptop',
			to: 'phone',
			change: { kind: 'upsert', path: 'Events/one.md', content },
			previousContent: null,
			version: { laptop: 1 },
			modifiedAt: 0,
			preserveModifiedAt: true,
			conflictCopy: false,
		},
		outcome: 'created',
		conflictPath: null,
		modifiedAt: 0,
	} satisfies LandedDelivery;
}

function poll(index: number) {
	return {
		url: `https://feeds.davenport.test/${String(index)}.ics`,
		method: 'GET',
		status: 200,
		poll: index + 1,
	} satisfies FeedRequestRecord;
}

function violations(sweep: Sweep, record: RunEvidence): string[] {
	return sweep
		.check(record)
		.map((found) => `${found.where}: ${found.detail}`);
}

describe('fetch-poison-active', () => {
	const sweep = standing('fetch-poison-active');

	it('reports no violation when the fetch poison held for the full run', () => {
		expect(sweep.check(evidence())).toEqual([]);
	});

	it('reports a violation when the fetch poison did not hold', () => {
		const record = evidence({ network: { poisoned: false, attempts: [] } });
		expect(violations(sweep, record)).toEqual([
			'network.poisoned: global fetch was reachable during the run',
		]);
	});

	it('reports one violation for each call that the fetch poison refused', () => {
		const record = evidence({
			network: {
				poisoned: true,
				attempts: [
					{ spelling: 'globalThis', target: 'https://a.test/' },
					{ spelling: 'window', target: 'https://b.test/' },
				],
			},
		});
		expect(violations(sweep, record)).toEqual([
			'network.attempts[0]: globalThis.fetch was called for https://a.test/',
			'network.attempts[1]: window.fetch was called for https://b.test/',
		]);
	});
});

describe('secrets-scan', () => {
	const sweep = standing('secrets-scan');

	it('reports no violation when the run registered no sensitive value', () => {
		const record = evidence({
			vault: { changes: [], files: { 'Events/one.md': PASSWORD } },
		});
		expect(sweep.check(record)).toEqual([]);
	});

	it('finds a registered value at every position that holds the value', () => {
		const record = evidence({
			secrets: [{ label: 'app password', value: PASSWORD }],
			caldav: {
				requests: [
					request(0, {
						url: `https://alice:${PASSWORD}@caldav.test/`,
					}),
				],
				scheduling: [],
			},
			vault: {
				changes: [],
				files: { 'Events/one.md': `---\npassword: ${PASSWORD}\n---\n` },
			},
			syncLog: [
				{
					time: 0,
					action: 'push',
					outcome: 'failed',
					reason: `rejected ${PASSWORD}`,
				},
			],
		});
		expect(violations(sweep, record)).toEqual([
			'caldav.requests[0].url: carries the value registered as "app password"',
			'vault.files["Events/one.md"]: carries the value registered as "app password"',
			'syncLog[0].reason: carries the value registered as "app password"',
		]);
	});

	it('names the label of the value and never prints the value itself', () => {
		const record = evidence({
			secrets: [{ label: 'app password', value: PASSWORD }],
			vault: { changes: [], files: { 'Events/one.md': PASSWORD } },
		});
		const printed = JSON.stringify(sweep.check(record));
		expect(printed).not.toContain(PASSWORD);
		expect(printed).toContain('app password');
	});

	it('does not scan the registry of sensitive values', () => {
		const record = evidence({
			secrets: [{ label: 'app password', value: PASSWORD }],
		});
		expect(sweep.check(record)).toEqual([]);
		expect(evidenceStrings(record).map((found) => found.where)).toEqual([
			'name',
		]);
	});

	it('finds a registered value inside a longer piece of text', () => {
		const record = evidence({
			secrets: [{ label: 'token', value: 'abc123' }],
			vault: {
				changes: [],
				files: { 'note.md': 'bearer abc123 expires' },
			},
		});
		expect(violations(sweep, record)).toEqual([
			'vault.files["note.md"]: carries the value registered as "token"',
		]);
	});

	it('finds a registered value in a request body and in a request header', () => {
		const record = evidence({
			secrets: [{ label: 'app password', value: PASSWORD }],
			caldav: {
				requests: [
					request(0, {
						body: `DESCRIPTION:${PASSWORD}\r\n`,
						headers: { authorization: `Basic ${PASSWORD}` },
					}),
				],
				scheduling: [],
			},
		});
		expect(violations(sweep, record)).toEqual([
			'caldav.requests[0].headers.authorization: carries the value registered as "app password"',
			'caldav.requests[0].body: carries the value registered as "app password"',
		]);
	});

	it('finds a registered value in a file that the sync channel carried to a peer', () => {
		const record = evidence({
			secrets: [{ label: 'app password', value: PASSWORD }],
			vaultSync: { deliveries: [delivery(PASSWORD)] },
		});
		expect(violations(sweep, record)).toEqual([
			'vaultSync.deliveries[0].delivery.change.content: carries the value registered as "app password"',
		]);
	});

	it('finds a registered value in a note that the run wrote and then deleted', () => {
		const record = evidence({
			secrets: [{ label: 'app password', value: PASSWORD }],
			vault: {
				changes: [
					{
						kind: 'created',
						path: 'Events/one.md',
						oldPath: null,
						content: PASSWORD,
					},
					{
						kind: 'deleted',
						path: 'Events/one.md',
						oldPath: null,
						content: null,
					},
				],
				files: {},
			},
		});
		expect(violations(sweep, record)).toEqual([
			'vault.changes[0].content: carries the value registered as "app password"',
		]);
	});
});

describe('remote-observed-no-server-requests', () => {
	const sweep = standing('remote-observed-no-server-requests');

	it('reports no violation when the run recorded no remote-observed stretch', () => {
		const record = evidence({
			caldav: { requests: [request(0), request(1)], scheduling: [] },
		});
		expect(sweep.check(record)).toEqual([]);
	});

	it('reports a violation when the run sent a calendar request inside a stretch', () => {
		const record = evidence({
			caldav: { requests: [request(0), request(1)], scheduling: [] },
			remoteObserved: [
				{
					label: 'a remote-observed tombstone',
					from: networkCursor({ caldav: 1 }),
					to: networkCursor({ caldav: 2 }),
				},
			],
		});
		expect(violations(sweep, record)).toEqual([
			'caldav.requests[1]: PUT /calendars/alice/work/1.ics was issued while processing a remote-observed tombstone',
		]);
	});

	it('reports a violation when the run polled a feed inside a stretch', () => {
		const record = evidence({
			feed: { requests: [poll(0), poll(1)] },
			remoteObserved: [
				{
					label: 'a remote-observed tombstone',
					from: networkCursor({ feed: 1 }),
					to: networkCursor({ feed: 2 }),
				},
			],
		});
		expect(violations(sweep, record)).toEqual([
			'feed.requests[1]: GET https://feeds.davenport.test/1.ics was issued while processing a remote-observed tombstone',
		]);
	});

	it('reports a violation on every surface that one stretch spans', () => {
		const record = evidence({
			caldav: { requests: [request(0)], scheduling: [] },
			feed: { requests: [poll(0)] },
			remoteObserved: [
				{
					label: 'processing',
					from: networkCursor(),
					to: networkCursor({ caldav: 1, feed: 1 }),
				},
			],
		});
		expect(
			violations(sweep, record).map((line) => line.split(':')[0]),
		).toEqual(['caldav.requests[0]', 'feed.requests[0]']);
	});

	it('reports no violation for the requests before and after a stretch', () => {
		const record = evidence({
			caldav: {
				requests: [request(0), request(1), request(2)],
				scheduling: [],
			},
			feed: { requests: [poll(0)] },
			remoteObserved: [
				{
					label: 'processing',
					from: networkCursor({ caldav: 1 }),
					to: networkCursor({ caldav: 1 }),
				},
			],
		});
		expect(sweep.check(record)).toEqual([]);
	});

	it('reports no violation for deliveries that the sync channel made inside a stretch', () => {
		const record = evidence({
			vaultSync: { deliveries: [delivery('note text')] },
			remoteObserved: [
				{
					label: 'processing',
					from: networkCursor(),
					to: networkCursor({ caldav: 9, feed: 9 }),
				},
			],
		});
		expect(sweep.check(record)).toEqual([]);
	});

	it('stops at the last request of a surface when the cursor points past the end', () => {
		const record = evidence({
			caldav: { requests: [request(0)], scheduling: [] },
			remoteObserved: [
				{
					label: 'processing',
					from: networkCursor(),
					to: networkCursor({ caldav: 9 }),
				},
			],
		});
		expect(violations(sweep, record)).toHaveLength(1);
	});
});
