import { describe, expect, it } from 'vitest';
import { ControlledClock, DEFAULT_START_TIME } from '../clock';
import {
	SYNC_TOOL_PROFILES,
	VaultSyncChannel,
	declineMerge,
	lineMergeMangler,
	syncToolProfile,
	type LandedDelivery,
	type MergeMangler,
	type SyncToolProfile,
} from './index';

const RECORD = 'records/abc123.md';

interface Diverged {
	readonly channel: VaultSyncChannel;
	readonly clock: ControlledClock;
}

/**
 * Makes a divergence. Device `a` and device `b` each write the seeded
 * file, and neither device sees the write of the other device. Every
 * resolution that this file tests must handle this state. The function
 * returns the channel and the clock that the channel uses.
 */
async function diverge(
	profile: SyncToolProfile,
	merger?: MergeMangler,
	seed = 'base\n',
	local = 'from b\n',
	incoming = 'from a\n',
): Promise<Diverged> {
	const clock = new ControlledClock();
	const channel = new VaultSyncChannel({
		devices: ['a', 'b'],
		clock,
		profile,
		...(merger === undefined ? {} : { merger }),
		seed: { [RECORD]: seed },
	});
	clock.advance(60_000);
	await channel.device('a').write(RECORD, incoming);
	await channel.device('b').write(RECORD, local);
	return { channel, clock };
}

function outcomes(landed: readonly LandedDelivery[]): string[] {
	return landed.map((entry) => entry.outcome);
}

function only(landed: readonly LandedDelivery[]): LandedDelivery {
	expect(landed).toHaveLength(1);
	const [first] = landed;
	if (first === undefined) {
		throw new Error(
			'the list of landed deliveries has one entry, but the entry is not a delivery',
		);
	}
	return first;
}

describe('vault-sync conflict copies', () => {
	it('names the copy from the pattern of the profile and writes the delivered content to the record path', async () => {
		const { channel } = await diverge(syncToolProfile('syncthing'));
		const landed = only(await channel.deliver({ from: 'a', to: 'b' }));
		expect(landed.outcome).toBe('conflict-copy');
		expect(landed.conflictPath).toBe(
			'records/abc123.sync-conflict-20260101-000100-b.md',
		);
		const b = channel.device('b');
		expect(await b.read(RECORD)).toBe('from a\n');
		expect(
			await b.read('records/abc123.sync-conflict-20260101-000100-b.md'),
		).toBe('from b\n');
	});

	it('takes the next number when the pattern has a counter and a copy is already there', async () => {
		const { channel } = await diverge(syncToolProfile('icloud-drive'));
		expect(
			only(await channel.deliver({ from: 'a', to: 'b' })).conflictPath,
		).toBe('records/abc123 2.md');
		await channel.device('a').write(RECORD, 'from a again\n');
		await channel.device('b').write(RECORD, 'from b again\n');
		expect(
			only(await channel.deliver({ from: 'a', to: 'b' })).conflictPath,
		).toBe('records/abc123 3.md');
	});

	it('adds a number when a pattern without a counter renders the same name twice', async () => {
		const profile: SyncToolProfile = {
			id: 'timestamped',
			conflictCopyPattern:
				'{dir}{stem} (conflicted copy {timestamp}){ext}',
			divergenceWinner: 'newest',
			divergentDelivery: 'conflict-copy',
			propagateConflictCopies: false,
			renameDelivery: 'rename',
			preserveModificationTimes: true,
		};
		const { channel } = await diverge(profile);
		expect(
			only(await channel.deliver({ from: 'a', to: 'b' })).conflictPath,
		).toBe('records/abc123 (conflicted copy 20260101-000100).md');
		await channel.device('a').write(RECORD, 'from a again\n');
		await channel.device('b').write(RECORD, 'from b again\n');
		expect(
			only(await channel.deliver({ from: 'a', to: 'b' })).conflictPath,
		).toBe('records/abc123 (conflicted copy 20260101-000100) 2.md');
	});

	it('keeps the copy at the time of the content that the copy holds', async () => {
		const { channel, clock } = await diverge(
			syncToolProfile('icloud-drive'),
		);
		clock.advance(60_000);
		const landed = only(await channel.deliver({ from: 'a', to: 'b' }));
		const b = channel.device('b');
		expect(landed.modifiedAt).toBe(DEFAULT_START_TIME + 120_000);
		expect(b.modifiedAt(RECORD)).toBe(DEFAULT_START_TIME + 120_000);
		expect(b.modifiedAt('records/abc123 2.md')).toBe(
			DEFAULT_START_TIME + 60_000,
		);
	});

	it('names the copy after the time of the content that the copy moves aside', async () => {
		const clock = new ControlledClock();
		const channel = new VaultSyncChannel({
			devices: ['a', 'b'],
			clock,
			profile: syncToolProfile('syncthing'),
			seed: { [RECORD]: 'base\n' },
		});
		clock.advance(60_000);
		await channel.device('b').write(RECORD, 'from b\n');
		clock.advance(60_000);
		await channel.device('a').write(RECORD, 'from a\n');
		clock.advance(60_000);
		const copyPath = 'records/abc123.sync-conflict-20260101-000100-b.md';
		const b = channel.device('b');
		expect(
			only(await channel.deliver({ from: 'a', to: 'b' })).conflictPath,
		).toBe(copyPath);
		expect(b.modifiedAt(copyPath)).toBe(DEFAULT_START_TIME + 60_000);
		expect(b.modifiedAt(RECORD)).toBe(DEFAULT_START_TIME + 120_000);
	});
});

