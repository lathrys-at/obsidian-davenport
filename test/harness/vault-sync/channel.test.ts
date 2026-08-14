import { describe, expect, it } from 'vitest';
import type { VaultFileEvent } from '../../../src/core/ports/vault';
import { ControlledClock, DEFAULT_START_TIME } from '../clock';
import {
	SyncDevice,
	SYNC_TOOL_PROFILES,
	VaultSyncChannel,
	bumpVersion,
	syncToolProfile,
	type LandedDelivery,
	type SyncToolProfile,
} from './index';

const RECORD = 'records/abc123.md';
const NOTE = 'Meetings/weekly.md';

function channelOf(
	devices: readonly string[],
	profile?: SyncToolProfile,
	seed?: Readonly<Record<string, string>>,
): { channel: VaultSyncChannel; clock: ControlledClock } {
	const clock = new ControlledClock();
	const channel = new VaultSyncChannel({
		devices,
		clock,
		...(profile === undefined ? {} : { profile }),
		...(seed === undefined ? {} : { seed }),
	});
	return { channel, clock };
}

function recordEvents(device: SyncDevice): VaultFileEvent[] {
	const events: VaultFileEvent[] = [];
	device.onFileEvent((event) => {
		events.push(event);
	});
	return events;
}

function outcomes(landed: readonly LandedDelivery[]): string[] {
	return landed.map((entry) => entry.outcome);
}

describe('vault-sync sending a change to every peer', () => {
	it('makes one waiting delivery for each peer and none for the origin device', async () => {
		const { channel } = channelOf(['a', 'b', 'c']);
		await channel.device('a').write(NOTE, 'one');
		expect(channel.pending().map((delivery) => delivery.to)).toEqual([
			'b',
			'c',
		]);
		await channel.deliver();
		expect(channel.converged()).toBe(true);
		expect(await channel.device('c').read(NOTE)).toBe('one');
	});

	it('delivers to one named peer and keeps the delivery to the other peer waiting', async () => {
		const { channel } = channelOf(['a', 'b', 'c']);
		await channel.device('a').write(NOTE, 'one');
		await channel.deliver({ to: 'b' });
		expect(channel.device('b').holds(NOTE)).toBe(true);
		expect(channel.device('c').holds(NOTE)).toBe(false);
		expect(channel.pending().map((delivery) => delivery.to)).toEqual(['c']);
		await channel.deliver();
		expect(channel.converged()).toBe(true);
	});

	it('applies a delivery and starts no delivery back to the origin device', async () => {
		const { channel } = channelOf(['a', 'b']);
		await channel.device('a').write(NOTE, 'one');
		await channel.deliver();
		expect(channel.pending()).toEqual([]);
	});
});

describe('vault-sync delivery under a script the test writes', () => {
	it('holds the deliveries for one path back until the test releases the hold', async () => {
		const { channel } = channelOf(['a', 'b']);
		const release = channel.hold({ path: RECORD });
		await channel.device('a').write(RECORD, 'record');
		await channel.device('a').write(NOTE, 'note');
		await channel.deliver();
		expect(channel.device('b').paths()).toEqual([NOTE]);
		release();
		await channel.deliver();
		expect(channel.device('b').paths()).toEqual([NOTE, RECORD]);
	});

	it('keeps a held delivery back even when the test asks for that path by name', async () => {
		const { channel } = channelOf(['a', 'b']);
		channel.hold({ path: RECORD });
		await channel.device('a').write(RECORD, 'record');
		expect(await channel.deliver({ path: RECORD })).toEqual([]);
		channel.releaseAll();
		expect(outcomes(await channel.deliver({ path: RECORD }))).toEqual([
			'created',
		]);
	});

	it('delivers in the order the test lists and not in the order the changes were made', async () => {
		const { channel } = channelOf(['a', 'b']);
		const events = recordEvents(channel.device('b'));
		await channel.device('a').write(NOTE, 'note');
		await channel.device('a').write(RECORD, 'record');
		await channel.deliverInOrder([{ path: RECORD }, { path: NOTE }]);
		expect(events.map((event) => event.path)).toEqual([RECORD, NOTE]);
	});

	it('delivers the record first or the note first, as each of the two call names states', async () => {
		for (const [spelling, expected] of [
			['recordBeforeNote', [RECORD, NOTE]],
			['noteBeforeRecord', [NOTE, RECORD]],
		] as const) {
			const { channel } = channelOf(['a', 'b']);
			const events = recordEvents(channel.device('b'));
			await channel.device('a').write(NOTE, 'note');
			await channel.device('a').write(RECORD, 'record');
			await channel[spelling]({ record: RECORD, note: NOTE });
			expect(events.map((event) => event.path)).toEqual(expected);
		}
	});

	it('refuses an order script when one of the two paths has no delivery waiting', async () => {
		const { channel } = channelOf(['a', 'b']);
		await channel.device('a').write(NOTE, 'note');
		await expect(
			channel.noteBeforeRecord({ record: RECORD, note: NOTE }),
		).rejects.toThrow(/nothing pending for records\/abc123\.md/);
	});

	it('delivers the two paths to one named peer and leaves the other peer waiting', async () => {
		const { channel } = channelOf(['a', 'b', 'c']);
		await channel.device('a').write(NOTE, 'note');
		await channel.device('a').write(RECORD, 'record');
		await channel.recordBeforeNote({ record: RECORD, note: NOTE, to: 'b' });
		expect(channel.device('c').paths()).toEqual([]);
		expect(channel.pending({ to: 'c' })).toHaveLength(2);
	});
});

