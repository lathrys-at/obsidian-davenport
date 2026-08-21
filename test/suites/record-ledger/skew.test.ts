/**
 * The rule that stops two devices at two versions from rewriting one
 * record in turn.
 *
 * A record states the versions that wrote it, in the two components of
 * the normalization stamp. A device compares each component that the
 * record carries against its own value for that component. The device
 * rewrites the record one time when no compared component of the device
 * is older, and one compared component is newer. In every other case the
 * device treats the difference as bytes alone, and it writes nothing.
 *
 * The tests below run the matrix of the two components, and then run the
 * two devices against one file for more than ten loops. The evidence is
 * the number of writes.
 */

import { describe, expect, it } from 'vitest';
import { WebCryptoDigest } from '../../../src/adapters/digest';
import { parseIcs } from '../../../src/core/ics/parse';
import type { NormalizationVersions } from '../../../src/core/model/normalization';
import { buildRecord } from '../../../src/core/records/build';
import { sealRecord } from '../../../src/core/records/checksum';
import type { RecordWriteOutcome } from '../../../src/core/records/writer';
import { writeRecord } from '../../../src/core/records/writer';
import { FakeVault } from '../../harness/obsidian-fake';
import { RecordingVault } from '../../harness/recording-vault';

const digest = new WebCryptoDigest();
const PATH = 'davenport/records/one.md';
const COLLECTION = 'https://dav.example.com/calendars/ren/work/';

/**
 * A record that names a zone of the bundled table. Such a record carries
 * both components of the stamp, so the matrix below can move each one.
 */
const IN_A_ZONE = [
	'BEGIN:VEVENT',
	'UID:skew',
	'DTSTART;TZID=America/New_York:20260302T090000',
	'END:VEVENT',
];

/** A record that names no zone. Such a record carries the core component alone. */
const IN_NO_ZONE = [
	'BEGIN:VEVENT',
	'UID:skew',
	'DTSTART:20260302T140000Z',
	'END:VEVENT',
];

function calendarOf(lines: readonly string[]) {
	const parsed = parseIcs(
		[
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//Davenport//skew//EN',
			...lines,
			'END:VCALENDAR',
			'',
		].join('\r\n'),
	);
	if (!parsed.ok) {
		throw new Error(parsed.failure.message);
	}
	return parsed.calendar;
}

function recordOf(versions: NormalizationVersions, lines: readonly string[]) {
	return buildRecord(versions, {
		identity: { collectionHref: COLLECTION, uid: 'skew' },
		fields: { type: 'event' },
		calendar: calendarOf(lines),
	}).data;
}

async function fileOf(
	versions: NormalizationVersions,
	lines: readonly string[],
): Promise<string> {
	return sealRecord(digest, recordOf(versions, lines));
}

function deviceWith(files: Readonly<Record<string, string>>): RecordingVault {
	return new RecordingVault(new FakeVault(files));
}

async function runOnce(
	device: NormalizationVersions,
	record: NormalizationVersions,
	lines: readonly string[],
): Promise<{ outcome: RecordWriteOutcome; writes: number }> {
	const vault = deviceWith({ [PATH]: await fileOf(record, lines) });
	vault.forget();
	const result = await writeRecord(
		{ vault, digest, versions: device },
		PATH,
		recordOf(device, lines),
	);
	return { outcome: result.outcome, writes: vault.written.length };
}

interface SkewCase {
	readonly name: string;
	readonly device: NormalizationVersions;
	readonly record: NormalizationVersions;
	readonly outcome: RecordWriteOutcome;
}

/**
 * The matrix of the two components. The record of each case names a zone
 * of the table, so the record carries both components and the rule
 * compares both.
 */
const MATRIX: readonly SkewCase[] = [
	{
		name: 'the device is newer on the core component',
		device: { core: 2, timezone: 1 },
		record: { core: 1, timezone: 1 },
		outcome: 'restamped',
	},
	{
		name: 'the device is older on the core component',
		device: { core: 1, timezone: 1 },
		record: { core: 2, timezone: 1 },
		outcome: 'suppressed',
	},
	{
		name: 'the device is newer on the timezone component',
		device: { core: 1, timezone: 2 },
		record: { core: 1, timezone: 1 },
		outcome: 'restamped',
	},
	{
		name: 'the device is older on the timezone component',
		device: { core: 1, timezone: 1 },
		record: { core: 1, timezone: 2 },
		outcome: 'suppressed',
	},
	{
		name: 'the device is newer on both components',
		device: { core: 2, timezone: 2 },
		record: { core: 1, timezone: 1 },
		outcome: 'restamped',
	},
	{
		name: 'the device is older on the core component and newer on the timezone component',
		device: { core: 1, timezone: 2 },
		record: { core: 2, timezone: 1 },
		outcome: 'suppressed',
	},
	{
		name: 'the device is newer on the core component and older on the timezone component',
		device: { core: 2, timezone: 1 },
		record: { core: 1, timezone: 2 },
		outcome: 'suppressed',
	},
	{
		name: 'the two stamps agree',
		device: { core: 1, timezone: 1 },
		record: { core: 1, timezone: 1 },
		outcome: 'unchanged',
	},
];

