import { describe, expect, it } from 'vitest';
import { ControlledClock, DEFAULT_START_TIME } from '../clock';
import {
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
 * Both devices edit the seeded file without seeing each other, which is
 * the state every resolution below has to answer for.
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
		throw new Error('expected one landed delivery');
	}
	return first;
}

describe('vault-sync conflict copies', () => {
	it('names the copy by the profile pattern and lands the delivery', async () => {
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

	it('numbers a counted pattern past a copy already there', async () => {
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

	it('numbers an uncounted pattern that renders the same name twice', async () => {
		const profile: SyncToolProfile = {
			id: 'timestamped',
			conflictCopyPattern:
				'{dir}{stem} (conflicted copy {timestamp}){ext}',
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

	it('keeps the copy at the time of the content it holds', async () => {
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

	it('names a copy after the time of the content it moves aside', async () => {
		const { channel, clock } = await diverge(syncToolProfile('syncthing'));
		clock.advance(60_000);
		await channel.device('b').write(RECORD, 'from b later\n');
		clock.advance(60_000);
		expect(
			only(await channel.deliver({ from: 'a', to: 'b' })).conflictPath,
		).toBe('records/abc123.sync-conflict-20260101-000200-b.md');
		expect(
			channel
				.device('b')
				.modifiedAt(
					'records/abc123.sync-conflict-20260101-000200-b.md',
				),
		).toBe(DEFAULT_START_TIME + 120_000);
	});
});

describe('vault-sync divergence resolution', () => {
	it('overwrites where the profile says so', async () => {
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

	it('merges where the profile merges', async () => {
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

	it('falls back to a copy where the merge declines', async () => {
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

	it('merges the way the profile says and lets the channel override it', async () => {
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

	it('overwrites where the merge declines and the profile makes no copies', async () => {
		const { channel } = await diverge(syncToolProfile('git'), declineMerge);
		const landed = only(await channel.deliver({ from: 'a', to: 'b' }));
		expect(landed.outcome).toBe('overwritten');
		expect(channel.device('b').paths()).toEqual([RECORD]);
	});

	it('treats independent creation of one path as a divergence', async () => {
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

	it('restores a file the destination deleted under a remote edit', async () => {
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

describe('vault-sync conflict-copy propagation', () => {
	const COPY_FROM_B = 'records/abc123.sync-conflict-20260101-000100-b.md';
	const COPY_FROM_A = 'records/abc123.sync-conflict-20260101-000100-a.md';

	function propagating(id: string): SyncToolProfile {
		return { ...syncToolProfile(id), propagateConflictCopies: true };
	}

	it('leaves the copy where it was made by default', async () => {
		const { channel } = await diverge(syncToolProfile('syncthing'));
		expect(
			only(await channel.deliver({ from: 'a', to: 'b' })).conflictPath,
		).toBe(COPY_FROM_B);
		expect(channel.pending().map((delivery) => delivery.to)).toEqual(['a']);
		expect(channel.device('a').paths()).toEqual([RECORD]);
	});

	it('sends the copy to the peers where the profile propagates', async () => {
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

	it('carries a propagated copy once and never breeds another', async () => {
		const { channel } = await diverge(propagating('syncthing'));
		await channel.deliver();
		expect(
			channel.pending().map((delivery) => delivery.change.path),
		).toEqual([COPY_FROM_B, COPY_FROM_A]);
		await channel.deliver();
		expect(channel.pending()).toEqual([]);
		expect(
			channel.log.filter((entry) => entry.outcome === 'conflict-copy'),
		).toHaveLength(2);
		expect(channel.device('a').paths()).toEqual([
			RECORD,
			COPY_FROM_A,
			COPY_FROM_B,
		]);
		expect(channel.device('b').paths()).toEqual(
			channel.device('a').paths(),
		);
	});

	it('drops a copy onto a name the destination already used', async () => {
		const { channel } = await diverge(propagating('icloud-drive'));
		await channel.deliver();
		expect(
			outcomes(await channel.deliver()).filter(
				(outcome) => outcome === 'kept-local',
			),
		).toEqual(['kept-local', 'kept-local']);
		expect(channel.pending()).toEqual([]);
		expect(channel.device('a').paths()).toEqual([
			'records/abc123 2.md',
			RECORD,
		]);
		expect(await channel.device('a').read('records/abc123 2.md')).toBe(
			'from a\n',
		);
		expect(await channel.device('b').read('records/abc123 2.md')).toBe(
			'from b\n',
		);
	});
});

describe('vault-sync divergent deletion', () => {
	it('keeps a locally edited file a copying profile would not destroy', async () => {
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

	it('applies the deletion where the profile overwrites', async () => {
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

	it('names a deletion of a file already gone as converged', async () => {
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
