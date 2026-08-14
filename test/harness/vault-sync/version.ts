/**
 * The version of one path. A version says which changes the holder of
 * that version knows about. A delivery carries the version of the path
 * that the delivery changes.
 *
 * Each device counts its own changes to a path. The version that a
 * device holds for a path keeps one count for each device that changed
 * that path. Each count is the highest count that the holder saw from
 * that device.
 *
 * One version covers a second version when the count of the first
 * version is at least as high as the count of the second version, for
 * every device. This comparison separates three conditions:
 *
 * - The version of the delivery covers the version of the destination.
 *   The destination is then only behind the origin, and the change
 *   applies.
 * - The version of the destination already covers the version of the
 *   delivery. The delivery then brings nothing new.
 * - Neither version covers the other version. The two devices then made
 *   their changes with no knowledge of each other.
 *
 * A path that a device deleted keeps its version. Without that version,
 * a device that deleted a file would look the same as a device that
 * never held the file. A change that a second device made at the same
 * time would then land as an ordinary creation.
 */

import type { DeviceId } from './types';

/**
 * The number of changes that each device made to one path, as far as the
 * holder of this version knows.
 */
export type PathVersion = Readonly<Record<DeviceId, number>>;

/** The version of a path that no device changed. */
export const INITIAL_VERSION: PathVersion = Object.freeze({});

/** The version after this device makes one more change to the path. */
export function bumpVersion(
	version: PathVersion,
	device: DeviceId,
): PathVersion {
	return { ...version, [device]: (version[device] ?? 0) + 1 };
}

/**
 * True when this version knows every change that the other version
 * knows.
 */
export function covers(version: PathVersion, other: PathVersion): boolean {
	return Object.entries(other).every(
		([device, count]) => (version[device] ?? 0) >= count,
	);
}

/** For each device, the highest count that either version holds. */
export function mergeVersions(a: PathVersion, b: PathVersion): PathVersion {
	const merged: Record<DeviceId, number> = { ...a };
	for (const [device, count] of Object.entries(b)) {
		merged[device] = Math.max(merged[device] ?? 0, count);
	}
	return merged;
}
