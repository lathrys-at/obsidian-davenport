/**
 * This module collects the sweeps and evaluates them. A run reads the
 * registry at the moment that the run ends. Thus a suite can register a
 * sweep of its own, and the harness evaluates that sweep over the same
 * evidence as the standing set.
 *
 * The default registry is module state, and vitest gives each test file a
 * fresh copy of that state. `reset` puts the registry back to the standing
 * set in all conditions: the setup file calls `reset` before every test,
 * so a registration cannot reach the next test. This is true whether
 * vitest reused the module state or not. A suite that wants a registration
 * to survive that reset registers the sweep in its own `beforeEach`,
 * because the `beforeEach` of the suite runs after the `beforeEach` of the
 * setup file.
 *
 * Use `beforeEach` and not `beforeAll`. The reset runs after `beforeAll`
 * and before the first test, so a registration made in `beforeAll` is gone
 * when the first test reads the registry. `beforeAll` has a second
 * problem. When vitest reuses the module state, `beforeAll` is the one
 * place where a registration from another file is still visible.
 */

import type { RunEvidence } from './evidence';
import { STANDING_SWEEPS } from './standing';
import type { Sweep, SweepReport, SweepViolation } from './sweep';

export class SweepRegistry {
	private readonly baseline: readonly Sweep[];
	private current: Sweep[];

	constructor(baseline: readonly Sweep[] = []) {
		this.baseline = [...baseline];
		this.current = [...baseline];
	}

	/** The sweeps in registration order. The standing set comes first. */
	get registered(): readonly Sweep[] {
		return this.current;
	}

	/**
	 * Adds a sweep to the registry. A reader finds a failure by the name of
	 * the sweep, so two sweeps must not have the same name. This method
	 * throws an error when the name is already in the registry.
	 */
	register(sweep: Sweep): void {
		if (this.current.some((held) => held.name === sweep.name)) {
			throw new Error(
				`sweep registry: the name ${sweep.name} is already registered. Give the new sweep a different name.`,
			);
		}
		this.current.push(sweep);
	}

	reset(): void {
		this.current = [...this.baseline];
	}

	/**
	 * Returns one report for each sweep that found a violation, in
	 * registration order. A sweep that throws an error does not let the
	 * error out: this method reports the error as a violation of that
	 * sweep. An error that escaped from here would fail the test, but the
	 * failure would not name the sweep that caused it. That kind of failure
	 * is the only kind that the reports exist to prevent.
	 */
	evaluate(evidence: RunEvidence): readonly SweepReport[] {
		const reports: SweepReport[] = [];
		for (const sweep of this.current) {
			let violations: readonly SweepViolation[];
			try {
				violations = sweep.check(evidence);
			} catch (error) {
				violations = [
					{
						where: 'the sweep itself',
						detail: `the check threw an error: ${error instanceof Error ? error.message : String(error)}`,
					},
				];
			}
			if (violations.length > 0) {
				reports.push({ sweep: sweep.name, violations });
			}
		}
		return reports;
	}
}

/** The registry that a run evaluates when the caller gives no other. */
export const sweeps = new SweepRegistry(STANDING_SWEEPS);

export function registerSweep(sweep: Sweep): void {
	sweeps.register(sweep);
}

export function registeredSweeps(): readonly Sweep[] {
	return sweeps.registered;
}

export function resetSweeps(): void {
	sweeps.reset();
}