describe('vault-sync deliveries that apply without a conflict', () => {
	it('applies a change that was built on the content the destination already holds', async () => {
		const { channel } = channelOf(['a', 'b']);
		await channel.device('a').write(NOTE, 'one');
		const first = await channel.deliver();
		await channel.device('b').write(NOTE, 'two');
		const second = await channel.deliver();
		await channel.device('a').write(NOTE, 'three');
		const third = await channel.deliver();
		expect(outcomes([...first, ...second, ...third])).toEqual([
			'created',
			'updated',
			'updated',
		]);
		expect(channel.converged()).toBe(true);
	});

	it('calls a delivery converged when the destination already holds the same content', async () => {
		const { channel } = channelOf(['a', 'b']);
		await channel.device('a').write(NOTE, 'one');
		await channel.deliver();
		await channel.device('b').write(NOTE, 'one');
		expect(outcomes(await channel.deliver())).toEqual(['converged']);
	});

	it('deletes a file that the destination has not changed and keeps no modification time for the file', async () => {
		const { channel } = channelOf(['a', 'b'], undefined, { [NOTE]: 'one' });
		await channel.device('a').trash(NOTE);
		const [landed] = await channel.deliver();
		expect(landed?.outcome).toBe('deleted');
		expect(landed?.modifiedAt).toBeNull();
		expect(channel.device('b').paths()).toEqual([]);
		expect(channel.device('b').modifiedAt(NOTE)).toBeNull();
	});
});

describe('vault-sync delivering a rename', () => {
	it('delivers a rename as one move where the profile keeps renames whole', async () => {
		const { channel } = channelOf(
			['a', 'b'],
			syncToolProfile('obsidian-sync'),
			{ 'old.md': 'one' },
		);
		const events = recordEvents(channel.device('b'));
		await channel.device('a').rename('old.md', 'new.md');
		expect(outcomes(await channel.deliver())).toEqual(['renamed']);
		expect(events).toEqual([
			{ kind: 'renamed', path: 'new.md', oldPath: 'old.md' },
		]);
		expect(channel.device('b').paths()).toEqual(['new.md']);
	});

	it('delivers a rename as a deletion and then a creation where the profile splits renames', async () => {
		const { channel } = channelOf(
			['a', 'b'],
			syncToolProfile('syncthing'),
			{
				'old.md': 'one',
			},
		);
		const events = recordEvents(channel.device('b'));
		await channel.device('a').rename('old.md', 'new.md');
		expect(outcomes(await channel.deliver())).toEqual(['created']);
		expect(events).toEqual([
			{ kind: 'deleted', path: 'old.md' },
			{ kind: 'created', path: 'new.md' },
		]);
		expect(channel.device('b').paths()).toEqual(['new.md']);
		expect(await channel.device('b').read('new.md')).toBe('one');
	});

	it('calls a rename duplicated when the destination has edited the file that the rename moves', async () => {
		for (const id of ['obsidian-sync', 'syncthing']) {
			const { channel } = channelOf(['a', 'b'], syncToolProfile(id), {
				'old.md': 'one',
			});
			await channel.device('b').write('old.md', 'from b');
			await channel.device('a').rename('old.md', 'new.md');
			expect(outcomes(await channel.deliver({ from: 'a' }))).toEqual([
				'duplicated',
			]);
			expect(channel.device('b').paths()).toEqual(['new.md', 'old.md']);
			expect(await channel.device('b').read('old.md')).toBe('from b');
		}
	});

	it('creates the new path where the destination never received the old file', async () => {
		const { channel } = channelOf(
			['a', 'b'],
			syncToolProfile('obsidian-sync'),
		);
		channel.hold({ path: 'old.md' });
		await channel.device('a').write('old.md', 'one');
		await channel.device('a').rename('old.md', 'new.md');
		channel.releaseAll();
		expect(outcomes(await channel.deliver({ path: 'new.md' }))).toEqual([
			'created',
		]);
		expect(channel.device('b').paths()).toEqual(['new.md']);
	});
});

