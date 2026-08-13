import { afterEach, describe, expect, it } from 'vitest';
import {
	NetworkAccessError,
	clearFetchAttempts,
	fetchPoisonHolds,
	poisonFetch,
	recordedFetchAttempts,
	restoreFetch,
} from './fetch-poison';
import { runSimulation } from './run';

const ALIASES = ['window', 'self', 'global'] as const;

/**
 * Defines a global object under the given name, and returns a function that
 * puts the earlier value back. The new object holds `own` as its own fetch,
 * or holds no fetch when `own` is undefined. The poison walks the global
 * names, and the walk then meets a name that holds a separate object. Node
 * resolves every alias name to one global object, so without a separate
 * object a poison that covers only globalThis would pass these tests.
 */
function withAlias(name: string, own: (() => unknown) | undefined): () => void {
	const original = Object.getOwnPropertyDescriptor(globalThis, name);
	Object.defineProperty(globalThis, name, {
		value: own === undefined ? {} : { fetch: own },
		writable: true,
		enumerable: false,
		configurable: true,
	});
	return () => {
		if (original === undefined) {
			Reflect.deleteProperty(globalThis, name);
		} else {
			Object.defineProperty(globalThis, name, original);
		}
	};
}

/**
 * Returns the fetch that a caller reaches through the named global object.
 * A bare `fetch(…)` call reads this same property on the global object. The
 * lint rules forbid a bare `fetch(…)` call in every file of the repository.
 * These tests therefore read the property through `Reflect.get`.
 */
function fetchOf(name: string): unknown {
	const holder: unknown = Reflect.get(globalThis, name);
	return typeof holder === 'object' && holder !== null
		? Reflect.get(holder, 'fetch')
		: undefined;
}

function callFetchOf(name: string, input: unknown): void {
	const call = fetchOf(name);
	if (typeof call !== 'function') {
		throw new TypeError(`${name}.fetch is not a function`);
	}
	(call as (request: unknown) => never)(input);
}

function lastAttempt() {
	const attempts = recordedFetchAttempts();
	return attempts[attempts.length - 1];
}

afterEach(() => {
	// The setup file poisons the global objects one time for each test file.
	// A test in this file can lift the poison. This hook puts the poison
	// back, so that the tests after that test also run under the poison.
	poisonFetch();
	clearFetchAttempts();
});

describe('fetch poisoning', () => {
	it('is already in place before any test runs', () => {
		expect(fetchPoisonHolds()).toBe(true);
	});

	it('throws on a call through globalThis, and records the url', () => {
		expect(() => {
			callFetchOf(
				'globalThis',
				'https://caldav.davenport.test/calendars/alice/',
			);
		}).toThrow(NetworkAccessError);
		expect(lastAttempt()?.target).toBe(
			'https://caldav.davenport.test/calendars/alice/',
		);
	});

	it('reads the url from a URL and from an object with a url', () => {
		expect(() => {
			callFetchOf(
				'globalThis',
				new URL('https://feeds.davenport.test/team.ics'),
			);
		}).toThrow(NetworkAccessError);
		expect(() => {
			callFetchOf('globalThis', {
				url: 'https://feeds.davenport.test/other.ics',
			});
		}).toThrow(NetworkAccessError);
		expect(
			recordedFetchAttempts().map((attempt) => attempt.target),
		).toEqual([
			'https://feeds.davenport.test/team.ics',
			'https://feeds.davenport.test/other.ics',
		]);
	});

	it('reports that the poison cannot read a url from the argument', () => {
		expect(() => {
			callFetchOf('globalThis', 42);
		}).toThrow(/no url that the poison can read/);
	});

	it.each(ALIASES)('covers a separate object under %s', (name) => {
		restoreFetch();
		let reached = false;
		const remove = withAlias(name, () => {
			reached = true;
		});
		try {
			poisonFetch();
			expect(fetchPoisonHolds()).toBe(true);
			expect(() => {
				callFetchOf(name, 'https://caldav.davenport.test/');
			}).toThrow(NetworkAccessError);
			expect(lastAttempt()?.spelling).toBe(name);
			expect(reached).toBe(false);
		} finally {
			restoreFetch();
			remove();
		}
	});

	it('puts back the fetch of globalThis, and then reports no poison', () => {
		const poison = fetchOf('globalThis');
		restoreFetch();
		expect(fetchPoisonHolds()).toBe(false);
		expect(fetchOf('globalThis')).not.toBe(poison);
	});

	it('holds when a stub global object has no fetch at all', async () => {
		const remove = withAlias('window', undefined);
		try {
			expect(fetchPoisonHolds()).toBe(true);
			await expect(
				runSimulation({ name: 'stubbed' }, () => undefined),
			).resolves.toBeUndefined();
		} finally {
			remove();
		}
	});

	it('reports a breach when a stub global object brings a live fetch', () => {
		const remove = withAlias('window', () => undefined);
		try {
			expect(fetchPoisonHolds()).toBe(false);
			poisonFetch();
			expect(fetchPoisonHolds()).toBe(true);
		} finally {
			restoreFetch();
			remove();
		}
	});

	it('puts back the fetch of an alias, and leaves no poison behind', () => {
		restoreFetch();
		const remove = withAlias('window', () => undefined);
		try {
			const before = fetchOf('window');
			poisonFetch();
			expect(fetchOf('window')).not.toBe(before);
			restoreFetch();
			expect(fetchOf('window')).toBe(before);
		} finally {
			remove();
		}
	});

	it('does not put a second poison over the first', () => {
		const first = fetchOf('globalThis');
		poisonFetch();
		expect(fetchOf('globalThis')).toBe(first);
		restoreFetch();
		expect(fetchPoisonHolds()).toBe(false);
	});

	it('reports a breach when something replaces the fetch of globalThis', () => {
		const original = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
		Object.defineProperty(globalThis, 'fetch', {
			value: () => undefined,
			writable: true,
			enumerable: true,
			configurable: true,
		});
		try {
			expect(fetchPoisonHolds()).toBe(false);
		} finally {
			if (original !== undefined) {
				Object.defineProperty(globalThis, 'fetch', original);
			}
		}
	});
});
