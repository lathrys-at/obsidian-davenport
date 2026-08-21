/**
 * The self-checksum of a record.
 *
 * Every write of a record stores the hash of the canonical bytes of the
 * file, with the value of the checksum field blanked. A device therefore
 * checks a record with two steps: it puts the empty value back in the
 * checksum line, and it hashes the whole text. The device needs no
 * ability to write the canonical form of that record, so a device at an
 * older version checks a record that a newer version wrote.
 *
 * This property closes one window. A device that is older than a record
 * on a component of the normalization stamp does not rewrite that record.
 * Without the checksum, such a device would also take a damaged record as
 * its base for a comparison of three versions. A line-level merge that
 * damages a record moves at least one octet of the hashed text, so the
 * check fails.
 *
 * The plugin computes the hash one time, over the text that it is about
 * to write. It then puts the hash into that same text. The text that a
 * check hashes is therefore the exact text that the write hashed, and the
 * two cannot drift apart.
 */

import type { DigestPort } from '../ports/digest';
import { SHA256_HEX_LENGTH } from '../ports/digest';
import type { RecordData } from '../model/record';
import type { ChecksumSiteProblem } from './canonical';
import { checksumSite, renderRecord, withChecksum } from './canonical';
import { BLANK_CHECKSUM } from './schema';

/** The canonical text of one record, with its own checksum inside it. */
export async function sealRecord(
	digest: DigestPort,
	data: RecordData,
): Promise<string> {
	const blanked = renderRecord({ ...data, checksum: BLANK_CHECKSUM });
	return withChecksum(blanked, await digest.sha256Hex(blanked));
}

/** What a check of the checksum of one record gives back. */
export type ChecksumVerdict =
	| {
			readonly ok: true;
			/** True when the value in the file answers the bytes of the file. */
			readonly valid: boolean;
			/** The value that the file carries. */
			readonly found: string;
			/** The value that the bytes of the file give. */
			readonly expected: string;
	  }
	| { readonly ok: false; readonly problem: ChecksumSiteProblem };

/**
 * The check of the checksum of one record text. The function reads the
 * text and hashes it. The function builds no record and writes no
 * canonical form.
 */
export async function verifyRecordText(
	digest: DigestPort,
	text: string,
): Promise<ChecksumVerdict> {
	const site = checksumSite(text);
	if (!site.ok) {
		return { ok: false, problem: site.problem };
	}
	const expected = await digest.sha256Hex(site.site.blanked);
	const found = site.site.value;
	return {
		ok: true,
		valid: found.length === SHA256_HEX_LENGTH && found === expected,
		found,
		expected,
	};
}
