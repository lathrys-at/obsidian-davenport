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
 * produce. Two devices that carry one value of the timezone component ran
 * one release of the table, so every difference of their two snapshots
 * comes from the server. The tests below stand a server change beside a
 * table difference of the same shape, and the comparison must separate
 * the two.
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

/** The same calendar, before the server sent the definition. */
function referenceOnlyCalendar(name = STRANGE, summary = 'Standup') {
	return calendarOf([
		'BEGIN:VEVENT',
		'UID:skew',
		`SUMMARY:${summary}`,
		`DTSTART;TZID=${name}:20260302T090000`,
		'END:VEVENT',
	]);
}

/**
 * A calendar that names its zone in a value and in no parameter. A device
 * whose table lacks that name reads no reference, so the record of that
 * device carries no timezone component until the server sends the
 * definition.
 */
function homeZoneCalendar(withDefinition: boolean, summary = 'Standup') {
	return calendarOf([
		`X-WR-TIMEZONE:${STRANGE}`,
		...(withDefinition ? definition(STRANGE, '-0500') : []),
		'BEGIN:VEVENT',
		'UID:skew',
		`SUMMARY:${summary}`,
		'DTSTART:20260302T140000Z',
		'END:VEVENT',
	]);
}

/**
 * A calendar with no zone at all, whose ordinary values spell two names
 * of the bundled table. The scan reads the value of two properties, and
 * neither `LOCATION` nor `CATEGORIES` is one of the two.
 */
