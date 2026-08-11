/**
 * The runtime half of network discipline: global fetch is replaced with a
 * thrower, so any call that does not go through the transport port fails
 * where it is written rather than in the field on a mobile device.
 *
 * A call reaches fetch by whatever name the global object answers to —
 * bare, or through `globalThis`, `window`, `self`, or `global` — so the
 * poison covers every one of those names that resolves to an object. Under
 * node they all resolve to the same object and poisoning it once covers
 * them all; the walk is what makes that true rather than assumed, and what
 * covers an environment where the names are separate objects. Names that
 * resolve to nothing are left alone: fabricating a `window` would tell
 * every library that feature-detects one that it is running in a browser.
 *
 * The property is defined rather than assigned so a frozen or accessor
 * fetch is covered too, and the original descriptor is kept so the poison
 * can be lifted and put back.
 */

const FETCH_KEY = 'fetch';

/** Global names a caller could reach fetch through, besides globalThis. */
const ALIAS_NAMES = ['window', 'self', 'global'] as const;

/** A call the poison refused, in the order the calls were made. */
export interface FetchAttempt {
	/** The global the call came through. */
	readonly spelling: string;
	/** The request the caller asked for, as far as it can be read. */
	readonly target: string;
}

/** What a poisoned fetch throws. */
export class NetworkAccessError extends Error {
	constructor(attempt: FetchAttempt) {
		super(
			`${attempt.spelling}.fetch is poisoned in tests: ${attempt.target} must go through the transport port`,
		);
		this.name = 'NetworkAccessError';
	}
}

interface PoisonedTarget {
	readonly target: object;
	readonly original: PropertyDescriptor | undefined;
}

const throwers = new WeakSet();
const attempts: FetchAttempt[] = [];
let poisoned: PoisonedTarget[] | null = null;

interface GlobalSpelling {
	readonly spelling: string;
	readonly target: object;
}

function spellings(): GlobalSpelling[] {
	const found: GlobalSpelling[] = [
		{ spelling: 'globalThis', target: globalThis },
	];
	for (const name of ALIAS_NAMES) {
		const value: unknown = Reflect.get(globalThis, name);
		if (typeof value === 'object' && value !== null) {
			found.push({ spelling: name, target: value });
		}
	}
	return found;
}

function describeTarget(input: unknown): string {
	if (typeof input === 'string') {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	if (typeof input === 'object' && input !== null && 'url' in input) {
		const url: unknown = Reflect.get(input, 'url');
		if (typeof url === 'string') {
			return url;
		}
	}
	return 'a request with no readable url';
}

function thrower(spelling: string): () => never {
	const refuse = (input?: unknown): never => {
		const attempt: FetchAttempt = {
			spelling,
			target: describeTarget(input),
		};
		attempts.push(attempt);
		throw new NetworkAccessError(attempt);
	};
	throwers.add(refuse);
	return refuse;
}

/**
 * Installs the poison. Calling it again while it is installed changes
 * nothing, so a setup file that runs more than once cannot lose the
 * original fetch behind a second layer of poison.
 */
export function poisonFetch(): void {
	if (poisoned !== null) {
		return;
	}
	const covered = new Set<object>();
	const installed: PoisonedTarget[] = [];
	for (const { spelling, target } of spellings()) {
		if (covered.has(target)) {
			continue;
		}
		covered.add(target);
		installed.push({
			target,
			original: Object.getOwnPropertyDescriptor(target, FETCH_KEY),
		});
		Object.defineProperty(target, FETCH_KEY, {
			value: thrower(spelling),
			writable: true,
			enumerable: true,
			configurable: true,
		});
	}
	poisoned = installed;
}

/** Puts back what was there before. Does nothing when nothing is poisoned. */
export function restoreFetch(): void {
	if (poisoned === null) {
		return;
	}
	for (const { target, original } of poisoned) {
		if (original === undefined) {
			Reflect.deleteProperty(target, FETCH_KEY);
		} else {
			Object.defineProperty(target, FETCH_KEY, original);
		}
	}
	poisoned = null;
}

/**
 * Whether every reachable spelling of fetch is a thrower right now. This is
 * the question a run asks, rather than whether the poison was installed:
 * code that replaced fetch after installation is exactly what the check is
 * for.
 */
export function fetchPoisonHolds(): boolean {
	if (poisoned === null) {
		return false;
	}
	return spellings().every(({ target }) => {
		const value: unknown = Reflect.get(target, FETCH_KEY);
		return typeof value === 'function' && throwers.has(value);
	});
}

/** Every call the poison has refused since the process started. */
export function recordedFetchAttempts(): readonly FetchAttempt[] {
	return attempts;
}

export function clearFetchAttempts(): void {
	attempts.length = 0;
}
