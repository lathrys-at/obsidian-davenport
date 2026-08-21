/**
 * Two devices that hold two releases of the bundled table, against one
 * record file.
 *
 * The other file of this suite moves the stamp and holds the base
 * snapshot still. This file moves the table, which moves the snapshot as
 * well as the stamp. A record carries a timezone definition or a
 * reference to one, and the table of the device decides which. Two
 * devices at two releases therefore compute two files from one state of
 * the server.
 *
 * The comparison of the content must call that difference one state, and
 * the skew rule must then decide. A comparison that called it a change of
 * the state would write on every loop, on both devices, forever. The
 * tests below count the writes.
 *
 * The comparison must also keep the differences that no table release can
 * produce. The last test moves a definition that neither table holds, and
 * the device writes.
 *
 * The table stands behind one function, and this file replaces that
 * function with a set of names. Each device of a test states its own set.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizationVersions } from '../../../src/core/model/normalization';

/** The names that the table of the device under test holds. */
const HELD = new Set<string>();

vi.mock('../../../src/core/timezone/table', async (importOriginal) => {
	const real =
		await importOriginal<
			typeof import('../../../src/core/timezone/table')
		>();
	return { ...real, isTimezoneName: (name: string) => HELD.has(name) };
});

const { WebCryptoDigest } = await import('../../../src/adapters/digest');
const { parseIcs } = await import('../../../src/core/ics/parse');
const { buildRecord } = await import('../../../src/core/records/build');
const { sealRecord } = await import('../../../src/core/records/checksum');
const { sameRecordContent } = await import('../../../src/core/records/content');
const { writeRecord } = await import('../../../src/core/records/writer');
const { FakeVault } = await import('../../harness/obsidian-fake');
const { RecordingVault } = await import('../../harness/recording-vault');

const digest = new WebCryptoDigest();
const PATH = 'davenport/records/one.md';
const COLLECTION = 'https://dav.example.com/calendars/ren/work/';
const ZONE = 'America/New_York';
const STRANGE = 'Mars/Olympus';

/** The release that lacks the name, and the release that holds it. */
const OLDER: NormalizationVersions = { core: 1, timezone: 1 };
const NEWER: NormalizationVersions = { core: 1, timezone: 2 };

function definition(name: string, to: string): readonly string[] {
	return [
		'BEGIN:VTIMEZONE',
		`TZID:${name}`,
		'BEGIN:STANDARD',
		'DTSTART:19701101T020000',
		'TZOFFSETFROM:-0400',
		`TZOFFSETTO:${to}`,
		'TZNAME:EST',
		'END:STANDARD',
		'END:VTIMEZONE',
	];
}

