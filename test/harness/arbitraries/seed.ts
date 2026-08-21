/**
 * The seed of a property test, and the runner that applies it.
 *
 * A property test states a rule and then asks a generator for many inputs.
 * fast-check draws those inputs. Without a seed, fast-check takes a number
 * from the wall clock. A run then draws different inputs than the run
 * before it. Two things follow from that. A test can pass on one run and
 * fail on the next run, and a person cannot repeat the failure.
 *
 * This module gives every property test one seed. The seed is a constant of
 * the repository. The same commit therefore draws the same inputs on every
 * machine and on every run. A failure in a build log is a failure that a
 * person repeats on a desktop.
 *
 * A fixed seed also fixes the search. The generators explore one sample of
 * their space, and they explore no more of it as the days pass. A person who
 * wants a wider search gives another seed in the environment:
 *
 *     DAVENPORT_PROPERTY_SEED=17 npm test
 *
 * A variable that holds nothing names no seed, and the run then takes the
 * constant. A variable that holds something must hold a whole number. A
 * value that does not read as a whole number stops the run, because a silent
 * fall back to the constant would make the wider search an empty claim.
 *
 * The runner puts the seed in the failure. fast-check prints the seed and
 * the path of a counterexample in its own message. The runner adds the
 * command that repeats the run, so the reader of a build log needs nothing
 * else.
 */

import fc from 'fast-check';

/**
 * The seed that every property test uses when the environment names no
 * other seed. The number itself carries no meaning. It must only stay the
 * same, so that the inputs stay the same.
 */
export const PROPERTY_SEED = 20260821;

/** The name of the environment variable that replaces the seed. */
export const SEED_VARIABLE = 'DAVENPORT_PROPERTY_SEED';

/**
 * The seed of this run. The function reads the environment one time for
 * each call, so a test that sets the variable takes effect at once.
 */
export function propertySeed(): number {
	const given = process.env[SEED_VARIABLE];
	if (given === undefined || given === '') {
		return PROPERTY_SEED;
	}
	return seedOfText(given);
}

/**
 * The whole number that the text states. The function throws an error when
 * the text states no whole number.
 */
export function seedOfText(text: string): number {
	// Number reads an empty text and a text of spaces as zero. A seed of
	// zero out of an empty text would be a silent fall back, and this
	// module states that no such fall back happens.
	const value = text.trim() === '' ? Number.NaN : Number(text);
	if (!Number.isSafeInteger(value)) {
		throw new Error(
			`${SEED_VARIABLE} must state a whole number, and it states ${JSON.stringify(text)}`,
		);
	}
	return value;
}

/**
 * Runs a property against generated inputs, under the seed of this run.
 *
 * The `runs` argument states how many inputs the property takes. Choose the
 * count for the property. A property over a small space needs few inputs. A
 * property over a large space needs more, and each input costs time in a
 * suite that runs on every commit.
 *
 * A failure carries the message of fast-check, and it carries the command
 * that runs the same inputs again.
 */
export function assertProperty<Ts>(
	property: fc.IRawProperty<Ts, false>,
	runs: number,
): void {
	const seed = propertySeed();
	try {
		fc.assert(property, { seed, numRuns: runs });
	} catch (error) {
		throw replayable(error, seed);
	}
}

/** The same runner, for a property whose body waits for an answer. */
export async function assertAsyncProperty<Ts>(
	property: fc.IRawProperty<Ts, true>,
	runs: number,
): Promise<void> {
	const seed = propertySeed();
	try {
		await fc.assert(property, { seed, numRuns: runs });
	} catch (error) {
		throw replayable(error, seed);
	}
}

/**
 * Values that a generator draws, under the seed of this run. A test of a
 * generator reads these values and asks what the generator covers.
 */
export function samples<T>(
	arbitrary: fc.Arbitrary<T>,
	count: number,
): readonly T[] {
	return fc.sample(arbitrary, { seed: propertySeed(), numRuns: count });
}

/**
 * The failure of a run, with the command that draws the same inputs again.
 * The function changes the message of the error that it received and gives
 * that same error back, so that the stack of the failure stays whole.
 */
function replayable(error: unknown, seed: number): unknown {
	const replay = `\n\nRun these inputs again with:\n    ${SEED_VARIABLE}=${String(seed)} npm test`;
	if (error instanceof Error) {
		error.message += replay;
		return error;
	}
	return new Error(`${String(error)}${replay}`);
}
