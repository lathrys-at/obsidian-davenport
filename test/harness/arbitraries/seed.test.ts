/**
 * The seed decides which inputs a property test takes. A run that drew
 * another seed would draw other inputs, and a failure of such a run does
 * not come back. These cases hold the seed in place: they check the
 * constant, the reading of the environment, and the message that a failure
 * carries.
 */

import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import {
	PROPERTY_SEED,
	SEED_VARIABLE,
	assertProperty,
	propertySeed,
	samples,
	seedOfText,
} from './seed';

function setVariable(value: string | undefined): void {
	if (value === undefined) {
		Reflect.deleteProperty(process.env, SEED_VARIABLE);
	} else {
		process.env[SEED_VARIABLE] = value;
	}
}

const found = process.env[SEED_VARIABLE];

afterEach(() => {
	setVariable(found);
});

describe('the seed of a property test', () => {
	it('takes the constant when the environment names no seed', () => {
		setVariable(undefined);
		expect(propertySeed()).toBe(PROPERTY_SEED);
	});

	it('takes the constant when the environment names an empty seed', () => {
		setVariable('');
		expect(propertySeed()).toBe(PROPERTY_SEED);
	});

	it('takes the seed that the environment names', () => {
		setVariable('17');
		expect(propertySeed()).toBe(17);
	});

	it('refuses a seed that states no whole number', () => {
		expect(() => seedOfText('later')).toThrow(SEED_VARIABLE);
		expect(() => seedOfText('1.5')).toThrow(SEED_VARIABLE);
		expect(() => seedOfText('')).toThrow(SEED_VARIABLE);
	});
});

describe('the runner of a property', () => {
	it('draws the same inputs on two runs', () => {
		const seen: number[][] = [];
		for (const run of [0, 1]) {
			const drawn: number[] = [];
			assertProperty(
				fc.property(fc.integer(), (value) => {
					drawn.push(value);
				}),
				20,
			);
			seen[run] = drawn;
		}
		expect(seen[0]).toEqual(seen[1]);
		expect(seen[0]).toHaveLength(20);
	});

	it('draws other inputs under another seed', () => {
		const drawn: number[][] = [];
		for (const seed of ['3', '4']) {
			setVariable(seed);
			const values: number[] = [];
			assertProperty(
				fc.property(fc.integer(), (value) => {
					values.push(value);
				}),
				20,
			);
			drawn.push(values);
		}
		expect(drawn[0]).not.toEqual(drawn[1]);
	});

	it('takes the number of inputs that the caller states', () => {
		let count = 0;
		assertProperty(
			fc.property(fc.integer(), () => {
				count += 1;
			}),
			7,
		);
		expect(count).toBe(7);
	});

	it('states the command that draws the same inputs again', () => {
		setVariable('23');
		expect(() => {
			assertProperty(
				fc.property(fc.constant(1), () => {
					throw new Error('the rule does not hold');
				}),
				1,
			);
		}).toThrow(`${SEED_VARIABLE}=23 npm test`);
	});

	it('keeps the report of the generator in the failure', () => {
		expect(() => {
			assertProperty(
				fc.property(fc.constant(7), () => {
					throw new Error('the rule does not hold');
				}),
				1,
			);
		}).toThrow('Counterexample: [7]');
	});

	// The generator keeps the error of the rule as the cause of its own
	// error. The runner gives that same error back, so the cause survives
	// and the report of the runner states what the rule found.
	it('keeps the error of the rule as the cause', () => {
		let cause: unknown;
		try {
			assertProperty(
				fc.property(fc.constant(1), () => {
					throw new Error('the rule does not hold');
				}),
				1,
			);
		} catch (error) {
			cause = Reflect.get(Object(error), 'cause');
		}
		expect(cause).toBeInstanceOf(Error);
		expect((cause as Error).message).toBe('the rule does not hold');
	});
});

describe('the sample of a generator', () => {
	it('draws the number of values that the caller states', () => {
		expect(samples(fc.integer(), 12)).toHaveLength(12);
	});

	it('draws the same values on two calls', () => {
		expect(samples(fc.integer(), 12)).toEqual(samples(fc.integer(), 12));
	});
});
