/**
 * The self-checksum of a record, and the property that makes it useful.
 *
 * A device checks a record with two steps: it puts the empty value back
 * in the checksum line, and it hashes the whole file. Nothing in those
 * two steps needs the ability to write the canonical form of that record.
 * A device of any version therefore checks a record of any version, and
 * a device that is older than a record on a component of the stamp still
 * refuses a damaged record.
 *
 * The tests prove the property in the strongest form that a test can:
 * they check a record that the reader of this build refuses. The reader
 * cannot rebuild that record, and the check answers anyway.
 */

import { describe, expect, it } from 'vitest';
import { WebCryptoDigest } from '../../../src/adapters/digest';
import { parseIcs } from '../../../src/core/ics/parse';
import { NORMALIZATION_VERSIONS } from '../../../src/core/ics/stamp';
import { checksumSite } from '../../../src/core/records/canonical';
import {
	sealRecord,
	verifyRecordText,
} from '../../../src/core/records/checksum';
import { buildRecord } from '../../../src/core/records/build';
import { readRecord } from '../../../src/core/records/read';
import type { DigestPort } from '../../../src/core/ports/digest';
import { RECORD_GOLDEN_CASES } from '../../harness/fixtures/record-goldens';

const digest = new WebCryptoDigest();

/** A digest that counts what a caller hashed. */
class CountingDigest implements DigestPort {
	readonly hashed: string[] = [];

	async sha256Hex(text: string): Promise<string> {
		this.hashed.push(text);
		return digest.sha256Hex(text);
	}
}

function caseOf(id: string) {
	const entry = RECORD_GOLDEN_CASES.find((each) => each.id === id);
	if (entry === undefined) {
		throw new Error(`the gate holds no case named ${id}`);
	}
	return entry;
}

async function sealed(id: string, core = NORMALIZATION_VERSIONS.core) {
	const entry = caseOf(id);
	const parsed = parseIcs(entry.ics);
	if (!parsed.ok) {
		throw new Error(parsed.failure.message);
	}
	const built = buildRecord(
		{ ...NORMALIZATION_VERSIONS, core },
		{ ...entry.state, calendar: parsed.calendar },
	);
	return sealRecord(digest, built.data);
}

describe('LG-9 the checksum of a record that the writer wrote', () => {
	it.each(RECORD_GOLDEN_CASES.map((entry) => entry.id))(
		'LG-9: the checksum of %s answers the bytes of the file',
		async (id) => {
			const verdict = await verifyRecordText(digest, await sealed(id));
			expect(verdict.ok && verdict.valid).toBe(true);
		},
	);

	it('LG-9: the value that the file carries holds 64 characters', async () => {
		const verdict = await verifyRecordText(digest, await sealed('minimal'));
		expect(verdict.ok && verdict.found).toMatch(/^[0-9a-f]{64}$/);
	});

	it('LG-9: the check hashes the file with the value blanked', async () => {
		const text = await sealed('minimal');
		const counting = new CountingDigest();
		await verifyRecordText(counting, text);
		const site = checksumSite(text);
		expect(site.ok).toBe(true);
		expect(counting.hashed).toEqual([site.ok ? site.site.blanked : '']);
	});

	it('LG-9: the check hashes one text and nothing else', async () => {
		const counting = new CountingDigest();
		await verifyRecordText(counting, await sealed('every-field'));
		expect(counting.hashed).toHaveLength(1);
	});
});

describe('LG-9 the check on a device that cannot write the record', () => {
	it('LG-9: an older device checks a record that a newer build wrote', async () => {
		// The record states a core component that this build does not
		// write. The device therefore cannot compute the bytes of that
		// record, and the check answers all the same.
		const newer = await sealed(
			'known-zone',
			NORMALIZATION_VERSIONS.core + 7,
		);
		expect(newer).toContain(
			`core: ${String(NORMALIZATION_VERSIONS.core + 7)}`,
		);
		const verdict = await verifyRecordText(digest, newer);
		expect(verdict.ok && verdict.valid).toBe(true);
	});

	it('LG-9: the check answers a record that the reader of this build refuses', async () => {
		// A newer build can add a key to the schema. The reader of this
		// build then refuses the file. The check reads no schema, so the
		// check still answers.
		const text = await sealed('minimal');
		const fromTheFuture = text.replace(
			'uid: "minimal"\n',
			'uid: "minimal"\nlease: "2026-03-02"\n',
		);
		const resealed = await reseal(fromTheFuture);
		expect(readRecord(resealed).ok).toBe(false);
		const verdict = await verifyRecordText(digest, resealed);
		expect(verdict.ok && verdict.valid).toBe(true);
	});

	it('LG-9: the check answers a file whose body is not a calendar', async () => {
		const text = await sealed('minimal');
		const damaged = await reseal(
			text.replace('BEGIN:VCALENDAR', 'BEGIN:VNOTHING'),
		);
		expect(readRecord(damaged).ok).toBe(false);
		const verdict = await verifyRecordText(digest, damaged);
		expect(verdict.ok && verdict.valid).toBe(true);
	});
});

describe('LG-9 the check on a record that a merge damaged', () => {
	it.each([
		['a value of the frontmatter', 'uid: "minimal"', 'uid: "changed"'],
		['a line of the body', 'UID:minimal', 'UID:changed'],
		[
			'the order of two lines of the frontmatter',
			'collection',
			'collectio',
		],
		['one character of the body', 'DTSTART:20260302', 'DTSTART:20260303'],
	])('LG-9: a change in %s fails the check', async (_name, from, to) => {
		const text = await sealed('minimal');
		expect(text).toContain(from);
		const verdict = await verifyRecordText(digest, text.replace(from, to));
		expect(verdict.ok && verdict.valid).toBe(false);
	});

	it('LG-9: a record that a merge left with two checksum lines gives no answer', async () => {
		const text = await sealed('minimal');
		const site = checksumSite(text);
		const doubled = text.replace(
			'checksum: "',
			`checksum: "${site.ok ? site.site.value : ''}"\nchecksum: "`,
		);
		expect(await verifyRecordText(digest, doubled)).toEqual({
			ok: false,
			problem: 'many-checksums',
		});
	});

	it('LG-9: a record with no checksum line gives no answer', async () => {
		const text = await sealed('minimal');
		const site = checksumSite(text);
		const stripped = text.replace(
			`checksum: "${site.ok ? site.site.value : ''}"\n`,
			'',
		);
		expect(await verifyRecordText(digest, stripped)).toEqual({
			ok: false,
			problem: 'no-checksum',
		});
	});

	it('LG-9: an empty value fails the check and does not pass as blank', async () => {
		const text = await sealed('minimal');
		const site = checksumSite(text);
		const blanked = text.replace(
			`checksum: "${site.ok ? site.site.value : ''}"`,
			'checksum: ""',
		);
		const verdict = await verifyRecordText(digest, blanked);
		expect(verdict.ok && verdict.valid).toBe(false);
	});
});

/** Puts a fresh checksum on a text that a test changed. */
async function reseal(text: string): Promise<string> {
	const site = checksumSite(text);
	if (!site.ok) {
		throw new Error('the text holds no checksum line');
	}
	const hash = await digest.sha256Hex(site.site.blanked);
	return site.site.blanked.replace('checksum: ""', `checksum: "${hash}"`);
}
