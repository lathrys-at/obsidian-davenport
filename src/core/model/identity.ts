/**
 * Event identity: the pair (collection href, UID) — the pair, not the UID
 * alone. CalDAV guarantees UID uniqueness only per collection, and iTIP
 * scheduling deliberately delivers the same UID to every attendee's
 * collection; one UID in two synced collections is two records.
 */
export interface EventIdentity {
	readonly collectionHref: string;
	/**
	 * UID minted by the plugin for vault-originated events, read from the
	 * server for inbound ones, or synthesized from content for feed events
	 * lacking one. Whatever its origin, it occupies the UID position of the
	 * pair everywhere.
	 */
	readonly uid: string;
}
