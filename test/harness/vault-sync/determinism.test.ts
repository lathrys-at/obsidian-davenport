import { describe, expect, it } from 'vitest';
import { ControlledClock } from '../clock';
import { VaultSyncChannel, syncToolProfile } from './index';

const ONE = 'records/one.md';
const TWO = 'records/two.md';
const NOTE = 'Meetings/two.md';
const RENAMED = 'Meetings/renamed.md';

interface ScriptRun {
	readonly snapshots: readonly string[];
	readonly times: readonly string[];
	readonly log: readonly string[];
}

/**
 * A script over three devices covering every branch a suite leans on:
 * both flight-skew orders, a hold released later, concurrent edits on two
 * devices at once, a rename, and a deletion — with the clock moving
 * between steps so the recorded times differ.
 */
async function runScript(): Promise<ScriptRun> {
	const clock = new ControlledClock();
	const channel = new VaultSyncChannel({
		devices: ['a', 'b', 'c'],
		clock,
		profile: syncToolProfile('syncthing'),
		seed: { [ONE]: 'uid: one\nchecksum: aaaa\n' },
	});
	const [a, b, c] = channel.devices;
	if (a === undefined || b === undefined || c === undefined) {
		throw new Error('expected three devices');
	}

	clock.advance(30_000);
	await a.write(TWO, 'uid: two\nchecksum: bbbb\n');
	await a.write(NOTE, '---\nuid: two\n---\nnotes\n');
	await channel.recordBeforeNote({ record: TWO, note: NOTE, to: 'b' });
	await channel.noteBeforeRecord({ record: TWO, note: NOTE, to: 'c' });

	clock.advance(60_000);
	const releaseC = channel.hold({ from: 'c' });
	await b.write(ONE, 'uid: one\nchecksum: bbbb\n');
	await c.write(ONE, 'uid: one\nchecksum: cccc\n');
	await channel.deliver();

	clock.advance(90_000);
	releaseC();
	await channel.deliver();

	clock.advance(120_000);
	await a.rename(NOTE, RENAMED);
	await channel.deliverInOrder([{ to: 'c' }, { to: 'b' }]);

	clock.advance(15_000);
	await b.trash(TWO);
	await channel.deliver();

	return {
		snapshots: channel.devices.map(
			(device) => `${device.id}\n${device.snapshot()}`,
		),
		times: channel.devices.flatMap((device) =>
			device
				.paths()
				.map(
					(path) =>
						`${device.id} ${path} ${String(device.modifiedAt(path) ?? -1)}`,
				),
		),
		log: channel.log.map(
			(entry) =>
				`${entry.delivery.from}->${entry.delivery.to} ${entry.outcome} ${entry.conflictPath ?? '-'}`,
		),
	};
}

describe('vault-sync determinism', () => {
	it('leaves every device holding the same bytes on every run', async () => {
		const first = await runScript();
		const second = await runScript();
		expect(second.snapshots).toEqual(first.snapshots);
		expect(second.times).toEqual(first.times);
		expect(second.log).toEqual(first.log);
	});

	it('exercises the branches it claims to', async () => {
		const { log, snapshots } = await runScript();
		expect(log.filter((entry) => entry.includes('conflict-copy'))).toEqual([
			'b->c conflict-copy records/one.sync-conflict-20260101-000130-c.md',
			'c->a conflict-copy records/one.sync-conflict-20260101-000130-a.md',
			'c->b conflict-copy records/one.sync-conflict-20260101-000130-b.md',
		]);
		expect(log).toContain('b->a deleted -');
		expect(log).toContain('b->c deleted -');
		expect(snapshots.join('\n')).toContain(RENAMED);
		expect(snapshots.join('\n')).not.toContain(NOTE);
	});
});
