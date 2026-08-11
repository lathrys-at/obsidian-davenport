import { afterEach, describe, expect, it } from 'vitest';
import {
	NetworkAccessError,
	clearFetchAttempts,
	fetchPoisonHolds,
	poisonFetch,
	recordedFetchAttempts,
	restoreFetch,
} from './fetch-poison';

const ALIASES = ['window', 'self', 'global'] as const;

/**
 * Installs an alias of the given name holding its own fetch, so the walk
 * meets a spelling that is a separate object. Node resolves every alias to
 * one global, which would let a poison that covers only globalThis pass.
 */
function withAlias(name: string, own: () => unknown): () => void {
	const original = Object.getOwnPropertyDescriptor(globalThis, name);
	Object.defineProperty(globalThis, name, {
		value: { fetch: own },
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
 * The fetch a caller would reach through the named global. A bare `fetch(…)`
 * resolves this same property on the global object, and the lint rules bar
 * that spelling from being written anywhere in the repository, so the tests
 * reach it this way.
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
		throw new TypeError(`${name}.fetch is not callable`);
	}
	(call as (request: unknown) => never)(input);
}

function lastAttempt() {
	const attempts = recordedFetchAttempts();
	return attempts[attempts.length - 1];
}

afterEach(() => {
	// The setup file poisons once per test file; a test that lifted the
	// poison puts it back so the tests after it run under it.
	poisonFetch();
	clearFetchAttempts();
});

describe('fetch poisoning', () => {
	it('is already in place before any test runs', () => {
		expect(fetchPoisonHolds()).toBe(true);
	});

	it('throws where a bare call would, naming what was asked for', () => {
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

	it('reads the url off a URL and off a request-shaped argument', () => {
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

	it('names an argument it cannot read a url from', () => {
		expect(() => {
			callFetchOf('globalThis', 42);
		}).toThrow(/no readable url/);
	});

	it.each(ALIASES)('covers %s when it is its own object', (name) => {
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

	it('puts back the fetch it found, and reports itself lifted', () => {
		const poison = fetchOf('globalThis');
		restoreFetch();
		expect(fetchPoisonHolds()).toBe(false);
		expect(fetchOf('globalThis')).not.toBe(poison);
	});

	it('leaves an alias without its own fetch alone once restored', () => {
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

	it('does not stack a second poison over the first', () => {
		const first = fetchOf('globalThis');
		poisonFetch();
		expect(fetchOf('globalThis')).toBe(first);
		restoreFetch();
		expect(fetchPoisonHolds()).toBe(false);
	});

	it('reports itself broken when something replaces fetch', () => {
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
