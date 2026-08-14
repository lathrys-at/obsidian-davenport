import type { TimezoneName } from './event';

/**
 * Which side owns a calendar. Every calendar has exactly one mode. The
 * plugin sets the mode when it registers the calendar, and the user can
 * change the mode in the settings.
 *
 * A new CalDAV calendar starts as `remote-owned`. The `remote-owned` mode
 * is the one mode that cannot write to the server. A mode that cannot
 * write to the server is the safe start. A feed calendar is always
 * `remote-owned`, and the settings give no way out of that mode.
 */
export type OwnershipMode = 'vault-owned' | 'remote-owned' | 'bidirectional';

export type CalendarSource = 'caldav' | 'feed';

/**
 * The component types that one collection accepts. The convention in the
 * calendar ecosystem is one collection for events and another collection
 * for tasks.
 */
export type ComponentType = 'VEVENT' | 'VTODO';

/**
 * One entry in the calendar registry. The name that the user sees lives
 * here, and never in a record. The plugin resolves that name from the
 * collection href at read time, so a rename rewrites no record at all.
 * More per-calendar options join this entry as their features land.
 */
export interface CalendarRegistryEntry {
	readonly name: string;
	readonly source: CalendarSource;
	/**
	 * The id of the account that owns this calendar, as the settings hold
	 * it. A feed calendar has no account.
	 */
	readonly accountId?: string;
	readonly collectionHref: string;
	readonly mode: OwnershipMode;
	readonly components: readonly ComponentType[];
	readonly defaultTimezone?: TimezoneName;
	readonly color?: string;
}
