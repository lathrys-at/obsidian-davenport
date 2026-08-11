/**
 * Per-path version vectors: the causality a delivery carries.
 *
 * Each device counts its own changes to a path, and the version a device
 * holds for that path is the highest count it has seen from every device
 * that changed it. One version covers another when it has seen at least
 * as many changes from every device, which is what separates a
 * destination that is merely behind from one that has diverged: a
 * delivery whose version covers the destination's applies, one the
 * destination's version already covers is old news, and two versions
 * where neither covers the other are concurrent edits made without
 * knowledge of each other.
 *
 * A deleted path keeps its version. Without that a device that deleted a
 * file could not be told from one that never held it, and an edit racing
 * the deletion would land as an ordinary creation.
 */

import type { DeviceId } from './types';

/** Changes each device has made to one path, as far as the holder knows. */
export type PathVersion = Readonly<Record<DeviceId, number>>;

/** The version of a path no device has changed. */
export const INITIAL_VERSION: PathVersion = Object.freeze({});

/** The version after one more change to the path by this device. */
export function bumpVersion(
	version: PathVersion,
	device: DeviceId,
): PathVersion {
	return { ...version, [device]: (version[device] ?? 0) + 1 };
}

/** Whether this version has seen every change the other one has. */
export function covers(version: PathVersion, other: PathVersion): boolean {
	return Object.entries(other).every(
		([device, count]) => (version[device] ?? 0) >= count,
	);
}

/** Everything the two versions have seen between them. */
export function mergeVersions(a: PathVersion, b: PathVersion): PathVersion {
	const merged: Record<DeviceId, number> = { ...a };
	for (const [device, count] of Object.entries(b)) {
		merged[device] = Math.max(merged[device] ?? 0, count);
	}
	return merged;
}
