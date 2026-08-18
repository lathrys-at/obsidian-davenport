/**
 * The runtime half of time discipline. Every time reading of the plugin must
 * come from the clock port, and in the tests the controlled clock answers
 * that port. This module replaces the ambient time functions with functions
 * that throw. A test that reads the wall clock therefore fails at the line
 * that reads it, and not on some later run where the wall clock gives a
 * different answer. The text below uses two terms: the poison is the
 * replacement function, and a spelling is the name that a caller writes to
 * reach the function.
 *
 * The poison covers three surfaces:
 *
 * - `Date.now`.
 * - The `Date` constructor with no argument, and `Date` called as a plain
 *   function. Both forms read the wall clock. `new Date(value)` keeps its
 *   behavior, because there the caller supplies the time.
 * - The ambient timers `setTimeout`, `setInterval`, and `setImmediate`. A
 *   timer reads the wall clock to find the moment to run its callback.
 *
 * The poison leaves the functions below as they are. `Date.UTC` and
 * `Date.parse` compute a time from the arguments of the caller, and they
 * read no clock. `clearTimeout` and `clearInterval` cancel a timer, and they
 * read no clock. `queueMicrotask` runs a callback after the current task,
 * and it has no delay to time. `performance.now` counts from the start of
 * the process, and vitest measures the duration of each test with it.
 *
 * The poison covers the global names that the fetch poison covers:
 * `globalThis`, `window`, `self`, and `global`. Under node all these names
 * resolve to one object, and one poison covers all of them. The module still
 * walks the names one by one, because an environment can give each name a
 * separate object. The module leaves a name alone when the name resolves to
 * nothing.
 *
 * The module defines each property, and does not assign to it. The module
 * keeps the property descriptor that it found, so that it can lift the
 * poison and put the original function back.
 *
 * The poison asks which code made the call. A call from a file of this
 * repository throws. A call from a file under `node_modules`, and a call
 * from a module of the node runtime, gets the real answer. The poison lets
 * these calls through, because the test runner and the test dependencies
 * read the wall clock in the same process as the tests:
 *
 * - vitest stamps the console output of a test with `Date.now`. A poison
 *   that refused that call would drop the output of every test that writes
 *   to the console.
 * - vitest reads `Date.now`, and it starts one ambient timer, when a test
 *   asks for fake timers.
 * - fast-check draws its seed from `Date.now` when the caller gives no seed.
 * - eslint, its plugins, and vitest itself read the wall clock while they
 *   load. A test that imports them cannot wrap that reading.
 *
 * The question is who made the call, and not what the call runs under. A
 * test that calls fast-check therefore passes, and that same test throws
 * where it reads the clock itself.
 */

/**
 * The names of the global objects that a caller can reach the ambient time
 * functions through, other than globalThis.
 */
const ALIAS_NAMES = ['window', 'self', 'global'] as const;

/** The ambient timer functions that the poison replaces. */
const TIMER_NAMES = ['setTimeout', 'setInterval', 'setImmediate'] as const;

/** A frame of a dependency. The pattern holds for both path separators. */
const DEPENDENCY_FRAME = /[/\\]node_modules[/\\]/;

/** The start of a frame of the node runtime, for example `node:internal/…`. */
const RUNTIME_FRAME = 'node:';

const CLOCK_REMEDY =
	'Read the time from the controlled clock in test/harness/clock.ts.';
const TIMER_REMEDY =
	'Make timers with the controlled clock in test/harness/clock.ts.';

/** The error that a poisoned time function throws. */
export class AmbientTimeError extends Error {
	/** The spelling that the caller used, for example `globalThis.Date.now`. */
	readonly spelling: string;

	constructor(spelling: string, remedy: string) {
		super(
			`${spelling} is blocked in the tests. ${remedy} A test that must read the real clock calls withRealTime, and that call states its reason.`,
		);
		this.name = 'AmbientTimeError';
		this.spelling = spelling;
	}
}

type Newable = abstract new (...args: never[]) => unknown;

interface PoisonedProperty {
	readonly target: object;
	readonly key: string;
	readonly original: PropertyDescriptor | undefined;
}

