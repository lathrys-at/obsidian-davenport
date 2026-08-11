import { describe, expect, it } from 'vitest';
import {
	evidence,
	evidenceStrings,
	networkCursor,
	type RunEvidence,
} from './evidence';

const SECRET = 'hunter2-app-specific-password';

/** A record carrying a surface the walk was never told about. */
function extended(extra: Readonly<Record<string, unknown>>): RunEvidence {
	return Object.assign({}, evidence({ name: 'walk' }), extra);
}

function found(record: RunEvidence): Record<string, string> {
	return Object.fromEntries(
		evidenceStrings(record).map((entry) => [entry.where, entry.text]),
	);
}

describe('the evidence builder', () => {
	it('fills every surface the caller left out', () => {
		expect(evidence()).toEqual({
			name: 'unnamed run',
			caldav: { requests: [], scheduling: [] },
			feed: { requests: [] },
			vault: { changes: [], files: {} },
			syncLog: [],
			network: { poisoned: true, attempts: [] },
			remoteObserved: [],
			secrets: [],
		});
	});

	it('reports the poison as the process actually stands', () => {
		expect(evidence().network.poisoned).toBe(true);
	});
});

describe('network cursors', () => {
	it('count zero for a surface the caller left out', () => {
		expect(networkCursor({ feed: 3 })).toEqual({ caldav: 0, feed: 3 });
	});
});

describe('the evidence walk', () => {
	it('reaches a surface added after it was written', () => {
		const record = extended({
			futureSurface: { entries: [{ note: SECRET }] },
		});
		expect(found(record)['futureSurface.entries[0].note']).toBe(SECRET);
	});

	it('reaches text held in a map, a set, and a URL', () => {
		const record = extended({
			mapSurface: new Map([['token', SECRET]]),
			setSurface: new Set([SECRET]),
			urlSurface: new URL(`https://alice:${SECRET}@caldav.test/`),
		});
		const strings = found(record);
		expect(strings['mapSurface.token']).toBe(SECRET);
		expect(strings['setSurface[0]']).toBe(SECRET);
		expect(strings.urlSurface).toContain(SECRET);
	});

	it('does not reach text encoded as numbers or octets', () => {
		const record = extended({
			numberSurface: 1234,
			octetSurface: new TextEncoder().encode(SECRET),
		});
		expect(Object.keys(found(record))).toEqual(['name']);
	});

	it('reports one object at every position it is reachable from', () => {
		const shared = { url: SECRET };
		const record = extended({ left: shared, right: shared });
		expect(Object.keys(found(record))).toEqual([
			'name',
			'left.url',
			'right.url',
		]);
	});

	it('terminates on a surface that points back at itself', () => {
		const loop: Record<string, unknown> = { note: SECRET };
		loop.self = loop;
		const record = extended({ loop });
		expect(found(record)['loop.note']).toBe(SECRET);
	});

	it('spells an awkward key so a reader can find it', () => {
		const record = evidence({
			vault: { changes: [], files: { 'Events/one.md': SECRET } },
		});
		expect(found(record)['vault.files["Events/one.md"]']).toBe(SECRET);
	});
});