function calendarOf(lines: readonly string[]) {
	const parsed = parseIcs(
		[
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//Davenport//table skew//EN',
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

/** The calendar that the server sends, with one definition and one use. */
function serverCalendar(name = ZONE, to = '-0500', summary = 'Standup') {
	return calendarOf([
		...definition(name, to),
		'BEGIN:VEVENT',
		'UID:skew',
		`SUMMARY:${summary}`,
		`DTSTART;TZID=${name}:20260302T090000`,
		'END:VEVENT',
	]);
}

/** The record that a device of the given table and versions computes. */
function recordOf(
	holds: readonly string[],
	versions: NormalizationVersions,
	calendar = serverCalendar(),
) {
	HELD.clear();
	for (const name of holds) {
		HELD.add(name);
	}
	const built = buildRecord(versions, {
		identity: { collectionHref: COLLECTION, uid: 'skew' },
		fields: { type: 'event' },
		calendar,
	});
	HELD.clear();
	return built.data;
}

beforeEach(() => {
	HELD.clear();
});

describe('LG-4 two devices at two releases of the bundled table', () => {
	it('LG-4: the two devices compute two snapshots and two stamps', () => {
		const older = recordOf([], OLDER);
		const newer = recordOf([ZONE], NEWER);
		expect(older.baseIcs).toContain('BEGIN:VTIMEZONE');
		expect(newer.baseIcs).not.toContain('BEGIN:VTIMEZONE');
		expect(older.normalizationVersion).toEqual({ core: 1, timezone: 1 });
		expect(newer.normalizationVersion).toEqual({ core: 1, timezone: 2 });
	});

	it('LG-4: the comparison calls the two records one state', () => {
		const older = recordOf([], OLDER);
		const newer = recordOf([ZONE], NEWER);
		expect(sameRecordContent(older, newer)).toBe(true);
		expect(sameRecordContent(newer, older)).toBe(true);
	});

	it('LG-4: the newer device rewrites one time and then stops', async () => {
		const vault = new RecordingVault(
			new FakeVault({
				[PATH]: await sealRecord(digest, recordOf([], OLDER)),
			}),
		);
		vault.forget();
		const outcomes: string[] = [];
		for (let loop = 0; loop < 12; loop += 1) {
			const result = await writeRecord(
				{ vault, digest, versions: NEWER },
				PATH,
				recordOf([ZONE], NEWER),
			);
			outcomes.push(result.outcome);
		}
		expect(outcomes[0]).toBe('restamped');
		expect(outcomes.slice(1)).toEqual(Array(11).fill('unchanged'));
		expect(vault.written).toHaveLength(1);
	});

	it('LG-4: the older device writes nothing over twelve loops', async () => {
		const vault = new RecordingVault(
			new FakeVault({
				[PATH]: await sealRecord(digest, recordOf([ZONE], NEWER)),
			}),
		);
		vault.forget();
		for (let loop = 0; loop < 12; loop += 1) {
			const result = await writeRecord(
				{ vault, digest, versions: OLDER },
				PATH,
				recordOf([], OLDER),
			);
			expect(result.outcome).toBe('suppressed');
		}
		expect(vault.written).toEqual([]);
	});

	it('LG-4: the two devices in turn write one time and then stop', async () => {
		const vault = new RecordingVault(
			new FakeVault({
				[PATH]: await sealRecord(digest, recordOf([], OLDER)),
			}),
		);
		vault.forget();
		const outcomes: string[] = [];
		for (let loop = 0; loop < 12; loop += 1) {
			const newer = loop % 2 === 0;
			const result = await writeRecord(
				{
					vault,
					digest,
					versions: newer ? NEWER : OLDER,
				},
				PATH,
				newer ? recordOf([ZONE], NEWER) : recordOf([], OLDER),
			);
			outcomes.push(result.outcome);
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
});

describe('LG-4 the differences that the comparison keeps', () => {
	it('LG-4: a change of the state writes, whatever the two tables hold', async () => {
		const vault = new RecordingVault(
			new FakeVault({
				[PATH]: await sealRecord(digest, recordOf([], OLDER)),
			}),
		);
		vault.forget();
		const changed = recordOf(
			[ZONE],
			NEWER,
			serverCalendar(ZONE, '-0500', 'Retrospective'),
		);
		const result = await writeRecord(
			{ vault, digest, versions: NEWER },
			PATH,
			changed,
		);
		expect(result.outcome).toBe('rewritten');
		expect(vault.written).toHaveLength(1);
	});

	it('LG-4: a definition that neither table holds is state, and a change of it writes', async () => {
		// Both devices keep this definition, so a difference in its bytes
		// comes from the server and not from a release of the table.
		const stood = recordOf([], OLDER, serverCalendar(STRANGE, '-0500'));
		const moved = recordOf([], OLDER, serverCalendar(STRANGE, '-0600'));
		expect(stood.baseIcs).toContain('TZOFFSETTO:-0500');
		expect(sameRecordContent(stood, moved)).toBe(false);
		const vault = new RecordingVault(
			new FakeVault({ [PATH]: await sealRecord(digest, stood) }),
		);
		vault.forget();
		const result = await writeRecord(
			{ vault, digest, versions: OLDER },
			PATH,
			moved,
		);
		expect(result.outcome).toBe('rewritten');
		expect(vault.written).toHaveLength(1);
	});

	it('LG-4: a definition that both tables hold is not state, and a change of it writes nothing', async () => {
		const stood = recordOf([ZONE], NEWER, serverCalendar(ZONE, '-0500'));
		const moved = recordOf([ZONE], NEWER, serverCalendar(ZONE, '-0600'));
		expect(sameRecordContent(stood, moved)).toBe(true);
		const vault = new RecordingVault(
			new FakeVault({ [PATH]: await sealRecord(digest, stood) }),
		);
		vault.forget();
		const result = await writeRecord(
			{ vault, digest, versions: NEWER },
			PATH,
			moved,
		);
		expect(result.outcome).toBe('unchanged');
		expect(vault.written).toEqual([]);
	});
});
