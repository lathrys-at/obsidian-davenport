/**
 * Two devices, one vault, and one server that moved on.
 *
 * One device fetches the new state of the server and writes its record
 * and its note. The other device is stale: its own view of the server is
 * still the old one. Convergence then arrives through two channels that
 * cooperate.
 *
 * - The record of the first device arrives through vault sync, and the
 *   record of the stale device fast-forwards to those bytes. The fetch of
 *   the stale device then computes the same bytes and writes nothing.
 * - The note of the first device arrives through vault sync, and that
 *   arrival corrects the note. The engine of the stale device does not
 *   correct the note: its comparison reads the base that it now holds,
 *   and that base agrees with the server.
 *
 * The engine of the sync loop does not exist yet. The driver below models
 * the one decision of that engine that this claim rests on: a device
 * writes the note only where the state of the server differs from the
 * base that the record of that device holds. Everything else in the
 * driver is the record machinery of this change.
 */

import { describe, expect, it } from 'vitest';
import { WebCryptoDigest } from '../../../src/adapters/digest';
import { parseIcs } from '../../../src/core/ics/parse';
import { NORMALIZATION_VERSIONS } from '../../../src/core/ics/stamp';
import { buildRecord } from '../../../src/core/records/build';
import { readRecord } from '../../../src/core/records/read';
import type { RecordWriteOutcome } from '../../../src/core/records/writer';
import { writeRecord } from '../../../src/core/records/writer';
import { ControlledClock } from '../../harness/clock';
import { RecordingVault } from '../../harness/recording-vault';
import type { SyncDevice } from '../../harness/vault-sync';
import { VaultSyncChannel } from '../../harness/vault-sync';

const digest = new WebCryptoDigest();
const COLLECTION = 'https://dav.example.com/calendars/ren/work/';
const RECORD = 'davenport/records/one.md';
const NOTE = 'Meetings/Standup.md';

function serverIcs(summary: string): string {
	return [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Example//Server//EN',
		'BEGIN:VEVENT',
		'UID:standup',
		'DTSTART:20260302T140000Z',
		`SUMMARY:${summary}`,
		'END:VEVENT',
		'END:VCALENDAR',
		'',
	].join('\r\n');
}

/** The note that a materialization writes for one summary. */
function noteText(summary: string): string {
	return ['---', `summary: ${summary}`, 'uid: standup', '---', '', ''].join(
		'\n',
	);
}

/** What one loop of the driver did on one device. */
interface LoopResult {
	readonly record: RecordWriteOutcome;
	readonly recordWrites: number;
	readonly noteWrites: number;
}

/**
 * One loop of the engine on one device: fetch the state of the server,
 * write the record where the bytes change, and write the note only where
 * the state of the server differs from the base that the record holds.
 */
async function loop(
	device: SyncDevice,
	summary: string,
	counted: RecordingVault,
): Promise<LoopResult> {
	const parsed = parseIcs(serverIcs(summary));
	if (!parsed.ok) {
		throw new Error(parsed.failure.message);
	}
	const built = buildRecord(NORMALIZATION_VERSIONS, {
		identity: { collectionHref: COLLECTION, uid: 'standup' },
		fields: { type: 'event', summary },
		calendar: parsed.calendar,
		venue: { path: NOTE },
	});
	const before = await baseOf(device);
	counted.forget();
	const result = await writeRecord(
		{ vault: counted, digest, versions: NORMALIZATION_VERSIONS },
		RECORD,
		built.data,
	);
	const recordWrites = counted.written.length;
	if (before !== built.data.baseIcs) {
		await counted.write(NOTE, noteText(summary));
	}
	return {
		record: result.outcome,
		recordWrites,
		noteWrites: counted.written.length - recordWrites,
	};
}

/** The base snapshot that the record of the device holds, if it holds one. */
async function baseOf(device: SyncDevice): Promise<string | null> {
	if (!(await device.exists(RECORD))) {
		return null;
	}
	const read = readRecord(await device.read(RECORD));
	return read.ok ? read.data.baseIcs : null;
}

function setUp(): {
	channel: VaultSyncChannel;
	laptop: SyncDevice;
	phone: SyncDevice;
	laptopVault: RecordingVault;
	phoneVault: RecordingVault;
} {
	const channel = new VaultSyncChannel({
		devices: ['laptop', 'phone'],
		clock: new ControlledClock(),
	});
	const laptop = channel.device('laptop');
	const phone = channel.device('phone');
	return {
		channel,
		laptop,
		phone,
		laptopVault: new RecordingVault(laptop),
		phoneVault: new RecordingVault(phone),
	};
}

