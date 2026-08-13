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
 * Makes an edit and a deletion that race each other, and returns the
 * channel.
 *
 * The channel holds two devices, `a` and `b`. Both devices start with the
 * seeded record. Device `a` writes new content to the record. Device `b`
 * deletes the record. Neither device knows about the change of the other
 * device.
 *
 * The function then delivers both changes. The parameter `first` names a
 * device, and the change from that device lands before the other change.
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
	it('brings a device that is behind up to date, in any delivery order', async () => {
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

	it('makes a conflict copy when two devices change the same record without knowledge of each other', async () => {
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

	it('writes nothing when the destination already holds a change made after the deletion', async () => {
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

	it('reports a creation for a device that never held the record, and a resurrection for a device that deleted the record', async () => {
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
			it(`converges under the ${profile.id} profile when the delivery from ${first} lands first`, async () => {
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
