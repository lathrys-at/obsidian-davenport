import { describe, expect, it } from 'vitest';
import { ControlledClock } from '../clock';
import {
	SYNC_TOOL_PROFILES,
	VaultSyncChannel,
	syncToolProfile,
	type DeviceId,
	type LandedDelivery,
	type SyncToolProfile,
} from './index';

const RECORD = 'records/abc123.md';

function channelOf(
	devices: readonly string[],
	profile: SyncToolProfile,
	seed?: Readonly<Record<string, string>>,
): VaultSyncChannel {
	return new VaultSyncChannel({
		devices,
		clock: new ControlledClock(),
		profile,
		...(seed === undefined ? {} : { seed }),
	});
}

function outcomes(landed: readonly LandedDelivery[]): string[] {
	return landed.map((entry) => entry.outcome);
}

function copiesIn(channel: VaultSyncChannel): (string | null)[] {
	return channel.log
		.filter((entry) => entry.conflictPath !== null)
		.map((entry) => entry.conflictPath);
}

/**
 * One device edits the seeded record while the other deletes it, neither
 * having seen the other. Both deliveries are then made, the one from
 * `first` landing before the other.
 */
async function editDeleteRace(
	profile: SyncToolProfile,
	first: DeviceId,
): Promise<VaultSyncChannel> {
	const channel = channelOf(['a', 'b'], profile, { [RECORD]: 'base\n' });
	await channel.device('a').write(RECORD, 'from a\n');
	await channel.device('b').trash(RECORD);
	await channel.deliver({ from: first });
	await channel.deliver();
	return channel;
}

describe('vault-sync causality', () => {
	it('fast-forwards a device that is behind, whatever order the deliveries arrive in', async () => {
		const channel = channelOf(
			['a', 'b', 'c'],
			syncToolProfile('syncthing'),
			{
				[RECORD]: 'v0\n',
			},
		);
		await channel.device('a').write(RECORD, 'v1\n');
		await channel.deliver({ from: 'a', to: 'b' });
		await channel.device('b').write(RECORD, 'v2\n');
		const relayed = await channel.deliver({ from: 'b', to: 'c' });
		const overtaken = await channel.deliver({ from: 'a', to: 'c' });
		await channel.deliver();
		expect(outcomes(relayed)).toEqual(['updated']);
		expect(outcomes(overtaken)).toEqual(['superseded']);
		for (const device of channel.devices) {
			expect(device.paths()).toEqual([RECORD]);
			expect(await device.read(RECORD)).toBe('v2\n');
		}
		expect(channel.converged()).toBe(true);
		expect(copiesIn(channel)).toEqual([]);
	});

	it('copies where two devices edited without seeing each other', async () => {
		const channel = channelOf(
			['a', 'b', 'c'],
			syncToolProfile('syncthing'),
			{
				[RECORD]: 'v0\n',
			},
		);
		await channel.device('a').write(RECORD, 'from a\n');
		await channel.device('c').write(RECORD, 'from c\n');
		expect(outcomes(await channel.deliver({ from: 'a', to: 'c' }))).toEqual(
			['conflict-copy'],
		);
		expect(await channel.device('c').read(RECORD)).toBe('from a\n');
	});

	it('writes nothing for a deletion the destination has already moved past', async () => {
		const channel = channelOf(
			['a', 'b', 'c'],
			syncToolProfile('syncthing'),
			{
				[RECORD]: 'v0\n',
			},
		);
		await channel.device('a').trash(RECORD);
		await channel.deliver({ from: 'a', to: 'b' });
		await channel.device('b').write(RECORD, 'v1\n');
		await channel.deliver({ from: 'b', to: 'c' });
		expect(outcomes(await channel.deliver({ from: 'a', to: 'c' }))).toEqual(
			['superseded'],
		);
		expect(await channel.device('c').read(RECORD)).toBe('v1\n');
	});

	it('tells a device that never held a path from one that deleted it', async () => {
		const channel = channelOf(['a', 'b'], syncToolProfile('syncthing'));
		await channel.device('a').write(RECORD, 'from a\n');
		expect(outcomes(await channel.deliver())).toEqual(['created']);
		await channel.device('b').trash(RECORD);
		await channel.device('a').write(RECORD, 'from a again\n');
		expect(outcomes(await channel.deliver({ from: 'a' }))).toEqual([
			'resurrected',
		]);
	});
});

describe('vault-sync edit against deletion', () => {
	const profiles: readonly SyncToolProfile[] = [
		...SYNC_TOOL_PROFILES,
		{
			...syncToolProfile('syncthing'),
			id: 'overwriting',
			divergentDelivery: 'overwrite',
		},
	];

	for (const profile of profiles) {
		const survives = profile.divergentDelivery !== 'overwrite';
		for (const first of ['a', 'b'] as const) {
			it(`converges under ${profile.id} with the delivery from ${first} landing first`, async () => {
				const channel = await editDeleteRace(profile, first);
				const a = channel.device('a');
				const b = channel.device('b');
				expect(a.paths()).toEqual(survives ? [RECORD] : []);
				expect(b.paths()).toEqual(survives ? [RECORD] : []);
				if (survives) {
					expect(await a.read(RECORD)).toBe('from a\n');
					expect(await b.read(RECORD)).toBe('from a\n');
				}
				expect(channel.converged()).toBe(true);
				expect(copiesIn(channel)).toEqual([]);
			});
		}
	}
});
