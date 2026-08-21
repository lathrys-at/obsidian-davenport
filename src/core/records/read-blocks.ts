/**
 * The read of the blocks of a record that stand under one key.
 *
 * Each function here takes the value under one key of the frontmatter and
 * gives back the part of the record that the key states. A function
 * refuses a key that the schema does not hold, and it refuses a value
 * whose shape disagrees with the schema. The reader of the record collects
 * these answers, and it never repairs one.
 */

import type { NormalizationStamp } from '../model/normalization';
import type { MaterializationEntry, RecordData } from '../model/record';
import type { VenuePointer } from '../model/record';
import type { Tombstone, TombstoneAnnotation } from '../model/tombstone';
import type { TombstoneType } from '../model/tombstone';
import type { Loaded } from './loader';
import type { Read } from './read-values';
import {
	collect,
	maybe,
	optionalInteger,
	optionalMap,
	optionalOneOf,
	optionalText,
	requiredText,
	unknownKey,
} from './read-values';

const TARGET_KEYS: readonly string[] = ['path', 'section', 'contentHash'];
const TOMBSTONE_TYPES: readonly TombstoneType[] = [
	'remote-observed',
	'local-intent',
];
const ANNOTATION_KINDS: readonly TombstoneAnnotation['kind'][] = [
	'converted',
	'moved',
];

/** Reads a venue pointer or one entry of the materialization map. */
export function readTarget(
	node: Loaded | undefined,
	key: string,
): Read<VenuePointer> {
	const inside = optionalMap(node, key);
	if (!inside.ok) {
		return inside;
	}
	const entries = inside.value;
	if (entries === undefined) {
		return { ok: true, value: undefined };
	}
	const unknown = unknownKey(entries, TARGET_KEYS);
	if (unknown !== null) {
		return { ok: false, message: unknown };
	}
	const problems: string[] = [];
	const path = collect(requiredText(entries, 'path'), problems);
	const value: VenuePointer = {
		path: path ?? '',
		...maybe(
			'section',
			collect(optionalText(entries, 'section'), problems),
		),
		...maybe(
			'contentHash',
			collect(optionalText(entries, 'contentHash'), problems),
		),
	};
	return problems.length > 0
		? { ok: false, message: problems.join('; ') }
		: { ok: true, value };
}

export function readMaterialization(
	node: Loaded | undefined,
): Read<Readonly<Record<string, MaterializationEntry>>> {
	const inside = optionalMap(node, 'materialization');
	if (!inside.ok) {
		return inside;
	}
	const entries = inside.value;
	if (entries === undefined) {
		return { ok: true, value: undefined };
	}
	const problems: string[] = [];
	const targets: Record<string, MaterializationEntry> = {};
	for (const [key, value] of entries) {
		const target = collect(
			readTarget(value, `the materialization entry ${key}`),
			problems,
		);
		if (target !== undefined) {
			targets[key] = target;
		}
	}
	return problems.length > 0
		? { ok: false, message: problems.join('; ') }
		: { ok: true, value: targets };
}

export function readRenderHashes(
	node: Loaded | undefined,
): Read<NonNullable<RecordData['renderHashes']>> {
	const inside = optionalMap(node, 'renderHashes');
	if (!inside.ok) {
		return inside;
	}
	const entries = inside.value;
	if (entries === undefined) {
		return { ok: true, value: undefined };
	}
	const unknown = unknownKey(entries, ['description', 'attachments']);
	if (unknown !== null) {
		return { ok: false, message: unknown };
	}
	const problems: string[] = [];
	const value = {
		...maybe(
			'description',
			collect(optionalText(entries, 'description'), problems),
		),
		...maybe(
			'attachments',
			collect(optionalText(entries, 'attachments'), problems),
		),
	};
	return problems.length > 0
		? { ok: false, message: problems.join('; ') }
		: { ok: true, value };
}

