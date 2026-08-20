/**
 * The comparison of the content of two records.
 *
 * A device that meets a record file with different bytes asks one
 * question first: did the state change, or did another build write the
 * same state with other bytes? The skew rule answers only the second
 * case, so the device must separate the two before it applies that rule.
 *
 * The comparison passes over two fields. It passes over the checksum,
 * which follows from every other field. It passes over the normalization
 * stamp, which states the build and not the state.
 *
 * The comparison runs both records through the emitter of the device that
 * compares them. The emitter covers every field of the closed schema, so
 * a difference in any field reaches the text. One emitter on both sides
 * also removes the version of the emitter from the answer, which is the
 * whole point of the question.
 *
 * The base snapshot stands beside that text. Both sides must already hold
 * the canonical form of this build. The reader gives that form back, and
 * so does the builder of a record.
 */

import type { RecordData } from '../model/record';
import { emitFrontmatter } from './emitter';
import { CHECKSUM_KEY, recordEntries } from './schema';

/** The keys that state the build, and not the state of the event. */
const BUILD_KEYS: readonly string[] = [CHECKSUM_KEY, 'normalization'];

/**
 * The character that stands between the two halves of the key. The
 * emitter writes an escape in the place of this character inside a text,
 * and it writes the character nowhere else. The two halves of the key
 * therefore cannot run into each other.
 */
const SEPARATOR = '\u0000';

/**
 * A text that two records share when their content is the same. The text
 * is a comparison key, and no file ever holds it.
 */
export function recordContentKey(data: RecordData): string {
	const entries = recordEntries(data).filter(
		(entry) => !BUILD_KEYS.includes(entry.key),
	);
	return emitFrontmatter(entries) + SEPARATOR + data.baseIcs;
}

/** True when two records hold the same state of the same event. */
export function sameRecordContent(
	left: RecordData,
	right: RecordData,
): boolean {
	return recordContentKey(left) === recordContentKey(right);
}
