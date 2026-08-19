/**
 * The check of a timezone name against the bundled table.
 *
 * The plugin stores the name that the user wrote. It never replaces that
 * name with another name. The timezone database gives more than one name
 * to one zone, and two of those names can both be current: a user who
 * writes `Asia/Calcutta` keeps `Asia/Calcutta`, and a user who writes
 * `Asia/Kolkata` keeps `Asia/Kolkata`. The two names read the same rules.
 * A store that replaced one name with the other would rewrite what the
 * user wrote, and it would also rewrite the bytes of every record that
 * holds the name.
 *
 * The check reads the bundled table and not the database of the device.
 * The list of the device differs from device to device, and it leaves out
 * names that the database still states.
 */

import { isTimezoneName, timezoneNames, timezoneRules } from './table';

/** Why a timezone name is not usable. */
export type TimezoneNameFailure = 'empty' | 'unknown';

/** What the check of a timezone name gives. */
export type TimezoneNameResult =
	| { readonly ok: true; readonly name: string }
	| { readonly ok: false; readonly failure: TimezoneNameFailure };

/**
 * The check of one timezone name. The result holds the name as the
 * caller wrote it.
 */
export function checkTimezoneName(name: string): TimezoneNameResult {
	if (name.length === 0) {
		return { ok: false, failure: 'empty' };
	}
	return isTimezoneName(name)
		? { ok: true, name }
		: { ok: false, failure: 'unknown' };
}

/** True when the bundled table states rules for the given name. */
export function isKnownTimezoneName(name: string): boolean {
	return isTimezoneName(name);
}

/** Every timezone name that the bundled table states, in order. */
export function knownTimezoneNames(): readonly string[] {
	return timezoneNames();
}

/**
 * True when two names read one set of rules. The plugin keeps both names
 * apart in what it stores, and this function answers only about the
 * rules.
 */
export function namesShareRules(left: string, right: string): boolean {
	const first = timezoneRules(left);
	const second = timezoneRules(right);
	if (first === undefined || second === undefined) {
		return false;
	}
	return (
		first.initial.offset === second.initial.offset &&
		first.initial.abbreviation === second.initial.abbreviation &&
		first.changes.length === second.changes.length &&
		first.changes.every((change, index) => {
			const other = second.changes[index];
			if (other === undefined) {
				return false;
			}
			return (
				other.at === change.at &&
				other.state.offset === change.state.offset &&
				other.state.abbreviation === change.state.abbreviation
			);
		})
	);
}
