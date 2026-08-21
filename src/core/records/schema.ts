/**
 * The closed schema of the frontmatter of a record.
 *
 * The schema states every key, the order of the keys, and the kind of
 * value under each key. The emitter writes what this file builds, and the
 * reader takes the same keys back. Nothing else writes a record.
 *
 * Two rules keep the bytes a function of the state alone.
 *
 * - The keys of the schema stand in the order that this file declares.
 *   The order never follows the order of the keys of an object, because
 *   two devices can build one object in two orders.
 *   {@link materializationEntries} sorts the keys of the map of instances,
 *   which are the only keys that come from data. The sort reads the code
 *   units of the two keys, as the canonical serializer does.
 * - A value that is absent and a collection that is empty give the same
 *   bytes: the key is not there. A caller that states an empty list and a
 *   caller that states no list therefore write one file. The reader gives
 *   both back as absent, so a record that goes out and comes back is the
 *   same record.
 *
 * The checksum stands last. The blanking rule of the checksum then works
 * on the last line of the frontmatter, and a reader of any version finds
 * that line without a reader of the whole schema.
 */

import type { RecordData, VenuePointer } from '../model/record';
import type { MaterializationEntry, RecordFields } from '../model/record';
import type { Schedule } from '../model/event';
import type { NormalizationStamp } from '../model/normalization';
import type { Tombstone } from '../model/tombstone';
import type { RecordEntry } from './emitter';
import { integer, map, text, texts } from './emitter';

/** The key that carries the self-checksum. */
export const CHECKSUM_KEY = 'checksum';

/** The value that the checksum key carries while the plugin hashes the file. */
export const BLANK_CHECKSUM = '';

/**
 * The frontmatter entries of one record, in the order that the emitter
 * writes them.
 */
export function recordEntries(data: RecordData): readonly RecordEntry[] {
	return [
		{ key: 'collection', node: text(data.identity.collectionHref) },
		{ key: 'uid', node: text(data.identity.uid) },
		...optionalText('resource', data.resourceHref),
		...optionalText('etag', data.etag),
		{ key: 'fields', node: map(fieldEntries(data.fields)) },
		...optionalMap('venue', venueEntries(data.venue)),
		...optionalMap(
			'materialization',
			materializationEntries(data.materialization),
		),
		...optionalMap('renderHashes', renderHashEntries(data.renderHashes)),
		...optionalMap('tombstone', tombstoneEntries(data.tombstone)),
		{
			key: 'normalization',
			node: map(stampEntries(data.normalizationVersion)),
		},
		{ key: CHECKSUM_KEY, node: text(data.checksum) },
	];
}

function fieldEntries(fields: RecordFields): readonly RecordEntry[] {
	return [
		...optionalText('summary', fields.summary),
		...optionalMap('schedule', scheduleEntries(fields.schedule)),
		...optionalText('timezone', fields.timezone),
		...optionalText('rrule', fields.rrule),
		{ key: 'type', node: text(fields.type) },
		...optionalText('task', fields.task),
		...optionalText('due', fields.due),
		...optionalText('completed', fields.completed),
		...optionalInteger('priority', fields.priority),
		...optionalText('rsvp', fields.rsvp),
		...optionalText('description', fields.description),
		...optionalTexts('attachments', fields.attachments),
		...optionalText('alarm', fields.alarm),
		...optionalText('location', fields.location),
		...optionalTexts('categories', fields.categories),
		...optionalText('class', fields.class),
		...optionalText('transp', fields.transp),
		...optionalText('status', fields.status),
	];
}

function scheduleEntries(
	schedule: Schedule | undefined,
): readonly RecordEntry[] {
	if (schedule === undefined) {
		return [];
	}
	if (schedule.kind === 'timed') {
		return [
			{ key: 'kind', node: text(schedule.kind) },
			{ key: 'start', node: text(schedule.start) },
			...optionalText('end', schedule.end),
			...optionalText('duration', schedule.duration),
		];
	}
	return [
		{ key: 'kind', node: text(schedule.kind) },
		{ key: 'date', node: text(schedule.date) },
		...optionalText('endDate', schedule.endDate),
	];
}

function venueEntries(venue: VenuePointer | undefined): readonly RecordEntry[] {
	return venue === undefined ? [] : targetEntries(venue);
}

function targetEntries(
	target: VenuePointer | MaterializationEntry,
): readonly RecordEntry[] {
	return [
		{ key: 'path', node: text(target.path) },
		...optionalText('section', target.section),
		...optionalText('contentHash', target.contentHash),
	];
}

/**
 * The entries of the map of instances, in the order of the code units of
 * their keys. The keys come from data, so the emitter writes each one in
 * quotation marks. A date without them reads as a date and not as a text.
 */
function materializationEntries(
	materialization: Readonly<Record<string, MaterializationEntry>> | undefined,
): readonly RecordEntry[] {
	if (materialization === undefined) {
		return [];
	}
	return Object.entries(materialization)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([key, entry]) => ({ key, node: map(targetEntries(entry)) }));
}

function renderHashEntries(
	hashes: RecordData['renderHashes'],
): readonly RecordEntry[] {
	if (hashes === undefined) {
		return [];
	}
	return [
		...optionalText('description', hashes.description),
		...optionalText('attachments', hashes.attachments),
	];
}

function tombstoneEntries(
	tombstone: Tombstone | undefined,
): readonly RecordEntry[] {
	if (tombstone === undefined) {
		return [];
	}
	const annotation = tombstone.annotation;
	return [
		{ key: 'type', node: text(tombstone.type) },
		...(annotation === undefined
			? []
			: [
					{
						key: 'annotation',
						node: map([
							{ key: 'kind', node: text(annotation.kind) },
							{
								key: 'successor',
								node: map([
									{
										key: 'collection',
										node: text(
											annotation.successor.collectionHref,
										),
									},
									{
										key: 'uid',
										node: text(annotation.successor.uid),
									},
								]),
							},
						]),
					},
				]),
	];
}

function stampEntries(stamp: NormalizationStamp): readonly RecordEntry[] {
	return [
		{ key: 'core', node: integer(stamp.core) },
		...optionalInteger('timezone', stamp.timezone),
	];
}

function optionalText(
	key: string,
	value: string | undefined,
): readonly RecordEntry[] {
	return value === undefined ? [] : [{ key, node: text(value) }];
}

function optionalInteger(
	key: string,
	value: number | undefined,
): readonly RecordEntry[] {
	return value === undefined ? [] : [{ key, node: integer(value) }];
}

function optionalTexts(
	key: string,
	values: readonly string[] | undefined,
): readonly RecordEntry[] {
	return values === undefined || values.length === 0
		? []
		: [{ key, node: texts(values) }];
}

function optionalMap(
	key: string,
	entries: readonly RecordEntry[],
): readonly RecordEntry[] {
	return entries.length === 0 ? [] : [{ key, node: map(entries) }];
}
