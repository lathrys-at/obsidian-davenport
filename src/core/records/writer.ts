/**
 * The write of one record file, and the rule that decides whether a write
 * happens at all.
 *
 * A record is the file that every device writes most often, because every
 * device applies every change that comes in. The bytes of a record follow
 * from the state alone, so two devices that hold one state compute one
 * file. The write therefore happens only when the bytes on disk differ
 * from the bytes that the device computed. Devices that agree write
 * nothing, and they make no conflict for a sync tool to resolve.
 *
 * Different bytes have two causes, and the device must tell them apart
 * before it writes.
 *
 * - The state changed. The device writes the new bytes.
 * - Another build wrote the same state with other bytes. The skew rule
 *   then decides. The device rewrites the record one time when no
 *   component of its stamp is older than the same component of the
 *   record, and one component is newer. In every other case the device
 *   writes nothing. Without this rule, two devices at two versions
 *   rewrite the record in turn and never stop.
 *
 * A file that the reader refuses is the third case. The device writes
 * nothing and reports the refusal. A quarantine reads that report and
 * decides what to surface. This module makes no such decision, and it
 * never writes over a file that it could not read.
 */

import type { NormalizationVersions } from '../model/normalization';
import type { RecordData } from '../model/record';
import type { DigestPort } from '../ports/digest';
import type { VaultPort } from '../ports/vault';
import { skewDecision } from '../ics/stamp';
import { sealRecord } from './checksum';
import { sameRecordContent } from './content';
import type { RecordReadFailure } from './read';
import { readRecord } from './read';

/** What one write of a record did. */
export type RecordWriteOutcome =
	/** No file stood at the path, and the device wrote one. */
	| 'created'
	/** The state changed, and the device wrote the new bytes. */
	| 'rewritten'
	/** The file already held these bytes, and the device wrote nothing. */
	| 'unchanged'
	/** The bytes differed and the state did not, and the device is newer. */
	| 'restamped'
	/** The bytes differed and the state did not, and the skew rule held. */
	| 'suppressed'
	/** The reader refused the file, and the device wrote nothing. */
	| 'unreadable';

/** The result of one write of a record. */
export interface RecordWriteResult {
	readonly outcome: RecordWriteOutcome;
	/** The bytes that the device computed, whether or not it wrote them. */
	readonly text: string;
	/** The reason that the reader refused the file that stood at the path. */
	readonly failure?: RecordReadFailure;
}

/** What the writer needs from outside the engine. */
export interface RecordWriterPorts {
	readonly vault: VaultPort;
	readonly digest: DigestPort;
	/** The versions of the build that this device runs. */
	readonly versions: NormalizationVersions;
}

/**
 * Writes one record, and only when the bytes change. The base snapshot of
 * the data must already stand in the canonical form of this build, which
 * the builder of a record gives. The value of the checksum field of the
 * data has no effect: the seal computes the checksum over the bytes of
 * the file.
 */
export async function writeRecord(
	ports: RecordWriterPorts,
	path: string,
	data: RecordData,
): Promise<RecordWriteResult> {
	const text = await sealRecord(ports.digest, data);
	if (!(await ports.vault.exists(path))) {
		await ports.vault.write(path, text);
		return { outcome: 'created', text };
	}
	const current = await ports.vault.read(path);
	if (current === text) {
		return { outcome: 'unchanged', text };
	}
	const parsed = readRecord(current);
	if (!parsed.ok) {
		return { outcome: 'unreadable', text, failure: parsed.failure };
	}
	if (!sameRecordContent(parsed.data, data)) {
		await ports.vault.write(path, text);
		return { outcome: 'rewritten', text };
	}
	if (
		skewDecision(ports.versions, parsed.data.normalizationVersion) ===
		'rewrite'
	) {
		await ports.vault.write(path, text);
		return { outcome: 'restamped', text };
	}
	return { outcome: 'suppressed', text };
}