describe('vault-sync divergence resolution', () => {
	it('overwrites the local content when the profile says overwrite', async () => {
		const profile: SyncToolProfile = {
			...syncToolProfile('syncthing'),
			divergentDelivery: 'overwrite',
		};
		const { channel } = await diverge(profile);
		const landed = only(await channel.deliver({ from: 'a', to: 'b' }));
		expect(landed.outcome).toBe('overwritten');
		expect(landed.conflictPath).toBeNull();
		expect(channel.device('b').paths()).toEqual([RECORD]);
	});

	it('merges the two sides when the profile says merge', async () => {
		const { channel } = await diverge(
			syncToolProfile('obsidian-sync'),
			lineMergeMangler(),
			'uid: one\nsummary: Weekly sync\nstart: 09:00\n',
			'uid: one\nsummary: Weekly catch-up\nstart: 09:00\n',
			'uid: one\nsummary: Weekly sync\nstart: 10:00\n',
		);
		const landed = only(await channel.deliver({ from: 'a', to: 'b' }));
		expect(landed.outcome).toBe('merged');
		expect(await channel.device('b').read(RECORD)).toBe(
			'uid: one\nsummary: Weekly catch-up\nstart: 10:00\n',
		);
	});

	it('makes a conflict copy when the merge declines', async () => {
		const { channel } = await diverge(
			syncToolProfile('obsidian-sync'),
			declineMerge,
		);
		const landed = only(await channel.deliver({ from: 'a', to: 'b' }));
		expect(landed.outcome).toBe('conflict-copy');
		expect(landed.conflictPath).toBe(
			'records/abc123 (conflicted copy 20260101-000100).md',
		);
	});

	it('uses the merger of the profile, and lets a merger given to the channel win', async () => {
		const profile: SyncToolProfile = {
			...syncToolProfile('obsidian-sync'),
			merger: () => 'from the profile\n',
		};
		const byProfile = await diverge(profile);
		expect(
			only(await byProfile.channel.deliver({ from: 'a', to: 'b' }))
				.outcome,
		).toBe('merged');
		expect(await byProfile.channel.device('b').read(RECORD)).toBe(
			'from the profile\n',
		);
		const overridden = await diverge(profile, declineMerge);
		expect(
			only(await overridden.channel.deliver({ from: 'a', to: 'b' }))
				.outcome,
		).toBe('conflict-copy');
	});

	it('overwrites the local content when the merge declines and the profile makes no copies', async () => {
		const { channel } = await diverge(syncToolProfile('git'), declineMerge);
		const landed = only(await channel.deliver({ from: 'a', to: 'b' }));
		expect(landed.outcome).toBe('overwritten');
		expect(channel.device('b').paths()).toEqual([RECORD]);
	});

	it('treats the creation of one path on two devices, where neither device sees the write of the other device, as a divergence', async () => {
		const clock = new ControlledClock();
		const channel = new VaultSyncChannel({
			devices: ['a', 'b'],
			clock,
			profile: syncToolProfile('obsidian-sync'),
		});
		await channel.device('a').write(RECORD, 'from a\n');
		await channel.device('b').write(RECORD, 'from b\n');
		const landed = only(await channel.deliver({ from: 'a', to: 'b' }));
		expect(landed.outcome).toBe('conflict-copy');
		expect(await channel.device('b').read(RECORD)).toBe('from a\n');
	});

	it('brings back a file that the origin edited and the destination deleted', async () => {
		const clock = new ControlledClock();
		const channel = new VaultSyncChannel({
			devices: ['a', 'b'],
			clock,
			profile: syncToolProfile('syncthing'),
			seed: { [RECORD]: 'base\n' },
		});
		await channel.device('b').trash(RECORD);
		await channel.device('a').write(RECORD, 'from a\n');
		const landed = only(await channel.deliver({ from: 'a', to: 'b' }));
		expect(landed.outcome).toBe('resurrected');
		expect(await channel.device('b').read(RECORD)).toBe('from a\n');
	});
});