interface GlobalSpelling {
	readonly spelling: string;
	readonly target: object;
}

const refusals = new WeakSet();
const installed: PoisonedProperty[] = [];
let poisoned = false;
let exemptionDepth = 0;
let exemptionLiftedThePoison = false;

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

/**
 * Returns the location that a stack frame names, for example
 * `/home/user/repo/test/suite.test.ts:12:3`. Returns null for a frame that
 * names no location, such as `at Array.map (<anonymous>)`.
 */
function frameLocation(frame: string): string | null {
	const trimmed = frame.trim();
	if (!trimmed.startsWith('at ')) {
		return null;
	}
	const location = trimmed.endsWith(')')
		? trimmed.slice(trimmed.lastIndexOf('(') + 1, -1)
		: trimmed.slice(3);
	return location.includes(':') ? location : null;
}

/**
 * Returns true when a file of this repository made the call. The function
 * reads the first frame below `boundary` that names a location. The
 * `boundary` argument is the poison itself, so the stack starts at the
 * caller of the poison.
 *
 * The function returns false when no frame names a location. Such a stack is
 * no proof of a breach, and the runner must keep running.
 */
function callerIsRepositoryCode(
	boundary: (...args: never[]) => unknown,
): boolean {
	const holder = new Error();
	Error.captureStackTrace(holder, boundary);
	for (const frame of (holder.stack ?? '').split('\n').slice(1)) {
		const location = frameLocation(frame);
		if (location === null) {
			continue;
		}
		return (
			!DEPENDENCY_FRAME.test(location) &&
			!location.startsWith(RUNTIME_FRAME)
		);
	}
	return false;
}

/**
 * Throws when a file of this repository made the call. Returns without a
 * value when a dependency or the node runtime made the call.
 */
function refuse(
	spelling: string,
	remedy: string,
	boundary: (...args: never[]) => unknown,
): void {
	if (callerIsRepositoryCode(boundary)) {
		throw new AmbientTimeError(spelling, remedy);
	}
}

function poisonedNow(spelling: string, real: () => number): () => number {
	const read = (): number => {
		refuse(spelling, CLOCK_REMEDY, read);
		return real();
	};
	refusals.add(read);
	return read;
}

function poisonedTimer(
	spelling: string,
	real: (...args: unknown[]) => unknown,
): (...args: unknown[]) => unknown {
	const start = (...args: unknown[]): unknown => {
		refuse(spelling, TIMER_REMEDY, start);
		return real(...args);
	};
	refusals.add(start);
	return start;
}

function poisonedDate(
	real: DateConstructor,
	spelling: string,
): DateConstructor {
	function construct(
		target: DateConstructor,
		args: unknown[],
		newTarget: Newable,
	): object {
		if (args.length === 0) {
			refuse(`new ${spelling}.Date()`, CLOCK_REMEDY, construct);
		}
		const made: unknown = Reflect.construct(target, args, newTarget);
		return made as object;
	}
	// A call to Date as a plain function returns the time of the call, and it
	// ignores its arguments. This trap therefore refuses every such call.
	function apply(
		target: DateConstructor,
		thisArg: unknown,
		args: unknown[],
	): unknown {
		refuse(`${spelling}.Date()`, CLOCK_REMEDY, apply);
		return Reflect.apply(target, thisArg, args);
	}
	const proxy = new Proxy(real, { construct, apply });
	refusals.add(proxy);
	return proxy;
}

/**
 * Returns true when the property holds a live function that this module must
 * still replace. A property that holds the poison already, and a property
 * that this module replaced already, need no second replacement.
 */
function needsPoison(target: object, key: string, value: unknown): boolean {
	if (typeof value !== 'function' || refusals.has(value)) {
		return false;
	}
	return !installed.some(
		(entry) => entry.target === target && entry.key === key,
	);
}

function replace(target: object, key: string, value: unknown): void {
	const original = Object.getOwnPropertyDescriptor(target, key);
	installed.push({ target, key, original });
	Object.defineProperty(target, key, {
		value,
		writable: true,
		enumerable: original?.enumerable ?? true,
		configurable: true,
	});
}

