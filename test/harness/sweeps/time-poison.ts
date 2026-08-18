/**
 * The runtime half of time discipline. Every reading of the clock in the
 * plugin must come from the clock port, and in the tests the controlled clock
 * answers that port. This module replaces the ambient time functions with
 * functions that throw. A test that reads the wall clock therefore fails at
 * the line that reads the clock. It does not fail later, on a run where the
 * wall clock gives a different answer. The text below uses two terms: the
 * poison is the replacement function, and a spelling is the name that a
 * caller writes to reach the function.
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
 * The ban covers the ordinary spellings, and it does not cover every path to
 * the wall clock. `performance.timeOrigin` plus `performance.now` gives the
 * wall clock. `new Intl.DateTimeFormat().format()` with no argument reads the
 * wall clock through an intrinsic that no property replacement reaches. Both
 * paths stay outside the ban.
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
 * The poison asks which code made the call, and it answers from the path in
 * the first stack frame below the poison:
 *
 * - A path inside the repository root is repository code, and the call
 *   throws. The repository root is the first directory above this file that
 *   holds a package.json file.
 * - A path inside the `node_modules` directory of the repository root is
 *   dependency code, and the call gets the real answer.
 * - A path outside the repository root is not repository code, and the call
 *   gets the real answer. This branch takes in everything that the two rules
 *   above do not name, and the poison permits it. A module name that starts
 *   with `node:` is a module of the node runtime, and the call gets the real
 *   answer.
 *
 * A directory named `node_modules` deeper in the repository does not make the
 * files inside it dependency code. A fixture tree can hold such a directory,
 * and the code in it stays under the ban.
 *
 * A frame that names no path decides nothing, and the walk reads the next
 * frame. A frame that holds a path that the poison cannot read makes the
 * poison refuse, because that path could name a file of this repository. The
 * poison also refuses when no frame in the stack names a path.
 *
 * The poison must let the calls of the dependencies through, because the test
 * runner and the test dependencies read the wall clock in the same process as
 * the tests:
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
 * The rule reads the frame that made the call, and it does not read the
 * frames below that frame. A test that calls fast-check therefore passes,
 * and that same test throws where it reads the clock itself. The rule has a
 * limit in the other direction. Repository code can hand a poisoned function
 * to a dependency as a value, and the dependency can then call it. The frame
 * that made that call belongs to the dependency, and the reading passes. The
 * poison catches the ordinary spellings, and the poison is not a capability
 * boundary.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The names of the global objects that a caller can reach the ambient time
 * functions through, other than globalThis.
 */
const ALIAS_NAMES = ['window', 'self', 'global'] as const;

/** The ambient timer functions that the poison replaces. */
const TIMER_NAMES = ['setTimeout', 'setInterval', 'setImmediate'] as const;

/**
 * The number of stack frames that one capture collects. The poison reads the
 * first frame that names a path, and it needs one such frame. The frames
 * above that frame name no path, and ten frames give room for a run of them.
 * Ten is also the number that V8 collects on its own, so a capture under this
 * budget costs what a capture without a budget costs.
 */
const FRAME_BUDGET = 10;

/** The start of a location of the node runtime, for example `node:internal/…`. */
const RUNTIME_PREFIX = 'node:';

/** The directory name that holds the installed dependencies. */
const DEPENDENCY_DIRECTORY = 'node_modules';

const CLOCK_REMEDY =
	'Read the time from the controlled clock in test/harness/clock.ts.';
const TIMER_REMEDY =
	'Make timers with the controlled clock in test/harness/clock.ts.';
const ASYNC_BODY_MESSAGE =
	'withRealTime needs a body that runs to its end without an await. The poison comes back when the body returns.';

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

/**
 * What one stack frame says about the code that made a call. A frame is
 * `repository` when the frame names a file of this repository, and `outside`
 * when the frame names anything else. A frame is `unreadable` when the frame
 * names no path at all, and the walk then reads the next frame. A frame is
 * `unparseable` when the frame holds a path that this module cannot read, and
 * the poison then refuses.
 */
export type FrameOwner =
	'repository' | 'outside' | 'unreadable' | 'unparseable';

/** What one stack frame holds, before the classification of the path. */
type FrameText =
	| { readonly kind: 'path'; readonly location: string }
	| { readonly kind: 'none' }
	| { readonly kind: 'unparseable' };

const NO_PATH: FrameText = { kind: 'none' };
const UNPARSEABLE: FrameText = { kind: 'unparseable' };

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

/**
 * Returns the first directory above this file that holds a package.json
 * file. Returns the working directory of the process when no directory above
 * this file holds one.
 */
