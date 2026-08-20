/**
 * What a write of the plugin changes in the frontmatter of a note.
 *
 * A write states two lists: the keys that it sets, with their values, and
 * the keys that it removes. The plugin computes both lists before it opens
 * the note, so one write puts the whole change into the file.
 *
 * A write of a schedule is exclusive. The note holds the keys of one shape
 * and no key of the other shape. Therefore a write that puts a timed
 * schedule into a note removes the keys of the all-day shape in the same
 * write, and a write that puts an all-day schedule into a note removes the
 * keys of the timed shape. The write also removes a key of its own shape
 * that the schedule does not state, so the note never keeps an end that
 * the schedule left behind. An event that moves between the two shapes is
 * therefore never a note that states both shapes, and the note is never
 * invalid between two writes.
 *
 * A write touches no key outside these lists. A note holds keys that the
 * user owns and keys that other plugins own, and a write of this plugin
 * leaves each of them as it is.
 */

import type { Schedule } from '../model/event';
import type { SchemaKey } from './keys';
import { ALL_DAY_KEYS, TIMED_KEYS } from './keys';

/** A value that a write puts into the frontmatter of a note. */
export type FrontmatterValue = string | number | readonly string[];

/** One key and the value that the write gives it. */
export type KeyValue = readonly [SchemaKey, FrontmatterValue];

/**
 * The change that one write makes. The two lists never name one key
 * together. The keys of `set` stand in the order of the schema, so two
 * writes that add the same keys add them in the same order.
 */
export interface FrontmatterPatch {
	readonly set: readonly KeyValue[];
	readonly remove: readonly SchemaKey[];
}

/** The keys of both shapes of a schedule. */
const SCHEDULE_KEYS: readonly SchemaKey[] = [...TIMED_KEYS, ...ALL_DAY_KEYS];

/**
 * The change that writes this schedule into a note. The change sets the
 * keys of the shape of the schedule, and it removes every other key of a
 * schedule.
 */
export function schedulePatch(schedule: Schedule): FrontmatterPatch {
	const values: KeyValue[] =
		schedule.kind === 'timed'
			? timedValues(schedule.start, schedule.end, schedule.duration)
			: allDayValues(schedule.date, schedule.endDate);
	return withRemovals(values, SCHEDULE_KEYS);
}

function timedValues(
	start: string,
	end: string | undefined,
	duration: string | undefined,
): KeyValue[] {
	const values: KeyValue[] = [['start', start]];
	if (end !== undefined) {
		values.push(['end', end]);
	}
	if (duration !== undefined) {
		values.push(['duration', duration]);
	}
	return values;
}

function allDayValues(date: string, endDate: string | undefined): KeyValue[] {
	const values: KeyValue[] = [['date', date]];
	if (endDate !== undefined) {
		values.push(['endDate', endDate]);
	}
	return values;
}

/**
 * The change that sets these keys and removes the keys of `scope` that the
 * values do not name. Each builder above states its keys in the order of
 * the schema, and this function keeps that order.
 */
function withRemovals(
	values: KeyValue[],
	scope: readonly SchemaKey[],
): FrontmatterPatch {
	const set = new Set(values.map(([key]) => key));
	return { set: values, remove: scope.filter((key) => !set.has(key)) };
}

/**
 * Applies the change to the frontmatter of a note. The function removes
 * the keys first, and then it sets the keys. The two lists name no key
 * together, so the order of the two steps changes nothing.
 *
 * The function copies a list before it puts the list into the note. The
 * note then holds no list that the caller can change afterwards.
 */
export function applyPatch(
	frontmatter: Record<string, unknown>,
	patch: FrontmatterPatch,
): void {
	for (const key of patch.remove) {
		// The platform reads the object again after this function, and a
		// key that holds no value is not the same as a key that is gone.
		// The removal therefore takes the key out of the object.
		Reflect.deleteProperty(frontmatter, key);
	}
	for (const [key, value] of patch.set) {
		frontmatter[key] = isList(value) ? [...value] : value;
	}
}

// Array.isArray gives the type any[] to its argument. This guard states
// the element type, so the copy above keeps its type.
function isList(value: FrontmatterValue): value is readonly string[] {
	return Array.isArray(value);
}
