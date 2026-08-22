/**
 * The settings store port holds the settings that every device must agree
 * on. These settings are the accounts, without the credentials, and the
 * calendar registry.
 *
 * A read gives the settings and the faults of the settings together. A
 * fault names one entry and one field of that entry. The store keeps the
 * faults, because the settings screen states them to the user.
 *
 * A write takes the settings that the engine holds. The store decides
 * where those settings go and which other data stands beside them. No
 * credential goes through this port.
 */

import type { SettingsReading } from '../settings/read';
import type { SyncedSettings } from '../model/settings';

export interface SettingsStore {
	read(): Promise<SettingsReading>;
	write(settings: SyncedSettings): Promise<void>;
}