function findRepositoryRoot(): string {
	let directory = dirname(fileURLToPath(import.meta.url));
	for (;;) {
		if (existsSync(join(directory, 'package.json'))) {
			return directory;
		}
		const parent = dirname(directory);
		if (parent === directory) {
			return process.cwd();
		}
		directory = parent;
	}
}

const REPOSITORY_ROOT = forwardSlashes(findRepositoryRoot());

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
 * Returns the position of the round bracket that opens the last group of the
 * text. The text must end with a closing round bracket. Returns -1 when the
 * brackets do not pair. A path can hold round brackets of its own, so the
 * search counts the brackets instead of taking the last one.
 */
function openingBracket(text: string): number {
	let depth = 0;
	for (let index = text.length - 1; index >= 0; index -= 1) {
		const character = text[index];
		if (character === ')') {
			depth += 1;
		} else if (character === '(') {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}
	return -1;
}

/** Returns the position of the bracket that closes the group at `open`. */
function closingBracket(text: string, open: number): number {
	let depth = 0;
	for (let index = open; index < text.length; index += 1) {
		const character = text[index];
		if (character === '(') {
			depth += 1;
		} else if (character === ')') {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}
	return -1;
}

/**
 * Returns the location that a stack frame names, for example
 * `/home/user/repo/test/suite.test.ts:12:3`.
 *
 * A frame that names no location gives `none`, and the walk over the frames
 * then reads the next frame. `at Array.map (<anonymous>)` is such a frame.
 *
 * A frame whose round brackets do not pair gives `unparseable`. A path can
 * hold a closing bracket without an opening one, and the location then cannot
 * be cut out of the frame. The poison refuses on such a frame, because the
 * frame does hold a path, and the path could name a file of this repository.
 */
function frameText(frame: string): FrameText {
	const trimmed = frame.trim();
	if (!trimmed.startsWith('at ')) {
		return NO_PATH;
	}
	const body = trimmed.slice(3);
	let location = body;
	if (body.endsWith(')')) {
		const open = openingBracket(body);
		if (open === -1) {
			return UNPARSEABLE;
		}
		location = body.slice(open + 1, -1);
	}
	// V8 writes the frame of an eval as `eval at name (origin), position`.
	// The origin names the file that called eval, and that file is the code
	// that this module must classify.
	if (location.startsWith('eval at ')) {
		const open = location.indexOf('(');
		const close = open === -1 ? -1 : closingBracket(location, open);
		if (close === -1) {
			return UNPARSEABLE;
		}
		location = location.slice(open + 1, close);
	}
	return location.includes(':') ? { kind: 'path', location } : NO_PATH;
}

/**
 * Returns the path that a location names. The function drops the line and
 * column numbers, drops a query string that the module server added, and
 * turns a file URL into a path.
 *
 * The query string sits at the end of the last part of the path, and the
 * search for it stops at the last separator. A directory name can hold a
 * question mark or a number sign, and a search over the whole path would cut
 * the path at that name. Every frame of the repository would then fall
 * outside the repository root.
 */
function locationPath(location: string): string {
	const withoutPosition = location.replace(/(?::\d+)+$/, '');
	const withoutQuery = withoutPosition.replace(/[?#][^/]*$/, '');
	if (!withoutQuery.startsWith('file://')) {
		return withoutQuery;
	}
	try {
		return fileURLToPath(withoutQuery);
	} catch {
		return withoutQuery;
	}
}

function forwardSlashes(path: string): string {
	return path.replace(/\\/g, '/');
}

function isAbsolutePath(path: string): boolean {
	return /^([A-Za-z]:)?\//.test(path);
}

function ownerOfPath(path: string, root: string): FrameOwner {
	const file = forwardSlashes(path);
	const base = forwardSlashes(root);
	if (file === base || file.startsWith(`${base}/`)) {
		const relative = file.slice(base.length + 1);
		return relative.startsWith(`${DEPENDENCY_DIRECTORY}/`)
			? 'outside'
			: 'repository';
	}
	if (isAbsolutePath(file)) {
		return 'outside';
	}
	return file.startsWith(`${DEPENDENCY_DIRECTORY}/`)
		? 'outside'
		: 'repository';
}

/**
 * Returns what one stack frame says about the code that made the call. A
 * frame that names no location says nothing, and the caller of this function
 * then reads the next frame.
 */
function frameOwner(frame: string, root: string): FrameOwner {
	const text = frameText(frame);
	if (text.kind === 'none') {
		return 'unreadable';
	}
	if (text.kind === 'unparseable') {
		return 'unparseable';
	}
	if (text.location.startsWith(RUNTIME_PREFIX)) {
		return 'outside';
	}
	return ownerOfPath(locationPath(text.location), root);
}

/**
 * Returns true when a file of this repository made the call. The function
 * reads the first frame below `boundary` that names a location. The
 * `boundary` argument is the poison itself, so the stack starts at the caller
 * of the poison.
 *
 * Two writable globals decide what a stack holds: `Error.stackTraceLimit` and
 * `Error.prepareStackTrace`. Vitest installs a hook in the second global for
 * its source maps, and other tools install a hook of their own. This function
 * therefore sets both globals to a known value for the length of the capture,
 * and puts back the values that it found. Without this step, a limit of zero,
 * or a hook that returns something other than a string, turns the poison off
 * and the reading passes.
 *
 * Both globals take their new value through `Reflect.set`. A process can make
 * either global read-only, and an assignment would then throw a TypeError out
 * of an ordinary reading of the clock. `Reflect.set` reports the refusal
 * instead, and the capture runs under the value that stands.
 *
 * The function returns true when no frame names a location, and when the
 * stack is not a string. A stack of that shape is the mark of a hook that
 * this function did not expect, and the poison then refuses.
 */
function callerIsRepositoryCode(
	boundary: (...args: never[]) => unknown,
): boolean {
	const limit: unknown = Reflect.get(Error, 'stackTraceLimit');
	const prepare: unknown = Reflect.get(Error, 'prepareStackTrace');
	Reflect.set(Error, 'stackTraceLimit', FRAME_BUDGET);
	Reflect.set(Error, 'prepareStackTrace', undefined);
	try {
		const holder = new Error();
		Error.captureStackTrace(holder, boundary);
		const stack: unknown = holder.stack;
		if (typeof stack !== 'string') {
			return true;
		}
		for (const frame of stack.split('\n')) {
			const owner = frameOwner(frame, REPOSITORY_ROOT);
			if (owner !== 'unreadable') {
				return owner !== 'outside';
			}
		}
		return true;
	} finally {
		Reflect.set(Error, 'stackTraceLimit', limit);
		Reflect.set(Error, 'prepareStackTrace', prepare);
	}
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
 * Points `Date.prototype.constructor` at the proxy. Without this step,
 * `new Date(0).constructor === Date` is false, because the left side gives
 * the real constructor and the right side gives the proxy.
 */
function pointPrototypeAtProxy(
	real: DateConstructor,
	proxy: DateConstructor,
): void {
	const prototype: unknown = real.prototype;
	if (typeof prototype !== 'object' || prototype === null) {
		return;
	}
	const current: unknown = Reflect.get(prototype, 'constructor');
	if (needsPoison(prototype, 'constructor', current)) {
		replace(prototype, 'constructor', proxy);
	}
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
				const proxy = poisonedDate(holder, spelling);
				replace(target, 'Date', proxy);
				pointPrototypeAtProxy(holder, proxy);
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

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	return typeof Reflect.get(value, 'then') === 'function';
}

function isAsyncFunction(body: unknown): boolean {
	return Object.prototype.toString.call(body) === '[object AsyncFunction]';
}

/**
 * Runs `body` with the real time functions in place, and puts the poison back
 * afterwards. The `reason` argument states why this test must read the real
 * clock. The reason stands at the call, so that a reader of the test sees the
 * exception and the ground for it.
 *
 * The real time functions stay in place for the body of the call, and for
 * nothing else. The body must therefore run to its end without an await. An
 * async body throws before it runs. A plain function that returns a promise
 * throws after it runs, and this function then takes the rejection of that
 * promise, so that the rejection cannot fail another test.
 *
 * The call throws when other code holds the time functions. Fake timers hold
 * them, and so does a stubbed global. Putting the original functions back
 * over such a holder would discard the clock of that holder without a word.
 */
export function withRealTime<T>(reason: string, body: () => T): T {
	if (reason.trim().length === 0) {
		throw new Error(
			'withRealTime needs a reason. The reason tells a reader why this test reads the real clock.',
		);
	}
	if (isAsyncFunction(body)) {
		throw new Error(ASYNC_BODY_MESSAGE);
	}
	if (poisoned && !timePoisonHolds()) {
		throw new Error(
			'withRealTime cannot run while other code holds the time functions. Fake timers hold them, and so does a stubbed global. Put the time functions back before you call withRealTime.',
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
			void result.then(
				() => undefined,
				() => undefined,
			);
			throw new Error(ASYNC_BODY_MESSAGE);
		}
		return result;
	} finally {
		exemptionDepth -= 1;
		if (exemptionDepth === 0 && exemptionLiftedThePoison) {
			poisonTime();
		}
	}
}

/**
 * The parts of the caller rule that the tests of this module read. No other
 * module reads this object.
 */
export const timePoisonInternalsForTests = {
	frameOwner,
	repositoryRoot: (): string => REPOSITORY_ROOT,
};