describe('vault-sync divergence winner', () => {
	const profiles: readonly SyncToolProfile[] = [
		...SYNC_TOOL_PROFILES,
		{
			...syncToolProfile('syncthing'),
			id: 'overwriting',
			divergentDelivery: 'overwrite',
		},
	];

	/**
	 * Makes a divergence and then delivers everything. Device `a` and
	 * device `b` each write the seeded file, and neither device sees the
	 * write of the other device. Device `a` writes after device `b`. The
	 * function then delivers the pending deliveries again and again,
	 * until no delivery is left. The function returns the channel.
	 */
	async function toExhaustion(
		profile: SyncToolProfile,
	): Promise<VaultSyncChannel> {
		const clock = new ControlledClock();
		const channel = new VaultSyncChannel({
			devices: ['a', 'b'],
			clock,
			profile,
			seed: { [RECORD]: 'base\n' },
		});
		clock.advance(60_000);
		await channel.device('b').write(RECORD, 'from b\n');
		clock.advance(60_000);
		await channel.device('a').write(RECORD, 'from a\n');
		while (channel.pending().length > 0) {
			await channel.deliver();
		}
		return channel;
	}

	for (const profile of profiles) {
		for (const propagate of [false, true]) {
			it(`converges on the same bytes under ${profile.id} when copy propagation is ${propagate ? 'on' : 'off'}`, async () => {
				const channel = await toExhaustion({
					...profile,
					propagateConflictCopies: propagate,
				});
				const a = channel.device('a');
				const b = channel.device('b');
				expect(await a.read(RECORD)).toBe('from a\n');
				expect(await b.read(RECORD)).toBe('from a\n');
				const copies = a.paths().filter((path) => path !== RECORD);
				expect(copies).toHaveLength(
					profile.divergentDelivery === 'conflict-copy' ? 1 : 0,
				);
				for (const copy of copies) {
					expect(await a.read(copy)).toBe('from b\n');
				}
				expect(channel.converged()).toBe(true);
			});
		}
	}

	it('keeps the local content when the local device wrote after the origin', async () => {
		const clock = new ControlledClock();
		const channel = new VaultSyncChannel({
			devices: ['a', 'b'],
			clock,
			profile: syncToolProfile('syncthing'),
			seed: { [RECORD]: 'base\n' },
		});
		await channel.device('a').write(RECORD, 'from a\n');
		clock.advance(60_000);
		await channel.device('b').write(RECORD, 'from b\n');
		const landed = only(await channel.deliver({ from: 'a', to: 'b' }));
		expect(landed.outcome).toBe('conflict-copy');
		expect(landed.conflictPath).toBe(
			'records/abc123.sync-conflict-20260101-000000-a.md',
		);
		expect(await channel.device('b').read(RECORD)).toBe('from b\n');
	});

	it('gives the path to the side that the profile names, incoming or local', async () => {
		for (const [winner, expected] of [
			['incoming', 'from a\n'],
			['local', 'from b\n'],
		] as const) {
			const clock = new ControlledClock();
			const channel = new VaultSyncChannel({
				devices: ['a', 'b'],
				clock,
				profile: {
					...syncToolProfile('syncthing'),
					divergenceWinner: winner,
				},
				seed: { [RECORD]: 'base\n' },
			});
			await channel.device('a').write(RECORD, 'from a\n');
			clock.advance(60_000);
			await channel.device('b').write(RECORD, 'from b\n');
			await channel.deliver({ from: 'a', to: 'b' });
			expect(await channel.device('b').read(RECORD)).toBe(expected);
		}
	});
});

