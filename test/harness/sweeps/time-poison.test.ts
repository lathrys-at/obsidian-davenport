import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	AmbientTimeError,
	poisonTime,
	restoreTime,
	timePoisonHolds,
	timePoisonInternalsForTests,
	withRealTime,
} from './time-poison';
import type { FrameOwner } from './time-poison';

const ALIASES = ['window', 'self', 'global'] as const;
const TIMERS = ['setTimeout', 'setInterval', 'setImmediate'] as const;

const { frameOwner, repositoryRoot } = timePoisonInternalsForTests;

const ROOT = repositoryRoot();

/**
 * A path that a fixture tree could hold. The directory name says
 * node_modules, and the file under it is still a file of this repository.
 */
const FIXTURE_UNDER_DEPENDENCY_NAME = `${ROOT}/test/probefix/node_modules/reader.ts`;

/** A path of an installed dependency of this repository. */
const INSTALLED_DEPENDENCY = `${ROOT}/node_modules/probe-package/index.js`;

/**
 * Builds a function whose stack frame names the given path. V8 takes the name
 * of an evaluated script from its sourceURL comment, so a test can put a frame
 * of any path in front of the poison. The alternative is a fixture file under
 * a directory named node_modules, and git ignores every such directory.
 */
function functionAtPath(
	path: string,
	source: string,
): (...args: unknown[]) => unknown {
	const build = new Function(
		`return (${source})\n//# sourceURL=${path}`,
	) as () => (...args: unknown[]) => unknown;
	return build();
}

/**
 * A global object that a test puts under an alias name. The object holds its
 * own time functions. Each function writes its name in the reached list, so
 * that a test can prove that the poison threw before the real function ran.
 */
interface OwnGlobals {
	readonly holder: Record<string, unknown>;
	readonly reached: string[];
}

function ownGlobals(): OwnGlobals {
	const reached: string[] = [];
	function OwnDate(): void {
		reached.push('Date');
	}
	OwnDate.now = (): number => {
		reached.push('now');
		return 0;
	};
	const holder: Record<string, unknown> = { Date: OwnDate };
	for (const name of TIMERS) {
		holder[name] = (): void => {
			reached.push(name);
		};
	}
	return { holder, reached };
}

/**
 * Defines a global object under the given name, and returns a function that
 * puts the earlier value back. The poison walks the global names, and the
 * walk then meets a name that holds a separate object. Node resolves every
 * alias name to one global object, so without a separate object a poison
 * that covers only globalThis would pass these tests.
 */