describe('LG-4 the matrix of the two components', () => {
	it.each(MATRIX)('LG-4: $name', async (entry) => {
		const run = await runOnce(entry.device, entry.record, IN_A_ZONE);
		expect(run.outcome).toBe(entry.outcome);
		expect(run.writes).toBe(entry.outcome === 'restamped' ? 1 : 0);
	});
});

describe('LG-4 a record that carries the core component alone', () => {
	it('LG-4: the rule reads only the components that the record carries', async () => {
		const run = await runOnce(
			{ core: 1, timezone: 5 },
			{ core: 1, timezone: 1 },
			IN_NO_ZONE,
		);
		expect(run.outcome).toBe('unchanged');
		expect(run.writes).toBe(0);
	});

	it('LG-4: a device that is newer on the core component rewrites', async () => {
		const run = await runOnce(
			{ core: 2, timezone: 1 },
			{ core: 1, timezone: 9 },
			IN_NO_ZONE,
		);
		expect(run.outcome).toBe('restamped');
	});
});

describe('LG-4 two devices that run against one file', () => {
	const OLDER: NormalizationVersions = { core: 1, timezone: 1 };
	const NEWER: NormalizationVersions = { core: 2, timezone: 1 };

	it('LG-4: the newer device rewrites one time over twelve loops', async () => {
		const vault = deviceWith({ [PATH]: await fileOf(OLDER, IN_A_ZONE) });
		vault.forget();
		const outcomes: RecordWriteOutcome[] = [];
		for (let loop = 0; loop < 12; loop += 1) {
			outcomes.push(
				(
					await writeRecord(
						{ vault, digest, versions: NEWER },
						PATH,
						recordOf(NEWER, IN_A_ZONE),
					)
				).outcome,
			);
		}
		expect(outcomes[0]).toBe('restamped');
		expect(outcomes.slice(1)).toEqual(Array(11).fill('unchanged'));
		expect(vault.written).toHaveLength(1);
	});

	it('LG-4: the older device writes nothing over twelve loops', async () => {
		const vault = deviceWith({ [PATH]: await fileOf(NEWER, IN_A_ZONE) });
		vault.forget();
		for (let loop = 0; loop < 12; loop += 1) {
			const result = await writeRecord(
				{ vault, digest, versions: OLDER },
				PATH,
				recordOf(OLDER, IN_A_ZONE),
			);
			expect(result.outcome).toBe('suppressed');
		}
		expect(vault.written).toEqual([]);
	});

	it('LG-4: the two devices in turn write one time and then stop', async () => {
		// One file, and the two devices take turns against it. Without the
		// rule each device would write over the file of the other one, and
		// the two would never stop.
		const vault = deviceWith({ [PATH]: await fileOf(OLDER, IN_A_ZONE) });
		vault.forget();
		const outcomes: RecordWriteOutcome[] = [];
		for (let loop = 0; loop < 12; loop += 1) {
			const versions = loop % 2 === 0 ? NEWER : OLDER;
			outcomes.push(
				(
					await writeRecord(
						{ vault, digest, versions },
						PATH,
						recordOf(versions, IN_A_ZONE),
					)
				).outcome,
			);
		}
		expect(vault.written).toHaveLength(1);
		expect(outcomes).toEqual([
			'restamped',
			'suppressed',
			'unchanged',
			'suppressed',
			'unchanged',
			'suppressed',
			'unchanged',
			'suppressed',
			'unchanged',
			'suppressed',
			'unchanged',
			'suppressed',
		]);
	});

	it('LG-4: the file that the newer device left carries its own stamp', async () => {
		const vault = deviceWith({ [PATH]: await fileOf(OLDER, IN_A_ZONE) });
		await writeRecord(
			{ vault, digest, versions: NEWER },
			PATH,
			recordOf(NEWER, IN_A_ZONE),
		);
		expect(await vault.read(PATH)).toBe(await fileOf(NEWER, IN_A_ZONE));
	});
});