function ordinaryValueCalendar() {
	return calendarOf([
		'BEGIN:VEVENT',
		'UID:skew',
		'SUMMARY:Standup',
		'LOCATION:Iceland',
		'CATEGORIES:Japan',
		'DTSTART:20260302T140000Z',
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

describe('LG-4 an ordinary value that spells a name of the table', () => {
	it('LG-4: the two devices compute one snapshot and one stamp', () => {
		const older = recordOf([], OLDER, ordinaryValueCalendar());
		const newer = recordOf(
			['Iceland', 'Japan'],
			NEWER,
			ordinaryValueCalendar(),
		);
		expect(older.baseIcs).toBe(newer.baseIcs);
		expect(older.normalizationVersion).toEqual({ core: 1 });
		expect(newer.normalizationVersion).toEqual({ core: 1 });
	});

	it('LG-4: the two devices in turn write nothing over twelve loops', async () => {
		// The table of one device holds both names and the table of the
		// other holds neither. The values stand in properties that the scan
		// passes over, so no device reads a reference and no record carries
		// the timezone component. The record therefore reaches neither the
		// comparison split nor the skew rule.
		const older = recordOf([], OLDER, ordinaryValueCalendar());
		const newer = recordOf(
			['Iceland', 'Japan'],
			NEWER,
			ordinaryValueCalendar(),
		);
		const vault = new RecordingVault(
			new FakeVault({ [PATH]: await sealRecord(digest, older) }),
		);
		vault.forget();
		for (let loop = 0; loop < 12; loop += 1) {
			const turnOfTheNewer = loop % 2 === 0;
			const result = await writeRecord(
				{ vault, digest, versions: turnOfTheNewer ? NEWER : OLDER },
				PATH,
				turnOfTheNewer ? newer : older,
			);
			expect(result.outcome).toBe('unchanged');
		}
		expect(vault.written).toEqual([]);
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

	it('LG-4: a record that carries a definition carries the timezone component', () => {
		// The comparison reads the two snapshots whole where the two
		// components are equal, and an absent component is one of the two
		// cases of that rule. This test holds the fact that makes the
		// absent case safe: a record that carries a definition names that
		// zone, and a device that drops a definition keeps the name that
		// made it drop the definition. Both records therefore carry the
		// component.
		const kept = recordOf([], OLDER, serverCalendar(STRANGE));
		expect(kept.baseIcs).toContain('BEGIN:VTIMEZONE');
		expect(kept.normalizationVersion).toEqual({ core: 1, timezone: 1 });
		const dropped = recordOf([ZONE], NEWER);
		expect(dropped.baseIcs).not.toContain('BEGIN:VTIMEZONE');
		expect(dropped.normalizationVersion).toEqual({ core: 1, timezone: 2 });
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

describe('LG-4 one release of the table decided both snapshots', () => {
	// The server sends a reference to a zone that no table holds, and then
	// the server sends the definition of that zone. A table release makes
	// the same shape, so the split of the snapshot passes over it. The two
	// records here carry one value of the timezone component, so one
	// release of the table decided both snapshots, and the comparison
	// reads them whole.

	it('LG-4: the two records carry one timezone component', () => {
		const before = recordOf([], OLDER, referenceOnlyCalendar());
		const after = recordOf([], OLDER, serverCalendar(STRANGE));
		expect(before.baseIcs).not.toContain('BEGIN:VTIMEZONE');
		expect(after.baseIcs).toContain('BEGIN:VTIMEZONE');
		expect(before.normalizationVersion).toEqual(after.normalizationVersion);
		expect(before.normalizationVersion).toEqual({ core: 1, timezone: 1 });
	});

	it('LG-4: one difference of the bytes gets two answers from the two stamps', () => {
		// One record stands in both pairs below, and each pair holds the
		// same difference of the bytes: one snapshot carries the New York
		// definition under a referenced name, and the other does not. The
		// server made the first difference, and a release of the table
		// made the second one. The timezone components separate the two.
		const embedded = recordOf([], OLDER, serverCalendar(ZONE));
		const sent = recordOf([], OLDER, referenceOnlyCalendar(ZONE));
		const released = recordOf([ZONE], NEWER, serverCalendar(ZONE));
		expect(sent.baseIcs).toBe(released.baseIcs);
		expect(sameRecordContent(embedded, sent)).toBe(false);
		expect(sameRecordContent(embedded, released)).toBe(true);
	});
});

describe('LG-4 one record carries no timezone component', () => {
	// The calendar names its zone in a value that no table holds, so the
	// record carries no timezone component until the server sends the
	// definition. Nothing then states that one release of the table
	// decided the two snapshots, and the comparison splits them.

	it('LG-4: the definition decides whether the record carries the component', () => {
		const before = recordOf([], OLDER, homeZoneCalendar(false));
		const after = recordOf([], OLDER, homeZoneCalendar(true));
		expect(before.normalizationVersion).toEqual({ core: 1 });
		expect(after.normalizationVersion).toEqual({ core: 1, timezone: 1 });
	});

	it('LG-4: the comparison passes over the definition, and no device writes', async () => {
		const before = recordOf([], OLDER, homeZoneCalendar(false));
		const after = recordOf([], OLDER, homeZoneCalendar(true));
		expect(sameRecordContent(before, after)).toBe(true);
		expect(sameRecordContent(after, before)).toBe(true);
		const vault = new RecordingVault(
			new FakeVault({ [PATH]: await sealRecord(digest, before) }),
		);
		vault.forget();
		const result = await writeRecord(
			{ vault, digest, versions: OLDER },
			PATH,
			after,
		);
		expect(result.outcome).toBe('suppressed');
		expect(vault.written).toEqual([]);
	});
});

describe('LG-2 the write over a difference that the server made', () => {
	// One build wrote both records of each pair below, so no release of
	// the table stands between them. Every difference of the two records
	// therefore comes from the server, and the writer writes the new bytes
	// one time. A record that matches the file after that write takes no
	// write at all.

	it('LG-2: a definition that the server added is a change of the state', async () => {
		const before = recordOf([], OLDER, referenceOnlyCalendar());
		const after = recordOf([], OLDER, serverCalendar(STRANGE));
		expect(sameRecordContent(before, after)).toBe(false);
		expect(sameRecordContent(after, before)).toBe(false);
		const vault = new RecordingVault(
			new FakeVault({ [PATH]: await sealRecord(digest, before) }),
		);
		vault.forget();
		const outcomes: string[] = [];
		for (let loop = 0; loop < 12; loop += 1) {
			const result = await writeRecord(
				{ vault, digest, versions: OLDER },
				PATH,
				after,
			);
			outcomes.push(result.outcome);
		}
		expect(outcomes[0]).toBe('rewritten');
		expect(outcomes.slice(1)).toEqual(Array(11).fill('unchanged'));
		expect(vault.written).toHaveLength(1);
		expect(await vault.read(PATH)).toContain('BEGIN:VTIMEZONE');
	});

	it('LG-2: a definition that the server took away is a change of the state', async () => {
		const before = recordOf([], OLDER, serverCalendar(STRANGE));
		const after = recordOf([], OLDER, referenceOnlyCalendar());
		const vault = new RecordingVault(
			new FakeVault({ [PATH]: await sealRecord(digest, before) }),
		);
		vault.forget();
		const first = await writeRecord(
			{ vault, digest, versions: OLDER },
			PATH,
			after,
		);
		expect(first.outcome).toBe('rewritten');
		const second = await writeRecord(
			{ vault, digest, versions: OLDER },
			PATH,
			after,
		);
		expect(second.outcome).toBe('unchanged');
		expect(vault.written).toHaveLength(1);
		expect(await vault.read(PATH)).not.toContain('BEGIN:VTIMEZONE');
	});

	it('LG-2: a change of another byte carries the definition in', async () => {
		const before = recordOf([], OLDER, homeZoneCalendar(false));
		const changed = recordOf(
			[],
			OLDER,
			homeZoneCalendar(true, 'Retrospective'),
		);
		const vault = new RecordingVault(
			new FakeVault({ [PATH]: await sealRecord(digest, before) }),
		);
		vault.forget();
		const result = await writeRecord(
			{ vault, digest, versions: OLDER },
			PATH,
			changed,
		);
		expect(result.outcome).toBe('rewritten');
		expect(await vault.read(PATH)).toContain('BEGIN:VTIMEZONE');
	});
});
