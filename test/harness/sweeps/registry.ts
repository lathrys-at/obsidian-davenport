/**
 * Where sweeps are collected and evaluated. A run reads the registry at
 * the moment it ends, so a suite that registers a sweep of its own gets it
 * evaluated over the same evidence as the standing set.
 *
 * The default registry is module state, which vitest gives each test file
 * a fresh copy of. `reset` returns it to the standing set regardless: the
 * setup file calls it before every test, so a registration cannot reach
 * the next test whether or not module state was reused. A suite that wants
 * a registration to survive that reset registers it in its own `beforeEach`,
 * which runs after the setup file's.
 *
 * `beforeEach` and not `beforeAll`: the reset runs between the two, so a
 * `beforeAll` registration is gone by the time the first test reads it,
 * and under a shared module registry it is also the one place a
 * registration from another file is still visible.
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

	/** Sweeps in registration order, the standing set first. */
	get registered(): readonly Sweep[] {
		return this.current;
	}

	/**
	 * A name is the handle a failure is read by, so two sweeps may not
	 * share one.
	 */
	register(sweep: Sweep): void {
		if (this.current.some((held) => held.name === sweep.name)) {
			throw new Error(
				`sweep registry: ${sweep.name} is already registered`,
			);
		}
		this.current.push(sweep);
	}

	reset(): void {
		this.current = [...this.baseline];
	}

	/**
	 * Every sweep that found something, in registration order. A sweep that
	 * throws is reported as having found its own failure rather than being
	 * allowed out: an error escaping here would fail the test with nothing
	 * naming which sweep produced it, which is the one failure shape the
	 * reporting exists to prevent.
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
						detail: `threw ${error instanceof Error ? error.message : String(error)}`,
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

/** The registry a run evaluates when it is handed no other. */
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
