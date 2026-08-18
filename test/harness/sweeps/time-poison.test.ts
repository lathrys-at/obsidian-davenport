import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	AmbientTimeError,
	poisonTime,
	restoreTime,
	timePoisonHolds,
	withRealTime,
} from './time-poison';

const ALIASES = ['window', 'self', 'global'] as const;
const TIMERS = ['setTimeout', 'setInterval', 'setImmediate'] as const;

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

	it('refuses a body that returns a promise', () => {
		expect(() =>
			withRealTime('this test returns a promise', () =>
				Promise.resolve(1),
			),
		).toThrow(/without an await/);
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