describe('vault-sync modification times', () => {
	it('keeps the modification time of the origin device where the profile preserves times', async () => {
		const { channel, clock } = channelOf(
			['a', 'b'],
			syncToolProfile('syncthing'),
		);
		await channel.device('a').write(NOTE, 'one');
		clock.advance(60_000);
		const [landed] = await channel.deliver();
		expect(landed?.modifiedAt).toBe(DEFAULT_START_TIME);
		expect(channel.device('b').modifiedAt(NOTE)).toBe(DEFAULT_START_TIME);
	});

	it('stamps the arrival time on the destination where the profile does not preserve times', async () => {
		const { channel, clock } = channelOf(
			['a', 'b'],
			syncToolProfile('icloud-drive'),
		);
		await channel.device('a').write(NOTE, 'one');
		clock.advance(60_000);
		await channel.deliver();
		expect(channel.device('a').modifiedAt(NOTE)).toBe(DEFAULT_START_TIME);
		expect(channel.device('b').modifiedAt(NOTE)).toBe(
			DEFAULT_START_TIME + 60_000,
		);
	});
});

describe('vault-sync files planted straight into a vault', () => {
	const PLANTED = 'planted by the suite';

	it('overwrites a planted file that carries no version of its own', async () => {
		const { channel } = channelOf(['a', 'b'], syncToolProfile('syncthing'));
		await channel.device('b').vault.write(RECORD, PLANTED);
		await channel.device('a').write(RECORD, 'from a');
		expect(outcomes(await channel.deliver({ from: 'a' }))).toEqual([
			'updated',
		]);
		expect(await channel.device('b').read(RECORD)).toBe('from a');
		expect(channel.pending()).toEqual([]);
	});

	it('makes a conflict copy where the test records a version for the planted file', async () => {
		const { channel } = channelOf(['a', 'b'], syncToolProfile('syncthing'));
		const b = channel.device('b');
		await b.vault.write(RECORD, PLANTED);
		b.noteVersion(RECORD, bumpVersion(b.versionOf(RECORD), b.id));
		await channel.device('a').write(RECORD, 'from a');
		const [landed] = await channel.deliver({ from: 'a' });
		expect(landed?.outcome).toBe('conflict-copy');
		expect(await b.read(landed?.conflictPath ?? '')).toBe(PLANTED);
	});
});

describe('vault-sync channel setup', () => {
	it('refuses a channel with fewer than two devices, and a channel with a repeated device id', () => {
		const clock = new ControlledClock();
		expect(() => new VaultSyncChannel({ devices: ['a'], clock })).toThrow(
			/at least two devices/,
		);
		expect(
			() => new VaultSyncChannel({ devices: ['a', 'a'], clock }),
		).toThrow(/duplicate device a/);
	});

	it('names the devices the channel holds when the test asks for a device that is not there', () => {
		const { channel } = channelOf(['a', 'b']);
		expect(() => channel.device('c')).toThrow(/channel holds a, b/);
	});

	it('gives every device the same seed files and makes no delivery', () => {
		const { channel } = channelOf(['a', 'b'], undefined, { [NOTE]: 'one' });
		expect(channel.converged()).toBe(true);
		expect(channel.pending()).toEqual([]);
		expect(channel.device('b').modifiedAt(NOTE)).toBe(DEFAULT_START_TIME);
	});

	it('returns each profile in the corpus when the test asks for that profile by id', () => {
		for (const profile of SYNC_TOOL_PROFILES) {
			expect(syncToolProfile(profile.id)).toBe(profile);
		}
	});
});
