import { describe, expect, it } from 'vitest';
import { evidence } from './evidence';
import {
	SweepRegistry,
	registerSweep,
	registeredSweeps,
	resetSweeps,
	sweeps,
} from './registry';
import { STANDING_SWEEPS } from './standing';
import { describeReports, type Sweep } from './sweep';

function alwaysFails(name: string, where = 'vault.files'): Sweep {
	return {
		name,
		check: () => [{ where, detail: `${name} objected` }],
	};
}

const alwaysHolds: Sweep = { name: 'always-holds', check: () => [] };

describe('sweep registry', () => {
	it('starts from the standing set and keeps the registration order', () => {
		const registry = new SweepRegistry(STANDING_SWEEPS);
		registry.register(alwaysHolds);
		expect(registry.registered.map((sweep) => sweep.name)).toEqual([
			...STANDING_SWEEPS.map((sweep) => sweep.name),
			'always-holds',
		]);
	});

	it('refuses a sweep whose name is already registered', () => {
		const registry = new SweepRegistry([alwaysHolds]);
		expect(() => {
			registry.register({ name: 'always-holds', check: () => [] });
		}).toThrow(/already registered/);
	});

	it('reports every sweep that found a violation, and no other sweep', () => {
		const registry = new SweepRegistry([
			alwaysFails('first'),
			alwaysHolds,
			alwaysFails('second'),
		]);
		expect(registry.evaluate(evidence())).toEqual([
			{
				sweep: 'first',
				violations: [
					{ where: 'vault.files', detail: 'first objected' },
				],
			},
			{
				sweep: 'second',
				violations: [
					{ where: 'vault.files', detail: 'second objected' },
				],
			},
		]);
	});

	it('names the sweep that threw the error and does not let the error out', () => {
		const registry = new SweepRegistry([
			{
				name: 'broken',
				check: () => {
					throw new Error('the sweep is wrong');
				},
			},
			alwaysHolds,
		]);
		expect(registry.evaluate(evidence())).toEqual([
			{
				sweep: 'broken',
				violations: [
					{
						where: 'the sweep itself',
						detail: 'the check threw an error: the sweep is wrong',
					},
				],
			},
		]);
	});

	it('drops the added sweeps on reset and keeps the standing set', () => {
		const registry = new SweepRegistry(STANDING_SWEEPS);
		registry.register(alwaysHolds);
		registry.reset();
		expect(registry.registered).toEqual(STANDING_SWEEPS);
	});

	it('puts a sweep into the module registry', () => {
		registerSweep(alwaysHolds);
		expect(registeredSweeps().map((sweep) => sweep.name)).toContain(
			'always-holds',
		);
	});

	it('does not see the sweep that the test before it registered', () => {
		expect(registeredSweeps().map((sweep) => sweep.name)).toEqual(
			STANDING_SWEEPS.map((sweep) => sweep.name),
		);
	});

	it('exposes the same registry that the helpers act on', () => {
		registerSweep(alwaysHolds);
		expect(sweeps.registered).toEqual(registeredSweeps());
		resetSweeps();
		expect(sweeps.registered).toEqual(STANDING_SWEEPS);
	});
});

describe('failure text', () => {
	it('names the run, every failed sweep, and where every violation is', () => {
		const registry = new SweepRegistry([
			alwaysFails('first', 'caldav.requests[0].url'),
			alwaysFails('second'),
		]);
		expect(describeReports('inbound poll', registry.evaluate(evidence())))
			.toBe(`the run "inbound poll" failed 2 sweeps
  first — 1 violation
    caldav.requests[0].url: first objected
  second — 1 violation
    vault.files: second objected`);
	});
});
