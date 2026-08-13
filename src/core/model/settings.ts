import type { CalendarRegistryEntry } from './registry';

/**
 * The schema of the synced settings. These settings hold the
 * configuration that carries meaning, and not the mechanical state that
 * one device keeps for itself. Every device must hold the same values.
 * These settings hold the accounts, without the secrets, and the calendar
 * registry. Event types, routing rules, and global defaults join these
 * settings as those features land.
 *
 * Three kinds of data stay out of these settings. State that belongs to
 * one device sits behind the DeviceStore port. Templates and claim blocks
 * sit in the vault. Secrets sit in separate storage.
 */

export type CredentialType = 'app-password' | 'oauth';

export interface AccountConfig {
	readonly id: string;
	readonly serverUrl: string;
	readonly username: string;
	readonly credentialType: CredentialType;
	/**
	 * A reference into the secret storage. This value has no meaning
	 * outside that storage, and this value is never the secret itself.
	 */
	readonly credentialRef: string;
}

export interface SyncedSettings {
	readonly accounts: readonly AccountConfig[];
	readonly calendars: readonly CalendarRegistryEntry[];
}
