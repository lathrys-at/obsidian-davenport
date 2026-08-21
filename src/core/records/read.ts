/**
 * The read of one record file back into the content of that record.
 *
 * The ledger needs this read for three jobs. The index needs the pair
 * that names the event. The writer needs the stamp of the file, so that
 * the skew rule can compare it against the stamp of the device. The
 * writer also needs the content of the file, so that it can tell a change
 * of the server from a difference of the bytes alone.
 *
 * The read is strict, and it refuses a file that the emitter of this
 * build could not have written. It refuses a key that the schema does not
 * hold, a value outside the set that its key permits, an empty list or an
 * empty map where the schema writes no key at all, and a body that does
 * not stand in one fenced block. A record belongs to the machine, so
 * a shape that the emitter cannot write is damage. This module reports
 * the damage, and it repairs nothing.
 *
 * The read gives the base snapshot back in the canonical form of this
 * build, and not in the octets of the file. Two builds can write one
 * calendar with different bytes. A comparison of the file against a fresh
 * computation must therefore run both sides through one serializer, and
 * the serializer of the reading device is the one that both sides reach.
 */

import type { RecordData } from '../model/record';
import { serializeIcs } from '../ics/serializer';
import { withLinePairs } from './canonical';
import type { Loaded } from './loader';
import { loadFrontmatter } from './loader';
import {
	readMaterialization,
	readRenderHashes,
	readStamp,
	readTarget,
	readTombstone,
} from './read-blocks';
import { readFields } from './read-fields';
import type { Read } from './read-values';
import {
	collect,
	maybe,
	optionalText,
	requiredText,
	unknownKey,
} from './read-values';

/** Which part of a record file the reader refused. */
export type RecordReadProblem =
	/** The file does not hold a frontmatter block and one fenced block. */
	| 'layout'
	/** The frontmatter does not stand in the dialect of the emitter. */
	| 'frontmatter'
	/** The frontmatter disagrees with the schema of a record. */
	| 'schema'
	/** The fenced block does not hold a calendar that the boundary reads. */
	| 'base-ics';

/** Why the reader refused one record file. */
export interface RecordReadFailure {
	readonly problem: RecordReadProblem;
	readonly message: string;
}

/** What a read of one record file gives back. */
export type RecordReadResult =
	| { readonly ok: true; readonly data: RecordData }
	| { readonly ok: false; readonly failure: RecordReadFailure };

const FRONTMATTER_MARK = '---';
const FENCE_LINE = /^(`{3,})ics$/;

const RECORD_KEYS: readonly string[] = [
	'collection',
	'uid',
	'resource',
	'etag',
	'fields',
	'venue',
	'materialization',
	'renderHashes',
	'tombstone',
	'normalization',
	'checksum',
];

/** Reads one record file. */
export function readRecord(text: string): RecordReadResult {
	const parts = splitRecord(text);
	if (!parts.ok) {
		return { ok: false, failure: parts.failure };
	}
	const loaded = loadFrontmatter(parts.frontmatter);
	if (!loaded.ok) {
		return fail('frontmatter', loaded.message);
	}
	const ics = serializeIcs(withLinePairs(`${parts.body}\n`));
	if (!ics.ok) {
		return fail('base-ics', ics.failure.message);
	}
	const data = readSchema(loaded.entries, ics.text);
	return data.ok && data.value !== undefined
		? { ok: true, data: data.value }
		: fail('schema', data.ok ? 'the file holds no record' : data.message);
}

interface RecordParts {
	readonly ok: true;
	readonly frontmatter: string;
	readonly body: string;
}

interface SplitFailure {
	readonly ok: false;
	readonly failure: RecordReadFailure;
}

/** The frontmatter and the fenced body of one record file. */
function splitRecord(text: string): RecordParts | SplitFailure {
	const lines = text.split('\n');
	if (lines[0] !== FRONTMATTER_MARK) {
		return fail('layout', 'the file does not open with a frontmatter mark');
	}
	const close = lines.indexOf(FRONTMATTER_MARK, 1);
	if (close === -1) {
		return fail('layout', 'the frontmatter block does not close');
	}
	const rest = lines.slice(close + 1);
	if (rest[0] !== '') {
		return fail('layout', 'no empty line stands after the frontmatter');
	}
	const opened = FENCE_LINE.exec(rest[1] ?? '');
	if (opened === null) {
		return fail('layout', 'no fenced block for the base snapshot follows');
	}
	const inside = rest.slice(2);
	const end = inside.indexOf(opened[1] ?? '');
	if (end === -1) {
		return fail('layout', 'the fenced block does not close');
	}
	if (inside.slice(end + 1).some((line) => line !== '')) {
		return fail('layout', 'the file holds text after the fenced block');
	}
	return {
		ok: true,
		frontmatter: `${lines.slice(1, close).join('\n')}\n`,
		body: inside.slice(0, end).join('\n'),
	};
}

function readSchema(
	entries: ReadonlyMap<string, Loaded>,
	baseIcs: string,
): Read<RecordData> {
	const unknown = unknownKey(entries, RECORD_KEYS);
	if (unknown !== null) {
		return { ok: false, message: unknown };
	}
	const problems: string[] = [];
	const collection = collect(requiredText(entries, 'collection'), problems);
	const uid = collect(requiredText(entries, 'uid'), problems);
	const checksum = collect(requiredText(entries, 'checksum'), problems);
	const fields = collect(readFields(entries.get('fields')), problems);
	const stamp = collect(readStamp(entries.get('normalization')), problems);
	const data: RecordData = {
		identity: { collectionHref: collection ?? '', uid: uid ?? '' },
		...maybe(
			'resourceHref',
			collect(optionalText(entries, 'resource'), problems),
		),
		...maybe('etag', collect(optionalText(entries, 'etag'), problems)),
		fields: fields ?? { type: 'event' },
		baseIcs,
		...maybe(
			'venue',
			collect(readTarget(entries.get('venue'), 'venue'), problems),
		),
		...maybe(
			'materialization',
			collect(
				readMaterialization(entries.get('materialization')),
				problems,
			),
		),
		...maybe(
			'renderHashes',
			collect(readRenderHashes(entries.get('renderHashes')), problems),
		),
		...maybe(
			'tombstone',
			collect(readTombstone(entries.get('tombstone')), problems),
		),
		normalizationVersion: stamp ?? { core: 0 },
		checksum: checksum ?? '',
	};
	return problems.length > 0
		? { ok: false, message: problems.join('; ') }
		: { ok: true, value: data };
}

function fail(problem: RecordReadProblem, message: string): SplitFailure {
	return { ok: false, failure: { problem, message } };
}
