/**
 * The keys that the plugin owns in the frontmatter of a note, and the two
 * shapes that a schedule takes.
 *
 * Every key stands at the top level of the block, and no key holds a map
 * of more keys. The Properties editor of Obsidian cannot edit a map inside
 * a key, and a flat key answers a query from Bases and from Dataview.
 *
 * A note can hold keys that the plugin does not own. The user owns such a
 * key, or another plugin owns it. The plugin reads no such key and writes
 * no such key. A key that differs only in its capital letters is a key of
 * this kind: "Start" is not "start". The plugin passes over it, because a
 * vault holds properties with names of that shape for other purposes.
 *
 * A schedule takes one shape only. The timed shape states a start with a
 * time of day. The all-day shape states whole days. A note that holds a
 * key of each shape holds a contradiction, and the plugin never chooses
 * one shape for the user.
 */

/** The keys of the timed shape. */
export const TIMED_KEYS = ['start', 'end', 'duration'] as const;

/** The keys of the all-day shape. */
export const ALL_DAY_KEYS = ['date', 'endDate'] as const;

/**
 * Every key that the plugin owns, in the order of the schema. A write puts
 * a new key at the end of the block, so this order decides the order of
 * the keys that a write adds.
 */
export const SCHEMA_KEYS = [
	'uid',
	'state',
	'calendar',
	'summary',
	'start',
	'end',
	'duration',
	'date',
	'endDate',
	'timezone',
	'rrule',
	'type',
	'task',
	'due',
	'completed',
	'priority',
	'rsvp',
	'description',
	'attachments',
	'alarm',
	'location',
	'categories',
	'class',
	'transp',
	'status',
] as const;

/** A key that the plugin owns. */
export type SchemaKey = (typeof SCHEMA_KEYS)[number];

/** The name of one of the two shapes of a schedule. */
export type ScheduleShape = 'timed' | 'all-day';

const SCHEMA_KEY_SET: ReadonlySet<string> = new Set(SCHEMA_KEYS);

/** True when the plugin owns this key. */
export function isSchemaKey(key: string): key is SchemaKey {
	return SCHEMA_KEY_SET.has(key);
}

/** The keys of one shape. */
export function shapeKeys(shape: ScheduleShape): readonly SchemaKey[] {
	return shape === 'timed' ? TIMED_KEYS : ALL_DAY_KEYS;
}

/**
 * The keys of the shape that the note leaves. A write that puts one shape
 * into a note removes each of these keys in the same write.
 */
export function departingKeys(shape: ScheduleShape): readonly SchemaKey[] {
	return shape === 'timed' ? ALL_DAY_KEYS : TIMED_KEYS;
}