function withAlias(name: string, value: object): () => void {
	const original = Object.getOwnPropertyDescriptor(globalThis, name);
	Object.defineProperty(globalThis, name, {
		value,
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
 * Returns the value that the named global object holds under the given key.
 * A test reads the time functions this way, because a direct read would name
 * the poison in the source text of the test.
 */
function globalValue(name: string, key: string): unknown {
	const holder: unknown = Reflect.get(globalThis, name);
	return typeof holder === 'object' && holder !== null
		? Reflect.get(holder, key)
		: undefined;
}

function callValue(name: string, key: string): unknown {
	const call = globalValue(name, key);
	if (typeof call !== 'function') {
		throw new TypeError(`${name}.${key} is not a function`);
	}
	return (call as () => unknown)();
}

/** Runs the body, and returns the refusal that the body threw. */
function refusalFrom(body: () => unknown): AmbientTimeError {
	try {
		body();
	} catch (error) {
		if (error instanceof AmbientTimeError) {
			return error;
		}
		throw error;
	}
	throw new Error('the call went through, and the poison threw nothing');
}

afterEach(() => {
	// The setup file poisons the global objects one time for each test file.
	// A test in this file can lift the poison. This hook puts the poison
	// back, so that the tests after that test also run under the poison.
	poisonTime();
});

describe('time poisoning', () => {
	it('is already in place before any test runs', () => {
		expect(timePoisonHolds()).toBe(true);
	});

	it('throws on a read of Date.now', () => {
		const refusal = refusalFrom(() => Date.now());
		expect(refusal.spelling).toBe('globalThis.Date.now');
		expect(refusal.message).toContain('controlled clock');
	});

	it('throws on the Date constructor with no argument', () => {
		const refusal = refusalFrom(() => new Date());
		expect(refusal.spelling).toBe('new globalThis.Date()');
	});

	it('throws on a call to Date as a plain function', () => {
		const refusal = refusalFrom(() => (Date as () => string)());
		expect(refusal.spelling).toBe('globalThis.Date()');
	});

	it.each(TIMERS)('throws on a call to %s', (name) => {
		const refusal = refusalFrom(() => callValue('globalThis', name));
		expect(refusal.spelling).toBe(`globalThis.${name}`);
		expect(refusal.message).toContain('controlled clock');
	});

	it('keeps every form that takes its time from the caller', () => {
		expect(new Date(86_400_000).getTime()).toBe(86_400_000);
		expect(new Date('2026-01-01T00:00:00.000Z').getTime()).toBe(
			Date.UTC(2026, 0, 1),
		);
		expect(Date.parse('2026-01-01T00:00:00.000Z')).toBe(
			Date.UTC(2026, 0, 1),
		);
		expect(new Date(0)).toBeInstanceOf(Date);
		expect(new Date(0).toISOString()).toBe('1970-01-01T00:00:00.000Z');
	});

	it('keeps the constructor of a date pointed at the name Date', () => {
		expect(new Date(0).constructor).toBe(Date);
		expect(Date.prototype.constructor).toBe(Date);
	});

	it('keeps a class that extends Date, and refuses its zero-argument call', () => {
		class Stamp extends Date {}
		const made = new Stamp(5);
		expect(made.getTime()).toBe(5);
		expect(made).toBeInstanceOf(Stamp);
		expect(made).toBeInstanceOf(Date);
		expect(() => new Stamp()).toThrow(AmbientTimeError);
	});

	it('keeps Reflect.construct with a new target, and refuses it with no argument', () => {
		class Stamp extends Date {}
		const made: Date = Reflect.construct(Date, [7], Stamp);
		expect(made.getTime()).toBe(7);
		expect(made).toBeInstanceOf(Stamp);
		expect(() => {
			Reflect.construct(Date, [], Stamp);
		}).toThrow(AmbientTimeError);
	});

	it('keeps the functions that cancel a timer and the microtask queue', () => {
		expect(() => {
			clearTimeout(undefined);
			clearInterval(undefined);
			queueMicrotask(() => undefined);
		}).not.toThrow();
	});

	it('keeps performance.now, which vitest measures each test with', () => {
		expect(performance.now()).toBeGreaterThan(0);
	});

	it.each(ALIASES)('covers a separate object under %s', (name) => {
		restoreTime();
		const own = ownGlobals();
		const remove = withAlias(name, own.holder);
		try {
			poisonTime();
			expect(timePoisonHolds()).toBe(true);
			expect(
				refusalFrom(() => callValue(name, 'setTimeout')).spelling,
			).toBe(`${name}.setTimeout`);
			const date = globalValue(name, 'Date');
			expect(refusalFrom(() => (date as () => unknown)()).spelling).toBe(
				`${name}.Date()`,
			);
			expect(
				refusalFrom(() => new (date as new () => unknown)()).spelling,
			).toBe(`new ${name}.Date()`);
			expect(
				refusalFrom(() =>
					(Reflect.get(date as object, 'now') as () => unknown)(),
				).spelling,
			).toBe(`${name}.Date.now`);
			expect(own.reached).toEqual([]);
		} finally {
			restoreTime();
			remove();
		}
	});

	it('puts back the functions of globalThis, and then reports no poison', () => {
		const poison = globalValue('globalThis', 'Date');
		restoreTime();
		expect(timePoisonHolds()).toBe(false);
		expect(globalValue('globalThis', 'Date')).not.toBe(poison);
		expect(Date.prototype.constructor).toBe(Date);
		expect(Date.now()).toBeGreaterThan(0);
		expect(new Date().getTime()).toBeGreaterThan(0);
	});

	it('does not put a second poison over the first', () => {
		const first = globalValue('globalThis', 'Date');
		poisonTime();
		expect(globalValue('globalThis', 'Date')).toBe(first);
		restoreTime();
		expect(timePoisonHolds()).toBe(false);
		expect(Date.now()).toBeGreaterThan(0);
	});

	it('reports a breach when something replaces Date.now', () => {
		const original = Object.getOwnPropertyDescriptor(Date, 'now');
		Object.defineProperty(Date, 'now', {
			value: () => 0,
			writable: true,
			enumerable: false,
			configurable: true,
		});
		try {
			expect(timePoisonHolds()).toBe(false);
		} finally {
			if (original !== undefined) {
				Object.defineProperty(Date, 'now', original);
			}
		}
	});
});

describe('the rule that reads the caller of a time function', () => {
	const REPOSITORY_FRAMES: readonly (readonly [string, string, string])[] = [
		[
			'a named frame',
			'    at readClock (/repo/test/foo.test.ts:3:12)',
			'/repo',
		],
		['a frame with no name', '    at /repo/test/foo.test.ts:3:12', '/repo'],
		[
			'a module body',
			'    at Object.<anonymous> (/repo/test/foo.test.ts:3:12)',
			'/repo',
		],
		[
			'a constructor',
			'    at new Reader (/repo/src/core/x.ts:1:1)',
			'/repo',
		],
		[
			'an async frame',
			'    at async Module.run (/repo/test/x.ts:1:1)',
			'/repo',
		],
		['a file URL', '    at file:///repo/test/x.ts:1:1', '/repo'],
		[
			'a path that holds round brackets',
			'    at now (/repo/My (Repo) Files/test/x.ts:1:1)',
			'/repo',
		],
		[
			'a path under a fixture directory named node_modules',
			`    at readClock (${FIXTURE_UNDER_DEPENDENCY_NAME}:1:1)`,
			ROOT,
		],
		[
			'a relative path of this repository',
			'    at now (test/x.ts:1:1)',
			'/repo',
		],
		[
			'a path with the query string of the module server',
			'    at now (/repo/test/x.ts?v=abc123:1:1)',
			'/repo',
		],
		[
			'an eval inside this repository',
			'    at eval (eval at run (/repo/test/x.ts:1:1), <anonymous>:1:1)',
			'/repo',
		],
		[
			'a path with the separator of windows',
			'    at now (C:\\repo\\test\\x.ts:1:1)',
			'C:\\repo',
		],
		[
			'a root whose name holds a number sign',
			'    at now (/work/proj#2/test/x.ts:1:1)',
			'/work/proj#2',
		],
		[
			'a root whose name holds a question mark',
			'    at now (/work/proj?a/test/x.ts:1:1)',
			'/work/proj?a',
		],
		[
			'a query string under a root whose name holds a number sign',
			'    at now (/work/proj#2/test/x.ts?v=abc123:1:1)',
			'/work/proj#2',
		],
	];

	const OUTSIDE_FRAMES: readonly (readonly [string, string, string])[] = [
		[
			'an installed dependency',
			'    at now (/repo/node_modules/pkg/index.js:1:1)',
			'/repo',
		],
		[
			'an installed dependency behind a file URL',
			'    at now (file:///repo/node_modules/fast-check/lib/fast-check.js:1:1)',
			'/repo',
		],
		[
			'an installed dependency whose path holds round brackets',
			'    at now (/repo/node_modules/pkg/a (b)/f.js:1:1)',
			'/repo',
		],
		[
			'a dependency of a dependency',
			'    at now (/repo/node_modules/pkg/node_modules/sub/x.js:1:1)',
			'/repo',
		],
		[
			'a relative path of a dependency',
			'    at now (node_modules/pkg/i.js:1:1)',
			'/repo',
		],
		[
			'a module of the node runtime',
			'    at processTicksAndRejections (node:internal/process/task_queues:105:5)',
			'/repo',
		],
		[
			'a module of the node runtime with no name',
			'    at node:internal/main/run_main_module:23:47',
			'/repo',
		],
		[
			'a path outside the repository',
			'    at now (/elsewhere/lib/i.js:1:1)',
			'/repo',
		],
		[
			'a path that starts with the name of the repository root',
			'    at now (/repository-other/test/x.ts:1:1)',
			'/repo',
		],
		[
			'an eval inside a dependency',
			'    at eval (eval at run (/repo/node_modules/pkg/i.js:1:1), <anonymous>:1:1)',
			'/repo',
		],
		[
			'an installed dependency under the separator of windows',
			'    at now (C:\\repo\\node_modules\\pkg\\i.js:1:1)',
			'C:\\repo',
		],
		[
			'an installed dependency under a root whose name holds a number sign',
			'    at now (/work/proj#2/node_modules/pkg/i.js:1:1)',
			'/work/proj#2',
		],
	];

	const UNPARSEABLE_FRAMES: readonly (readonly [string, string])[] = [
		[
			'a path that holds a closing bracket without an opening one',
			'    at now (/repo/we)ird/test/x.ts:1:1)',
		],
		[
			'an eval frame that names no origin in brackets',
			'    at eval (eval at run /repo/test/x.ts:1:1, <anonymous>:1:1)',
		],
	];

	const UNREADABLE_FRAMES: readonly (readonly [string, string])[] = [
		['a builtin', '    at Array.map (<anonymous>)'],
		['a native frame', '    at native'],
		['the promise constructor', '    at new Promise (<anonymous>)'],
		['the head line of the stack', 'Error'],
		['an empty line', ''],
	];

	it.each(REPOSITORY_FRAMES)(
		'reads %s as repository code',
		(_, frame, root) => {
			expect(frameOwner(frame, root)).toBe<FrameOwner>('repository');
		},
	);

	it.each(OUTSIDE_FRAMES)(
		'reads %s as code outside the ban',
		(_, frame, root) => {
			expect(frameOwner(frame, root)).toBe<FrameOwner>('outside');
		},
	);

	it.each(UNREADABLE_FRAMES)('reads %s as no answer', (_, frame) => {
		expect(frameOwner(frame, '/repo')).toBe<FrameOwner>('unreadable');
	});

	it.each(UNPARSEABLE_FRAMES)(
		'reads %s as a path it cannot read',
		(_, frame) => {
			expect(frameOwner(frame, '/repo')).toBe<FrameOwner>('unparseable');
		},
	);

	it('throws for a path that it cannot read, under a dependency frame', () => {
		const read = functionAtPath(
			`${ROOT}/test/we)ird/reader.ts`,
			'function readClock() { return Date.now(); }',
		);
		const invoke = functionAtPath(
			INSTALLED_DEPENDENCY,
			'function invoke(read) { return read(); }',
		);
		expect(() => read()).toThrow(AmbientTimeError);
		expect(() => invoke(read)).toThrow(AmbientTimeError);
	});

	it('throws for a repository file under a directory named node_modules', () => {
		const read = functionAtPath(
			FIXTURE_UNDER_DEPENDENCY_NAME,
			'function readClock() { return Date.now(); }',
		);
		const make = functionAtPath(
			FIXTURE_UNDER_DEPENDENCY_NAME,
			'function makeDate() { return new Date(); }',
		);
		expect(() => read()).toThrow(AmbientTimeError);
		expect(() => make()).toThrow(AmbientTimeError);
	});

	it('answers an installed dependency with the real time', () => {
		const read = functionAtPath(
			INSTALLED_DEPENDENCY,
			'function readClock() { return Date.now(); }',
		);
		expect(read()).toBeGreaterThan(0);
	});

	it('answers a dependency that calls a poisoned function that it received', () => {
		const invoke = functionAtPath(
			INSTALLED_DEPENDENCY,
			'function invoke(read) { return read(); }',
		);
		expect(invoke(Date.now)).toBeGreaterThan(0);
	});

	it('throws when a dependency calls a function of this repository', () => {
		const invoke = functionAtPath(
			INSTALLED_DEPENDENCY,
			'function invoke(read) { return read(); }',
		);
		expect(() => invoke(() => Date.now())).toThrow(AmbientTimeError);
	});
});

describe('the time poison under a stack hook', () => {
	it('throws when the stack trace limit is zero, and still answers a dependency', () => {
		const read = functionAtPath(
			INSTALLED_DEPENDENCY,
			'function readClock() { return Date.now(); }',
		);
		const limit = Error.stackTraceLimit;
		Error.stackTraceLimit = 0;
		try {
			expect(() => Date.now()).toThrow(AmbientTimeError);
			expect(read()).toBeGreaterThan(0);
			expect(Error.stackTraceLimit).toBe(0);
		} finally {
			Error.stackTraceLimit = limit;
		}
	});

	it('throws when the stack trace limit takes no new value', () => {
		const original = Object.getOwnPropertyDescriptor(
			Error,
			'stackTraceLimit',
		);
		Object.defineProperty(Error, 'stackTraceLimit', {
			value: 10,
			writable: false,
			enumerable: false,
			configurable: true,
		});
		try {
			expect(() => Date.now()).toThrow(AmbientTimeError);
		} finally {
			if (original !== undefined) {
				Object.defineProperty(Error, 'stackTraceLimit', original);
			}
		}
	});

	it('throws when a stack hook returns nothing, and still answers a dependency', () => {
		const read = functionAtPath(
			INSTALLED_DEPENDENCY,
			'function readClock() { return Date.now(); }',
		);
		const prepare: unknown = Reflect.get(Error, 'prepareStackTrace');
		const hook = (): undefined => undefined;
		Reflect.set(Error, 'prepareStackTrace', hook);
		try {
			expect(() => Date.now()).toThrow(AmbientTimeError);
			expect(read()).toBeGreaterThan(0);
			expect(Reflect.get(Error, 'prepareStackTrace')).toBe(hook);
		} finally {
			Reflect.set(Error, 'prepareStackTrace', prepare);
		}
	});

	it('throws when a stack hook returns the frames themselves', () => {
		const prepare: unknown = Reflect.get(Error, 'prepareStackTrace');
		const hook = (_: Error, frames: unknown[]): unknown[] => frames;
		Reflect.set(Error, 'prepareStackTrace', hook);
		try {
			expect(() => Date.now()).toThrow(AmbientTimeError);
			expect(Reflect.get(Error, 'prepareStackTrace')).toBe(hook);
		} finally {
			Reflect.set(Error, 'prepareStackTrace', prepare);
		}
	});

	it('answers a dependency under a stack hook that returns the frames', () => {
		const read = functionAtPath(
			INSTALLED_DEPENDENCY,
			'function readClock() { return Date.now(); }',
		);
		const prepare: unknown = Reflect.get(Error, 'prepareStackTrace');
		Reflect.set(
			Error,
			'prepareStackTrace',
			(_: Error, frames: unknown[]): unknown[] => frames,
		);
		try {
			expect(read()).toBeGreaterThan(0);
		} finally {
			Reflect.set(Error, 'prepareStackTrace', prepare);
		}
	});
});

describe('the named exception to the time poison', () => {
	it('reads the real clock inside the body, and poisons the clock again after it', () => {
		const millis = withRealTime(
			'this test compares the real clock with the poison',
			() => Date.now(),
		);
		expect(millis).toBeGreaterThan(0);
		expect(timePoisonHolds()).toBe(true);
		expect(() => Date.now()).toThrow(AmbientTimeError);
	});

	it('lifts the poison for the whole body', () => {
		const holds = withRealTime(
			'this test looks at the poison from inside the exception',
			() => {
				const inside = timePoisonHolds();
				return { inside, millis: new Date().getTime() };
			},
		);
		expect(holds.inside).toBe(false);
		expect(holds.millis).toBeGreaterThan(0);
		expect(timePoisonHolds()).toBe(true);
	});

	it('puts the poison back when the body throws', () => {
		expect(() => {
			withRealTime('this test throws from inside the exception', () => {
				throw new Error('the body of this test throws');
			});
		}).toThrow('the body of this test throws');
		expect(timePoisonHolds()).toBe(true);
	});

	it('needs a reason', () => {
		expect(() => withRealTime('   ', () => 1)).toThrow(/needs a reason/);
		expect(timePoisonHolds()).toBe(true);
	});

	it('refuses an async body before that body runs', () => {
		let ran = false;
		const body = async (): Promise<number> => {
			ran = true;
			return Promise.resolve(1);
		};
		expect(() =>
			withRealTime('this test uses an async body', body),
		).toThrow(/without an await/);
		expect(ran).toBe(false);
		expect(timePoisonHolds()).toBe(true);
	});

	it('refuses a plain body that returns a promise, and takes its rejection', async () => {
		const reports: unknown[] = [];
		const record = (reason: unknown): void => {
			reports.push(reason);
		};
		const wait = withRealTime(
			'this test needs the real setImmediate to wait one turn',
			() => globalThis.setImmediate,
		);
		process.on('unhandledRejection', record);
		try {
			expect(() =>
				withRealTime('this test returns a promise', () =>
					Promise.reject(new Error('the body of this test rejects')),
				),
			).toThrow(/without an await/);
			await new Promise<void>((resolve) => {
				wait(resolve);
			});
		} finally {
			process.off('unhandledRejection', record);
		}
		expect(reports).toEqual([]);
		expect(timePoisonHolds()).toBe(true);
	});

	it('refuses to run while fake timers hold the time functions', () => {
		vi.useFakeTimers();
		try {
			expect(() =>
				withRealTime('this test runs inside fake timers', () => 1),
			).toThrow(/holds the time functions/);
		} finally {
			vi.useRealTimers();
		}
		expect(timePoisonHolds()).toBe(true);
	});
});

describe('the time poison and the test runner', () => {
	it('lets a dependency read the clock that it seeds itself with', () => {
		expect(() => fc.sample(fc.integer(), 1)).not.toThrow();
	});

	it('lets a test use the fake timers of vitest', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date(1_000));
			expect(Date.now()).toBe(1_000);
			let fired = false;
			setTimeout(() => {
				fired = true;
			}, 10);
			vi.advanceTimersByTime(20);
			expect(fired).toBe(true);
		} finally {
			vi.useRealTimers();
		}
		expect(timePoisonHolds()).toBe(true);
		expect(() => Date.now()).toThrow(AmbientTimeError);
	});
});
