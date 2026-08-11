import { describe, expect, it } from 'vitest';
import type { RequestLogEntry } from '../caldav-mock/observation';
import { evidence, evidenceStrings, type RunEvidence } from './evidence';
import { STANDING_SWEEPS } from './standing';
import type { Sweep } from './sweep';

const PASSWORD = 'hunter2-app-specific-password';

function standing(name: string): Sweep {
	const sweep = STANDING_SWEEPS.find((held) => held.name === name);
	if (!sweep) {
		throw new Error(`no standing sweep named ${name}`);
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
		status: 204,
		...patch,
	} satisfies RequestLogEntry;
}

function violations(sweep: Sweep, record: RunEvidence): string[] {
	return sweep
		.check(record)
		.map((found) => `${found.where}: ${found.detail}`);
}

describe('fetch-poison-active', () => {
	const sweep = standing('fetch-poison-active');

	it('holds on a run the poison covered', () => {
		expect(sweep.check(evidence())).toEqual([]);
	});

	it('objects when the poison was not in place', () => {
		const record = evidence({ network: { poisoned: false, attempts: [] } });
		expect(violations(sweep, record)).toEqual([
			'network.poisoned: global fetch was reachable during the run',
		]);
	});

	it('objects to every call the poison refused', () => {
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

	it('holds when the run registered nothing sensitive', () => {
		const record = evidence({
			vault: { events: [], files: { 'Events/one.md': PASSWORD } },
		});
		expect(sweep.check(record)).toEqual([]);
	});

	it('finds a planted value wherever in the evidence it landed', () => {
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
				events: [],
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

	it('never prints the value it found', () => {
		const record = evidence({
			secrets: [{ label: 'app password', value: PASSWORD }],
			vault: { events: [], files: { 'Events/one.md': PASSWORD } },
		});
		const printed = JSON.stringify(sweep.check(record));
		expect(printed).not.toContain(PASSWORD);
		expect(printed).toContain('app password');
	});

	it('does not match the registry of values against itself', () => {
		const record = evidence({
			secrets: [{ label: 'app password', value: PASSWORD }],
		});
		expect(sweep.check(record)).toEqual([]);
		expect(evidenceStrings(record).map((found) => found.where)).toEqual([
			'name',
		]);
	});

	it('finds a value embedded in longer text', () => {
		const record = evidence({
			secrets: [{ label: 'token', value: 'abc123' }],
			vault: {
				events: [],
				files: { 'note.md': 'bearer abc123 expires' },
			},
		});
		expect(violations(sweep, record)).toEqual([
			'vault.files["note.md"]: carries the value registered as "token"',
		]);
	});
});

describe('remote-observed-no-server-requests', () => {
	const sweep = standing('remote-observed-no-server-requests');

	it('holds on a run that opened no such stretch', () => {
		const record = evidence({
			caldav: { requests: [request(0), request(1)], scheduling: [] },
		});
		expect(sweep.check(record)).toEqual([]);
	});

	it('objects to a request issued inside one', () => {
		const record = evidence({
			caldav: { requests: [request(0), request(1)], scheduling: [] },
			remoteObserved: [
				{ label: 'a remote-observed tombstone', from: 1, to: 2 },
			],
		});
		expect(violations(sweep, record)).toEqual([
			'caldav.requests[1]: PUT /calendars/alice/work/1.ics was issued while processing a remote-observed tombstone',
		]);
	});

	it('ignores requests either side of the stretch', () => {
		const record = evidence({
			caldav: {
				requests: [request(0), request(1), request(2)],
				scheduling: [],
			},
			remoteObserved: [{ label: 'processing', from: 1, to: 1 }],
		});
		expect(sweep.check(record)).toEqual([]);
	});
});
