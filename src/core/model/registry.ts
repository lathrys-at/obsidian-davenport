import type { TimezoneName } from './event';

/**
 * Ownership mode (§4.2): every calendar has exactly one, set at
 * registration. Newly added CalDAV calendars default to remote-owned — the
 * safe default is the one that cannot write. Feed calendars are
 * remote-owned unconditionally, with no configuration path out.
 */
export type OwnershipMode = 'vault-owned' | 'remote-owned' | 'bidirectional';

export type CalendarSource = 'caldav' | 'feed';

/** Component types a collection accepts (§4.1); the ecosystem convention
 * is separate collections for events and tasks (§2.1). */
export type ComponentType = 'VEVENT' | 'VTODO';

/**
 * Registry entry (§4.1). The friendly name lives here and never in a
 * record (§3.2): names resolve from the collection href at read time, so a
 * rename rewrites zero records. Per-calendar options accrete with their
 * features (§15.2).
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
