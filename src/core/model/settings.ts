import type { CalendarRegistryEntry } from './registry';

/**
 * Synced-settings schema: semantic configuration that must agree across
 * devices — accounts minus secrets, and the calendar registry; event
 * types, routing rules, and global defaults join as they land.
 * Device-local state lives behind the DeviceStore port; templates and
 * claim blocks live in the vault; secrets are stored separately and never
 * appear here.
 */

export type CredentialType = 'app-password' | 'oauth';

export interface AccountConfig {
	readonly id: string;
	readonly serverUrl: string;
	readonly username: string;
	readonly credentialType: CredentialType;
	/** Opaque reference into secret storage — never the secret itself. */
	readonly credentialRef: string;
}

export interface SyncedSettings {
	readonly accounts: readonly AccountConfig[];
	readonly calendars: readonly CalendarRegistryEntry[];
}