/**
 * Installs the poison on each global object that does not hold the poison
 * already. The function poisons a property one time only. A second call
 * therefore cannot hide an original function behind a second layer of
 * poison. A second call is how a global object that appeared after the first
 * call gets the poison.
 */
export function poisonTime(): void {
	for (const { spelling, target } of spellings()) {
		const date: unknown = Reflect.get(target, 'Date');
		if (typeof date === 'function' && !refusals.has(date)) {
			const holder = date as DateConstructor;
			if (needsPoison(holder, 'now', holder.now)) {
				const real = holder.now.bind(holder);
				replace(
					holder,
					'now',
					poisonedNow(`${spelling}.Date.now`, real),
				);
			}
			if (needsPoison(target, 'Date', date)) {
				replace(target, 'Date', poisonedDate(holder, spelling));
			}
		}
		for (const name of TIMER_NAMES) {
			const timer: unknown = Reflect.get(target, name);
			if (needsPoison(target, name, timer)) {
				const real = timer as (...args: unknown[]) => unknown;
				replace(
					target,
					name,
					poisonedTimer(`${spelling}.${name}`, real.bind(target)),
				);
			}
		}
	}
	poisoned = true;
}

/**
 * Puts back each property that the poison replaced. Does nothing when no
 * property holds the poison.
 */
export function restoreTime(): void {
	if (!poisoned) {
		return;
	}
	for (const { target, key, original } of installed) {
		if (original === undefined) {
			Reflect.deleteProperty(target, key);
		} else {
			Object.defineProperty(target, key, original);
		}
	}
	installed.length = 0;
	poisoned = false;
}

function livesOutsideThePoison(value: unknown): boolean {
	return typeof value === 'function' && !refusals.has(value);
}

/**
 * Returns true when the poison is in place and no live ambient time function
 * survives anywhere. The check asks what a caller can reach. The check does
 * not ask what each global object holds.
 *
 * A test suite can put a stub object in `window` that holds no `Date` and no
 * timers. That stub opens no way to the wall clock. A spelling fails the
 * check only when the spelling holds a function that this module did not
 * make. That case is the reason for the check: it catches code that put a
 * working time function back after the poison went in.
 */
export function timePoisonHolds(): boolean {
	if (!poisoned) {
		return false;
	}
	return !spellings().some(({ target }) => {
		const date: unknown = Reflect.get(target, 'Date');
		if (livesOutsideThePoison(date)) {
			return true;
		}
		if (
			typeof date === 'function' &&
			livesOutsideThePoison(Reflect.get(date, 'now'))
		) {
			return true;
		}
		return TIMER_NAMES.some((name) =>
			livesOutsideThePoison(Reflect.get(target, name)),
		);
	});
}

function isPromiseLike(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	return typeof Reflect.get(value, 'then') === 'function';
}

/**
 * Runs `body` with the real time functions in place, and puts the poison
 * back afterwards. The `reason` argument states why this test must read the
 * real clock. The reason stands at the call, so that a reader of the test
 * sees the exception and the ground for it.
 *
 * The real time functions stay in place for the body of the call, and for
 * nothing else. The body must therefore run to its end without an await. A
 * body that returns a promise throws, because the poison would come back
 * while that promise was still pending.
 */
export function withRealTime<T>(reason: string, body: () => T): T {
	if (reason.trim().length === 0) {
		throw new Error(
			'withRealTime needs a reason. The reason tells a reader why this test reads the real clock.',
		);
	}
	if (exemptionDepth === 0) {
		exemptionLiftedThePoison = poisoned;
		restoreTime();
	}
	exemptionDepth += 1;
	try {
		const result = body();
		if (isPromiseLike(result)) {
			throw new Error(
				'withRealTime needs a body that runs to its end without an await. The poison comes back when the body returns.',
			);
		}
		return result;
	} finally {
		exemptionDepth -= 1;
		if (exemptionDepth === 0 && exemptionLiftedThePoison) {
			poisonTime();
		}
	}
}