describe('vault-sync three-way divergence', () => {
	const COPY_FROM_B = 'records/abc123.sync-conflict-20260101-000000-b.md';
	const COPY_FROM_C = 'records/abc123.sync-conflict-20260101-000000-c.md';

	async function raceOnThree(
		devices: readonly string[],
	): Promise<VaultSyncChannel> {
		const channel = new VaultSyncChannel({
			devices,
			clock: new ControlledClock(),
			profile: syncToolProfile('syncthing'),
			seed: { [RECORD]: 'base\n' },
		});
		for (const id of ['a', 'b', 'c']) {
			await channel.device(id).write(RECORD, `from ${id}\n`);
		}
		return channel;
	}

	it('leaves a fourth device with the same bytes in every arrival order', async () => {
		const seen = new Set<string>();
		for (const order of [
			['a', 'b', 'c'],
			['a', 'c', 'b'],
			['b', 'a', 'c'],
			['b', 'c', 'a'],
			['c', 'a', 'b'],
			['c', 'b', 'a'],
		]) {
			const channel = await raceOnThree(['a', 'b', 'c', 'd']);
			await channel.deliverInOrder(
				order.map((from) => ({ from, to: 'd' })),
			);
			const d = channel.device('d');
			expect(d.paths()).toEqual([RECORD, COPY_FROM_B, COPY_FROM_C]);
			expect(await d.read(RECORD)).toBe('from a\n');
			seen.add(d.snapshot());
		}
		expect(seen.size).toBe(1);
	});

	it('leaves every device with the same bytes after every delivery lands', async () => {
		const channel = await raceOnThree(['a', 'b', 'c', 'd']);
		while (channel.pending().length > 0) {
			await channel.deliver();
		}
		for (const device of channel.devices) {
			expect(device.paths()).toEqual([RECORD, COPY_FROM_B, COPY_FROM_C]);
		}
		expect(channel.converged()).toBe(true);
	});
});

