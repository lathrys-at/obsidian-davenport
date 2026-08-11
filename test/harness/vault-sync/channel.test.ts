import { describe, expect, it } from 'vitest';
import type { VaultFileEvent } from '../../../src/core/ports/vault';
import { ControlledClock, DEFAULT_START_TIME } from '../clock';
import {
	SyncDevice,
	SYNC_TOOL_PROFILES,
	VaultSyncChannel,
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

describe('vault-sync fan-out', () => {
	it('makes one pending delivery per peer and none for the origin', async () => {
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

	it('delivers to one peer and leaves the other pending', async () => {
		const { channel } = channelOf(['a', 'b', 'c']);
		await channel.device('a').write(NOTE, 'one');
		await channel.deliver({ to: 'b' });
		expect(channel.device('b').holds(NOTE)).toBe(true);
		expect(channel.device('c').holds(NOTE)).toBe(false);
		expect(channel.pending().map((delivery) => delivery.to)).toEqual(['c']);
		await channel.deliver();
		expect(channel.converged()).toBe(true);
	});

	it('applies a delivery without originating one back', async () => {
		const { channel } = channelOf(['a', 'b']);
		await channel.device('a').write(NOTE, 'one');
		await channel.deliver();
		expect(channel.pending()).toEqual([]);
	});
});

describe('vault-sync delivery scripting', () => {
	it('holds a path back and delivers it once released', async () => {
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

	it('keeps a held delivery back even when a script names it', async () => {
		const { channel } = channelOf(['a', 'b']);
		channel.hold({ path: RECORD });
		await channel.device('a').write(RECORD, 'record');
		expect(await channel.deliver({ path: RECORD })).toEqual([]);
		channel.releaseAll();
		expect(outcomes(await channel.deliver({ path: RECORD }))).toEqual([
			'created',
		]);
	});

	it('delivers in the scripted order rather than the captured one', async () => {
		const { channel } = channelOf(['a', 'b']);
		const events = recordEvents(channel.device('b'));
		await channel.device('a').write(NOTE, 'note');
		await channel.device('a').write(RECORD, 'record');
		await channel.deliverInOrder([{ path: RECORD }, { path: NOTE }]);
		expect(events.map((event) => event.path)).toEqual([RECORD, NOTE]);
	});

	it('spells both flight-skew orders', async () => {
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

	it('refuses a flight-skew script with nothing in flight', async () => {
		const { channel } = channelOf(['a', 'b']);
		await channel.device('a').write(NOTE, 'note');
		await expect(
			channel.noteBeforeRecord({ record: RECORD, note: NOTE }),
		).rejects.toThrow(/nothing pending for records\/abc123\.md/);
	});

	it('aims a flight-skew script at one peer', async () => {
		const { channel } = channelOf(['a', 'b', 'c']);
		await channel.device('a').write(NOTE, 'note');
		await channel.device('a').write(RECORD, 'record');
		await channel.recordBeforeNote({ record: RECORD, note: NOTE, to: 'b' });
		expect(channel.device('c').paths()).toEqual([]);
		expect(channel.pending({ to: 'c' })).toHaveLength(2);
	});
});

describe('vault-sync clean application', () => {
	it('fast-forwards a change built on what the destination holds', async () => {
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

	it('names a delivery the destination already holds as converged', async () => {
		const { channel } = channelOf(['a', 'b']);
		await channel.device('a').write(NOTE, 'one');
		await channel.deliver();
		await channel.device('b').write(NOTE, 'one');
		expect(outcomes(await channel.deliver())).toEqual(['converged']);
	});

	it('deletes a file the destination has not touched', async () => {
		const { channel } = channelOf(['a', 'b'], undefined, { [NOTE]: 'one' });
		await channel.device('a').trash(NOTE);
		expect(outcomes(await channel.deliver())).toEqual(['deleted']);
		expect(channel.device('b').paths()).toEqual([]);
		expect(channel.device('b').modifiedAt(NOTE)).toBeNull();
	});
});

describe('vault-sync rename delivery', () => {
	it('delivers a rename whole', async () => {
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

	it('delivers a rename as a deletion and a creation', async () => {
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

	it('creates the target where the source never reached the destination', async () => {
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
	it('keeps the origin time where the profile preserves it', async () => {
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

	it('stamps the arrival time where the profile does not', async () => {
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

describe('vault-sync channel setup', () => {
	it('refuses a channel that cannot deliver anything', () => {
		const clock = new ControlledClock();
		expect(() => new VaultSyncChannel({ devices: ['a'], clock })).toThrow(
			/at least two devices/,
		);
		expect(
			() => new VaultSyncChannel({ devices: ['a', 'a'], clock }),
		).toThrow(/duplicate device a/);
	});

	it('names the devices it holds when asked for one it does not', () => {
		const { channel } = channelOf(['a', 'b']);
		expect(() => channel.device('c')).toThrow(/channel holds a, b/);
	});

	it('seeds every device alike without delivering anything', () => {
		const { channel } = channelOf(['a', 'b'], undefined, { [NOTE]: 'one' });
		expect(channel.converged()).toBe(true);
		expect(channel.pending()).toEqual([]);
		expect(channel.device('b').modifiedAt(NOTE)).toBe(DEFAULT_START_TIME);
	});

	it('carries a profile for every tool the corpus names', () => {
		for (const profile of SYNC_TOOL_PROFILES) {
			expect(syncToolProfile(profile.id)).toBe(profile);
		}
	});
});