export function readTombstone(node: Loaded | undefined): Read<Tombstone> {
	const inside = optionalMap(node, 'tombstone');
	if (!inside.ok) {
		return inside;
	}
	const entries = inside.value;
	if (entries === undefined) {
		return { ok: true, value: undefined };
	}
	const unknown = unknownKey(entries, ['type', 'annotation']);
	if (unknown !== null) {
		return { ok: false, message: unknown };
	}
	const problems: string[] = [];
	const type = collect(
		optionalOneOf<TombstoneType>(entries, 'type', TOMBSTONE_TYPES),
		problems,
	);
	const value: Tombstone = {
		type: type ?? 'remote-observed',
		...maybe(
			'annotation',
			collect(readAnnotation(entries.get('annotation')), problems),
		),
	};
	if (type === undefined) {
		problems.push('the tombstone of the record states no type');
	}
	return problems.length > 0
		? { ok: false, message: problems.join('; ') }
		: { ok: true, value };
}

export function readAnnotation(
	node: Loaded | undefined,
): Read<TombstoneAnnotation> {
	const inside = optionalMap(node, 'annotation');
	if (!inside.ok) {
		return inside;
	}
	const entries = inside.value;
	if (entries === undefined) {
		return { ok: true, value: undefined };
	}
	const unknown = unknownKey(entries, ['kind', 'successor']);
	if (unknown !== null) {
		return { ok: false, message: unknown };
	}
	const problems: string[] = [];
	const kind = collect(
		optionalOneOf<TombstoneAnnotation['kind']>(
			entries,
			'kind',
			ANNOTATION_KINDS,
		),
		problems,
	);
	if (kind === undefined) {
		problems.push('the annotation of the tombstone states no kind');
	}
	const successor = collect(
		readSuccessor(entries.get('successor')),
		problems,
	);
	if (successor === undefined) {
		problems.push('the annotation of the tombstone names no successor');
	}
	return problems.length > 0
		? { ok: false, message: problems.join('; ') }
		: {
				ok: true,
				value: {
					kind: kind ?? 'moved',
					successor: successor ?? { collectionHref: '', uid: '' },
				},
			};
}

export function readSuccessor(
	node: Loaded | undefined,
): Read<{ collectionHref: string; uid: string }> {
	const inside = optionalMap(node, 'successor');
	if (!inside.ok) {
		return inside;
	}
	const entries = inside.value;
	if (entries === undefined) {
		return { ok: true, value: undefined };
	}
	const unknown = unknownKey(entries, ['collection', 'uid']);
	if (unknown !== null) {
		return { ok: false, message: unknown };
	}
	const problems: string[] = [];
	const collection = collect(requiredText(entries, 'collection'), problems);
	const uid = collect(requiredText(entries, 'uid'), problems);
	return problems.length > 0
		? { ok: false, message: problems.join('; ') }
		: {
				ok: true,
				value: { collectionHref: collection ?? '', uid: uid ?? '' },
			};
}

export function readStamp(node: Loaded | undefined): Read<NormalizationStamp> {
	const inside = optionalMap(node, 'normalization');
	if (!inside.ok) {
		return inside;
	}
	const entries = inside.value;
	if (entries === undefined) {
		return {
			ok: false,
			message: 'the record carries no normalization stamp',
		};
	}
	const unknown = unknownKey(entries, ['core', 'timezone']);
	if (unknown !== null) {
		return { ok: false, message: unknown };
	}
	const problems: string[] = [];
	const core = collect(optionalInteger(entries, 'core'), problems);
	const value: NormalizationStamp = {
		core: core ?? 0,
		...maybe(
			'timezone',
			collect(optionalInteger(entries, 'timezone'), problems),
		),
	};
	if (core === undefined) {
		problems.push('the normalization stamp states no core component');
	}
	return problems.length > 0
		? { ok: false, message: problems.join('; ') }
		: { ok: true, value };
}
