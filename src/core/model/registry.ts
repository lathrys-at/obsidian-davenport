import type { TimezoneName } from './event';

/**
 * Ownership mode: every calendar has exactly one, set at registration and
 * changeable in settings. Newly added CalDAV calendars default to
 * remote-owned — the safe default is the one that cannot write. Feed
 * calendars are remote-owned unconditionally, with no configuration path
 * out.
 */
export type OwnershipMode = 'vault-owned' | 'remote-owned' | 'bidirectional';

export type CalendarSource = 'caldav' | 'feed';

/**
 * Component types a collection accepts; the ecosystem convention is
 * separate collections for events and tasks.
 */
export type ComponentType = 'VEVENT' | 'VTODO';

/**
 * Registry entry. The friendly name lives here and never in a record:
 * names resolve from the collection href at read time, so a rename
 * rewrites zero records. Per-calendar options accrete with their
 * features.
 */
export interface CalendarRegistryEntry {
	readonly name: string;
	readonly source: CalendarSource;
	/** Settings id of the owning account; absent for feeds. */
	readonly accountId?: string;
	readonly collectionHref: string;
	readonly mode: OwnershipMode;
	readonly components: readonly ComponentType[];
	readonly defaultTimezone?: TimezoneName;
	readonly color?: string;
}
