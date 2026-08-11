/**
 * Event identity (§3.2, §3.4): the pair (collection href, UID) — the pair,
 * not the UID alone. CalDAV guarantees UID uniqueness only per collection,
 * and iTIP scheduling deliberately delivers the same UID to every
 * attendee's collection; one UID in two synced collections is two records.
 */
export interface EventIdentity {
	readonly collectionHref: string;
	/**
	 * Server-assigned UID, or the synthesized content-derived stand-in for
	 * feed events lacking one (§5.2) — it occupies the UID position of the
	 * pair everywhere.
	 */
	readonly uid: string;
}