describe('LG-5 the fetch of the stale device', () => {
	it('LG-5: the record of the stale device fast-forwards, and the fetch writes nothing', async () => {
		const { channel, laptop, phone, laptopVault, phoneVault } = setUp();
		await loop(laptop, 'Standup', laptopVault);
		await channel.deliver();
		await loop(phone, 'Standup', phoneVault);

		// The server moves on, and the laptop alone sees the new state.
		await loop(laptop, 'Standup and coffee', laptopVault);
		const holdTheNote = channel.hold({ path: NOTE });
		await channel.deliver({ path: RECORD, to: 'phone' });
		holdTheNote();

		// The record of the phone now holds the new bytes, and the phone
		// itself has seen nothing of the new state.
		const arrived = await phone.read(RECORD);
		expect(arrived).toBe(await laptop.read(RECORD));

		const result = await loop(phone, 'Standup and coffee', phoneVault);
		expect(result.record).toBe('unchanged');
		expect(result.recordWrites).toBe(0);
		expect(result.noteWrites).toBe(0);
		expect(await phone.read(RECORD)).toBe(arrived);
	});

	it('LG-5: the note of the stale device stays as it was until the copy arrives', async () => {
		const { channel, laptop, phone, laptopVault, phoneVault } = setUp();
		await loop(laptop, 'Standup', laptopVault);
		await channel.deliver();
		await loop(phone, 'Standup', phoneVault);

		await loop(laptop, 'Standup and coffee', laptopVault);
		const holdTheNote = channel.hold({ path: NOTE });
		await channel.deliver({ path: RECORD, to: 'phone' });
		await loop(phone, 'Standup and coffee', phoneVault);
		expect(await phone.read(NOTE)).toBe(noteText('Standup'));

		holdTheNote();
		await channel.deliver({ path: NOTE, to: 'phone' });
		expect(await phone.read(NOTE)).toBe(noteText('Standup and coffee'));
	});

	it('LG-5: the engine of the stale device writes no note', async () => {
		const { channel, laptop, phone, laptopVault, phoneVault } = setUp();
		await loop(laptop, 'Standup', laptopVault);
		await channel.deliver();
		await loop(phone, 'Standup', phoneVault);

		await loop(laptop, 'Standup and coffee', laptopVault);
		await channel.deliver();

		phoneVault.forget();
		await loop(phone, 'Standup and coffee', phoneVault);
		expect(phoneVault.writtenPaths).toEqual([]);
	});

	it('LG-5: the two devices converge with no conflict copy', async () => {
		const { channel, laptop, phone, laptopVault, phoneVault } = setUp();
		await loop(laptop, 'Standup', laptopVault);
		await channel.deliver();
		await loop(phone, 'Standup', phoneVault);
		await loop(laptop, 'Standup and coffee', laptopVault);
		await channel.deliver();
		await loop(phone, 'Standup and coffee', phoneVault);
		await channel.deliver();

		expect(channel.converged()).toBe(true);
		expect(
			channel.log.filter((landed) => landed.outcome === 'conflict-copy'),
		).toEqual([]);
		expect(
			channel.log.every((landed) => landed.conflictPath === null),
		).toBe(true);
	});

	it('LG-5: the note arrives before the record and the answer does not change', async () => {
		const { channel, laptop, phone, laptopVault, phoneVault } = setUp();
		await loop(laptop, 'Standup', laptopVault);
		await channel.deliver();
		await loop(phone, 'Standup', phoneVault);

		await loop(laptop, 'Standup and coffee', laptopVault);
		await channel.noteBeforeRecord({
			record: RECORD,
			note: NOTE,
			to: 'phone',
		});
		const result = await loop(phone, 'Standup and coffee', phoneVault);
		expect(result.record).toBe('unchanged');
		expect(result.recordWrites).toBe(0);
		expect(result.noteWrites).toBe(0);
		expect(channel.converged()).toBe(true);
	});

	it('LG-5: a device that meets a new state of the server does write', async () => {
		// The control for the tests above: the driver writes when the state
		// of the server differs from the base that the record holds. A test
		// that never sees a write proves nothing about a test that must not
		// see one.
		const { laptop, laptopVault } = setUp();
		const first = await loop(laptop, 'Standup', laptopVault);
		expect(first.record).toBe('created');
		expect(first.noteWrites).toBe(1);
		const second = await loop(laptop, 'Standup and coffee', laptopVault);
		expect(second.record).toBe('rewritten');
		expect(second.recordWrites).toBe(1);
		expect(second.noteWrites).toBe(1);
	});
});
