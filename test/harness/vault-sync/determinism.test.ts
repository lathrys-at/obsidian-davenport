import { describe, expect, it } from 'vitest';
import { ControlledClock } from '../clock';
import {
	VaultSyncChannel,
	syncToolProfile,
	type SyncToolProfile,
} from './index';

const ONE = 'records/one.md';
const TWO = 'records/two.md';
const NOTE = 'Meetings/two.md';
const RENAMED = 'Meetings/renamed.md';

interface ScriptRun {
	/** The number of deliveries that still wait when the script ends. */
	readonly pending: number;
	/** True when every device ends with the same bytes. */
	readonly converged: boolean;
	readonly snapshots: readonly string[];
	readonly times: readonly string[];
	readonly log: readonly string[];
}

const SYNCTHING = syncToolProfile('syncthing');
const PROPAGATING: SyncToolProfile = {
	...SYNCTHING,
	id: 'syncthing-propagating',
	propagateConflictCopies: true,
};

/**
 * Runs one script on three devices. The function returns the end state of
 * the devices and the log of the deliveries.
 *
 * The script covers every branch that the tests depend on:
 *
 * 1. A record and its note arrive in both orders: the record first on one
 *    device, and the note first on a second device.
 * 2. A hold keeps the deliveries from one device back, and a later step
 *    releases the hold.
 * 3. Two devices change the same record without knowledge of each other.
 * 4. One device renames a note.
 * 5. One device deletes a record.
 *
 * The clock moves forward between the steps. The times that the devices
 * record are therefore different from each other.
 */
async function runScript(profile: SyncToolProfile): Promise<ScriptRun> {
	const clock = new ControlledClock();
	const channel = new VaultSyncChannel({
		devices: ['a', 'b', 'c'],
		clock,
		profile,
		seed: { [ONE]: 'uid: one\nchecksum: aaaa\n' },
	});
	const [a, b, c] = channel.devices;
	if (a === undefined || b === undefined || c === undefined) {
		throw new Error(
			'vault-sync determinism: the channel holds fewer than three devices; the script needs three devices',
		);
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
	await channel.deliver();

	return {
		pending: channel.pending().length,
		converged: channel.converged(),
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
	for (const profile of [SYNCTHING, PROPAGATING]) {
		it(`gives the same bytes, the same modification times, and the same deliveries when the script runs twice under the ${profile.id} profile`, async () => {
			const first = await runScript(profile);
			const second = await runScript(profile);
			expect(first.pending).toBe(0);
			expect(second.snapshots).toEqual(first.snapshots);
			expect(second.times).toEqual(first.times);
			expect(second.log).toEqual(first.log);
		});
	}

	it('produces the conflict copies, the deletions, and the rename that the script covers, and leaves every device with the same bytes', async () => {
		const { log, snapshots, converged } = await runScript(SYNCTHING);
		expect(log.filter((entry) => entry.includes('conflict-copy'))).toEqual([
			'b->c conflict-copy records/one.sync-conflict-20260101-000130-c.md',
			'c->a conflict-copy records/one.sync-conflict-20260101-000130-c.md',
			'c->b conflict-copy records/one.sync-conflict-20260101-000130-c.md',
		]);
		expect(log).toContain('b->a deleted -');
		expect(log).toContain('b->c deleted -');
		expect(snapshots.join('\n')).toContain(RENAMED);
		expect(snapshots.join('\n')).not.toContain(NOTE);
		expect(converged).toBe(true);
	});
});
