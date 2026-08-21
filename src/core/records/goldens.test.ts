import { describe, expect, it } from 'vitest';
import type {
	RecordGoldenCase,
	RecordGoldenSet,
} from '../../../test/harness/fixtures/record-goldens';
import {
	RECORD_GOLDEN_CASES,
	recordGoldenSet,
	recordGoldenSetPath,
	recordGoldenSets,
	recordGoldenText,
	recordGoldenWriteRequested,
	writeRecordGoldenSet,
} from '../../../test/harness/fixtures/record-goldens';
import { WebCryptoDigest } from '../../adapters/digest';
import { parseIcs } from '../ics/parse';
import {
	CORE_NORMALIZATION_VERSION,
	NORMALIZATION_VERSIONS,
	TIMEZONE_NORMALIZATION_VERSION,
} from '../ics/stamp';
import { buildRecord } from './build';
import { sealRecord, verifyRecordText } from './checksum';
import { readRecord } from './read';

const CURRENT = CORE_NORMALIZATION_VERSION;
const NEXT = CURRENT + 1;
const TIMEZONE_NEXT = TIMEZONE_NORMALIZATION_VERSION + 1;
const digest = new WebCryptoDigest();

const WRITE_COMMAND =
	'DAVENPORT_WRITE_RECORD_GOLDENS=1 npm test -- records/goldens';

/**
 * The instruction that a byte difference of this file ends with. Three
 * causes give one difference, and each cause takes a different action.
 */
const HOW_TO_MOVE =
	'Three causes give this difference. ' +
	'First, the emitter, the schema, or the canonical serializer changed. ' +
	`Raise CORE_NORMALIZATION_VERSION in src/core/ics/stamp.ts to ${String(NEXT)}. ` +
	`Then write the new set with ${WRITE_COMMAND}. ` +
	`The set of the core component ${String(CURRENT)} stays in the tree, and the closure test reads it. ` +
	'Second, a change moved the base snapshot of a record with no change on the server. ' +
	'Four things do this: the bundled table, the synthesiser, the scan that reads a zone reference, and the rule that takes a definition out of the base snapshot. ' +
	'The comparison of two records reads the two base snapshots whole where the two records carry one value of the timezone component. ' +
	'Two builds can compute different snapshots under one value of that component. ' +
	'Those two builds then rewrite one record in turn, and neither build stops. ' +
	`Raise TIMEZONE_NORMALIZATION_VERSION in src/core/ics/stamp.ts to ${String(TIMEZONE_NEXT)}, where the change did not raise it already. ` +
	`Then write the set of the core component ${String(CURRENT)} again in place with ${WRITE_COMMAND}. ` +
	'Third, a committed golden file changed and the code did not. ' +
	'Read git status on the set. ' +
	'Then restore the file.';

/** The bytes of one case, as this build writes them. */
async function goldenText(entry: RecordGoldenCase): Promise<string> {
	const parsed = parseIcs(entry.ics);
	if (!parsed.ok) {
		throw new Error(
			`the boundary refused the calendar of ${entry.id}: ${parsed.failure.message}`,
		);
	}
	const built = buildRecord(NORMALIZATION_VERSIONS, {
		...entry.state,
		calendar: parsed.calendar,
	});
	return sealRecord(digest, built.data);
}

function requireCurrentSet(): RecordGoldenSet {
	const set = recordGoldenSet(CURRENT);
	if (set === undefined) {
		throw new Error(
			`the core component of the normalization stamp is ${String(CURRENT)}, and the repository holds no golden set for it. ` +
				`Write the set to ${recordGoldenSetPath(CURRENT)} with ${WRITE_COMMAND}.`,
		);
	}
	return set;
}

if (recordGoldenWriteRequested()) {
	describe('the golden corpus of the record ledger', () => {
		it('writes the set of the current core component, and then fails', async () => {
			const entries = [];
			for (const entry of RECORD_GOLDEN_CASES) {
				entries.push({ id: entry.id, text: await goldenText(entry) });
			}
			const path = writeRecordGoldenSet(CURRENT, entries);
			expect.fail(
				`the run wrote the golden set of the core component ${String(CURRENT)} to ${path}. ` +
					'Read the difference. Then run the tests again with the variable unset.',
			);
		});
	});
} else {
	describe('the golden corpus of the record ledger', () => {
		it('holds a set for the core component of this build', () => {
			expect(recordGoldenSet(CURRENT)).toBeDefined();
		});

		it('holds one golden file for each case of the gate', () => {
			expect(requireCurrentSet().ids).toEqual(
				RECORD_GOLDEN_CASES.map((entry) => entry.id).sort(),
			);
		});

		it('gives each case of the gate its own file name', () => {
			const ids = RECORD_GOLDEN_CASES.map((entry) => entry.id);
			expect(new Set(ids).size).toBe(ids.length);
		});

		it.each(RECORD_GOLDEN_CASES)(
			'writes the committed bytes for $id',
			async (entry) => {
				const set = requireCurrentSet();
				expect(
					await goldenText(entry),
					`the record writer writes different bytes for ${entry.id}, and the core component of the normalization stamp is still ${String(CURRENT)}. ${HOW_TO_MOVE}`,
				).toBe(recordGoldenText(set, entry.id));
			},
		);

		it.each(RECORD_GOLDEN_CASES)(
			'reads the committed bytes of $id back into the same record',
			(entry) => {
				const set = requireCurrentSet();
				const text = recordGoldenText(set, entry.id);
				const read = readRecord(text);
				expect(read.ok, JSON.stringify(read)).toBe(true);
				if (read.ok) {
					expect(read.data.identity).toEqual(entry.state.identity);
				}
			},
		);
	});

	describe('the checksum of every committed record', () => {
		it('holds at least the set of this build', () => {
			expect(recordGoldenSets().map((set) => set.core)).toContain(
				CURRENT,
			);
		});

		for (const set of recordGoldenSets()) {
			it.each(set.ids)(
				`answers the bytes of %s of the set that the core component ${String(set.core)} wrote`,
				async (id) => {
					const verdict = await verifyRecordText(
						digest,
						recordGoldenText(set, id),
					);
					expect(
						verdict,
						`the checksum of ${id} in the set of the core component ${String(set.core)} does not answer the bytes of that file. ` +
							'A device of any version checks a record of any version, and this test holds the plugin to that. ' +
							'A device blanks the checksum line and hashes the file, and it never writes the canonical form of the record. ' +
							'A failure here therefore states that the blanking rule moved, and not that the writer moved.',
					).toMatchObject({ ok: true, valid: true });
				},
			);
		}
	});
}
