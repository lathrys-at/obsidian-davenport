import { describe, expect, it } from 'vitest';
import {
	NETWORK_SURFACES,
	evidence,
	evidenceStrings,
	networkCursor,
	type RunEvidence,
} from './evidence';

const SECRET = 'hunter2-app-specific-password';

/**
 * Makes a record that holds an extra surface. The walk knows nothing
 * about that surface.
 */
function extended(extra: Readonly<Record<string, unknown>>): RunEvidence {
	return Object.assign({}, evidence({ name: 'walk' }), extra);
}

function found(record: RunEvidence): Record<string, string> {
	return Object.fromEntries(
		evidenceStrings(record).map((entry) => [entry.where, entry.text]),
	);
}

describe('the evidence builder', () => {
	it('gives an empty value to each surface the caller does not give', () => {
		expect(evidence()).toEqual({
			name: 'unnamed run',
			caldav: { requests: [], scheduling: [] },
			feed: { requests: [] },
			vault: { changes: [], files: {} },
			vaultSync: { deliveries: [] },
			syncLog: [],
			network: { poisoned: true, attempts: [] },
			remoteObserved: [],
			secrets: [],
		});
	});

	it('reports whether the fetch poison holds in this process', () => {
		expect(evidence().network.poisoned).toBe(true);
	});
});

describe('network cursors', () => {
	it('count zero for each surface the caller does not give', () => {
		expect(networkCursor({ feed: 3 })).toEqual({ caldav: 0, feed: 3 });
	});

	// The vault-sync channel is evidence and not a network surface. A
	// delivery is a sync tool that moves a file, and not a request to a
	// server.
	it('cover every surface with requests to a server, and no others', () => {
		expect(NETWORK_SURFACES.map((surface) => surface.key)).toEqual([
			'caldav',
			'feed',
		]);
		expect(Object.keys(networkCursor())).toEqual(['caldav', 'feed']);
	});
});

describe('the evidence walk', () => {
	it('reaches a surface that the walk does not know about', () => {
		const record = extended({
			futureSurface: { entries: [{ note: SECRET }] },
		});
		expect(found(record)['futureSurface.entries[0].note']).toBe(SECRET);
	});

	it('reaches text inside a map, a set, and a URL', () => {
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

	it('does not reach text that is stored as numbers or bytes', () => {
		const record = extended({
			numberSurface: 1234,
			octetSurface: new TextEncoder().encode(SECRET),
		});
		expect(Object.keys(found(record))).toEqual(['name']);
	});

	it('reports one object at each position where the object sits', () => {
		const shared = { url: SECRET };
		const record = extended({ left: shared, right: shared });
		expect(Object.keys(found(record))).toEqual([
			'name',
			'left.url',
			'right.url',
		]);
	});

	it('stops when a surface points back at itself', () => {
		const loop: Record<string, unknown> = { note: SECRET };
		loop.self = loop;
		const record = extended({ loop });
		expect(found(record)['loop.note']).toBe(SECRET);
	});

	it('puts quotation marks around a key that is not a plain name', () => {
		const record = evidence({
			vault: { changes: [], files: { 'Events/one.md': SECRET } },
		});
		expect(found(record)['vault.files["Events/one.md"]']).toBe(SECRET);
	});
});