describe('vault-sync conflict-copy propagation', () => {
	const COPY_FROM_B = 'records/abc123.sync-conflict-20260101-000100-b.md';

	function propagating(id: string): SyncToolProfile {
		return { ...syncToolProfile(id), propagateConflictCopies: true };
	}

	it('leaves the copy on the device that made the copy, by default', async () => {
		const { channel } = await diverge(syncToolProfile('syncthing'));
		expect(
			only(await channel.deliver({ from: 'a', to: 'b' })).conflictPath,
		).toBe(COPY_FROM_B);
		expect(channel.pending().map((delivery) => delivery.to)).toEqual(['a']);
		expect(channel.device('a').paths()).toEqual([RECORD]);
	});

	it('sends the copy to the peers when the profile propagates copies', async () => {
		const { channel } = await diverge(propagating('syncthing'));
		expect(
			only(await channel.deliver({ from: 'a', to: 'b' })).conflictPath,
		).toBe(COPY_FROM_B);
		const [copy] = channel.pending({ path: COPY_FROM_B });
		expect(copy?.from).toBe('b');
		expect(copy?.conflictCopy).toBe(true);
		const landed = only(await channel.deliver({ path: COPY_FROM_B }));
		expect(landed.outcome).toBe('created');
		expect(landed.conflictPath).toBeNull();
		expect(channel.device('a').paths()).toEqual([RECORD, COPY_FROM_B]);
	});

	it('carries a propagated copy once and makes no new copy from that copy', async () => {
		const { channel } = await diverge(propagating('syncthing'));
		await channel.deliver();
		expect(
			channel.pending().map((delivery) => delivery.change.path),
		).toEqual([COPY_FROM_B, COPY_FROM_B]);
		expect(outcomes(await channel.deliver())).toEqual([
			'converged',
			'converged',
		]);
		expect(channel.pending()).toEqual([]);
		expect(
			channel.log.filter((entry) => entry.outcome === 'conflict-copy'),
		).toHaveLength(2);
		expect(channel.device('a').paths()).toEqual([RECORD, COPY_FROM_B]);
		expect(channel.converged()).toBe(true);
	});

	it('discards a copy when the destination already holds other content at that name', async () => {
		const clock = new ControlledClock();
		const channel = new VaultSyncChannel({
			devices: ['a', 'b', 'c'],
			clock,
			profile: propagating('icloud-drive'),
			seed: { [RECORD]: 'base\n' },
		});
		const copyPath = 'records/abc123 2.md';
		for (const id of ['a', 'b', 'c']) {
			await channel.device(id).write(RECORD, `from ${id}\n`);
		}
		await channel.deliver();
		const copies = await channel.deliver();
		expect(copies.length).toBeGreaterThan(0);
		expect(copies.every((entry) => entry.delivery.conflictCopy)).toBe(true);
		expect([...new Set(outcomes(copies))].sort()).toEqual([
			'converged',
			'kept-local',
		]);
		expect(channel.pending()).toEqual([]);
		expect(await channel.device('b').read(copyPath)).toBe('from b\n');
		expect(await channel.device('c').read(copyPath)).toBe('from c\n');
		expect(channel.converged()).toBe(false);
	});
});

describe('vault-sync divergent deletion', () => {
	it('keeps the local edit when the origin deletes the file and the profile makes copies', async () => {
		const clock = new ControlledClock();
		const channel = new VaultSyncChannel({
			devices: ['a', 'b'],
			clock,
			profile: syncToolProfile('syncthing'),
			seed: { [RECORD]: 'base\n' },
		});
		await channel.device('b').write(RECORD, 'from b\n');
		await channel.device('a').trash(RECORD);
		const landed = only(await channel.deliver({ from: 'a', to: 'b' }));
		expect(landed.outcome).toBe('kept-local');
		expect(await channel.device('b').read(RECORD)).toBe('from b\n');
	});

	it('applies the deletion when the profile says overwrite', async () => {
		const clock = new ControlledClock();
		const channel = new VaultSyncChannel({
			devices: ['a', 'b'],
			clock,
			profile: {
				...syncToolProfile('syncthing'),
				divergentDelivery: 'overwrite',
			},
			seed: { [RECORD]: 'base\n' },
		});
		await channel.device('b').write(RECORD, 'from b\n');
		await channel.device('a').trash(RECORD);
		expect(
			only(await channel.deliver({ from: 'a', to: 'b' })).outcome,
		).toBe('overwritten');
		expect(channel.device('b').paths()).toEqual([]);
	});

	it('names the outcome converged when the origin deletes a file that the destination already deleted', async () => {
		const clock = new ControlledClock();
		const channel = new VaultSyncChannel({
			devices: ['a', 'b'],
			clock,
			seed: { [RECORD]: 'base\n' },
		});
		await channel.device('b').trash(RECORD);
		await channel.device('a').trash(RECORD);
		expect(
			only(await channel.deliver({ from: 'a', to: 'b' })).outcome,
		).toBe('converged');
	});
});
