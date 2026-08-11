import type { CalendarRegistryEntry } from './registry';

/**
 * Synced-settings schema (§15.1, synced tier): semantic configuration that
 * must agree across devices — accounts minus secrets, the calendar
 * registry, and (as they land) event types, routing rules, and global
 * defaults. Device-local state lives behind the DeviceStore port; templates
 * and claim blocks live in the vault; secrets are the fourth tier (§4.3)
 * and never appear in any of the others.
 */

export type CredentialType = 'app-password' | 'oauth';

export interface AccountConfig {
	readonly id: string;
	readonly serverUrl: string;
	readonly username: string;
	readonly credentialType: CredentialType;
	/** Opaque reference into secret storage — never the secret itself (§4.3). */
	readonly credentialRef: string;
}

export interface SyncedSettings {
	readonly accounts: readonly AccountConfig[];
	readonly calendars: readonly CalendarRegistryEntry[];
}
