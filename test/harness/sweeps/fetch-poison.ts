/**
 * The runtime half of network discipline. Every network call of the plugin
 * must go through the transport port. This module replaces the global fetch
 * with a function that throws. A call that does not go through the
 * transport port therefore fails in the test that makes the call, and not
 * later in the field, on the mobile device of a user. The text below uses
 * two terms: the poison is the replacement function, and a spelling is the
 * name of a global object that a caller can reach fetch through.
 *
 * A caller reaches fetch through whatever name the global object answers
 * to: a bare `fetch(…)` call, or `globalThis`, `window`, `self`, or
 * `global`. The poison covers each of these names that resolves to an
 * object. Under node, all these names resolve to one object, and one poison
 * covers all of them. The module still walks the names one by one. The walk
 * makes the coverage a fact and not an assumption, and the walk also covers
 * an environment that gives each name a separate object. The module leaves a
 * name alone when the name resolves to nothing: an invented `window` object
 * would tell every library that tests for `window` that the library runs in
 * a browser.
 *
 * The module defines the fetch property, and does not assign to it. A
 * frozen fetch and an accessor fetch therefore also get the poison. The
 * module keeps the property descriptor that it found, so that it can lift
 * the poison and put the original fetch back.
 *
 * Three guards hold the network ban, and this guard is the only complete
 * one. The other two guards are a lint rule and a scan over the bundle.
 * These two guards read the property name from the source text. These two
 * guards therefore answer for the spellings that a reader sees, and they
 * cannot answer for a property name that code holds in a variable. This
 * guard replaces the property itself, so this guard answers for every
 * spelling at once: a call arrives at the poison whatever name the caller
 * wrote. Each use below writes the 'fetch' key out in full, and no constant
 * holds the key. Such a constant would be an example of the one form that
 * the two static guards cannot see, and the repository must not hold that
 * example.
 */

/**
 * The names of the global objects that a caller can reach fetch through,
 * other than globalThis.
 */
const ALIAS_NAMES = ['window', 'self', 'global'] as const;

/**
 * One call that the poison refused. `recordedFetchAttempts` returns these
 * records in the order in which the calls happened.
 */
export interface FetchAttempt {
	/** The name of the global object that the call came through. */
	readonly spelling: string;
	/**
	 * The request that the caller asked for. The value is the url when the
	 * poison can read a url from the argument. When the poison cannot read
	 * a url, the value says so.
	 */
	readonly target: string;
}

/** The error that a poisoned fetch throws. */
export class NetworkAccessError extends Error {
	constructor(attempt: FetchAttempt) {
		super(
			`${attempt.spelling}.fetch is blocked in the tests. The call asked for ${attempt.target}. Send the request through the transport port.`,
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
	return 'a request with no url that the poison can read';
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
 * Installs the poison on each global object that does not hold the poison
 * already. The function poisons a target one time only. A second call
 * therefore cannot hide the original fetch behind a second layer of poison.
 * A second call is how a global object that appeared after the first call
 * gets the poison.
 */
export function poisonFetch(): void {
	const installed = poisoned ?? [];
	const covered = new Set(installed.map((entry) => entry.target));
	for (const { spelling, target } of spellings()) {
		if (covered.has(target)) {
			continue;
		}
		covered.add(target);
		installed.push({
			target,
			original: Object.getOwnPropertyDescriptor(target, 'fetch'),
		});
		Object.defineProperty(target, 'fetch', {
			value: thrower(spelling),
			writable: true,
			enumerable: true,
			configurable: true,
		});
	}
	poisoned = installed;
}

/**
 * Puts back the fetch property that each poisoned global object held
 * before. Does nothing when no global object holds the poison.
 */
export function restoreFetch(): void {
	if (poisoned === null) {
		return;
	}
	for (const { target, original } of poisoned) {
		if (original === undefined) {
			Reflect.deleteProperty(target, 'fetch');
		} else {
			Object.defineProperty(target, 'fetch', original);
		}
	}
	poisoned = null;
}

/**
 * Returns true when the poison is in place and no live fetch survives
 * anywhere. The check asks what a caller can reach. The check does not ask
 * what each global object holds.
 *
 * A test suite can put a stub object in `window` that holds no fetch. That
 * stub opens no way to the network, and a report of a breach would accuse
 * the suite of a network call that the suite never made. A spelling fails
 * the check only when the spelling holds a function that this module did
 * not make. That case is the reason for the check: it catches code that put
 * a working fetch back after the poison went in.
 */
export function fetchPoisonHolds(): boolean {
	if (poisoned === null) {
		return false;
	}
	return !spellings().some(({ target }) => {
		const value: unknown = Reflect.get(target, 'fetch');
		return typeof value === 'function' && !throwers.has(value);
	});
}

/**
 * Returns the calls that the poison refused. The list holds each refused
 * call since the process started, or since the last call to
 * `clearFetchAttempts`.
 */
export function recordedFetchAttempts(): readonly FetchAttempt[] {
	return attempts;
}

/** Empties the list of refused calls. */
export function clearFetchAttempts(): void {
	attempts.length = 0;
}
