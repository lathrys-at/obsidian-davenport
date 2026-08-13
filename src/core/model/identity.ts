/**
 * The identity of an event. The identity is a pair: the href of the
 * collection, and the UID. The UID alone is not the identity.
 *
 * CalDAV promises that a UID is unique inside one collection only. iTIP
 * scheduling sends the same UID to the collection of every attendee, and
 * it does so by design. Therefore, when the plugin syncs two collections
 * that both hold the same UID, the plugin holds two records.
 */
export interface EventIdentity {
	readonly collectionHref: string;
	/**
	 * The UID of the event. The UID comes from one of three sources. The
	 * plugin creates the UID for an event that starts in the vault. The
	 * plugin reads the UID from the server for an event that comes in from
	 * the server. The plugin builds the UID from the content of a feed
	 * event when that event carries no UID. The source makes no difference
	 * afterwards: the UID always fills the UID half of the pair.
	 */
	readonly uid: string;
}
