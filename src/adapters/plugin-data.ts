/**
 * The layout of the data file of the plugin.
 *
 * Obsidian gives each plugin one data file. The plugin reads the whole
 * file with `loadData`, and it writes the whole file with `saveData`. This
 * module owns what stands in that file, and it is the only module that
 * does.
 *
 * The file holds two keys of its own.
 *
 * - `settings` holds the settings that every device must agree on.
 * - `secretFallback` holds the credentials, on a version of Obsidian that
 *   gives the plugin no secret storage. The file holds those credentials
 *   as plain text, and the settings screen states that condition to the
 *   user.
 *
 * The two keys never mix. A write of the settings touches no credential,
 * and a write of a credential touches no setting.
 *
 * A write keeps every key that this module does not own. Two conditions
 * make that rule necessary. First, the file travels between devices when
 * the setup of the user carries it, and a later version of the plugin can
 * write a key that this version does not know. Second, the read of the
 * settings passes over a field that it does not know, so a write that
 * dropped such a field would take it away from the device that wrote it.
 */

import type { SettingsStore } from '../core/ports/settings-store';
import type { SyncedSettings } from '../core/model/settings';
import { isMap } from '../core/settings/fields';
import type { SettingsReading } from '../core/settings/read';
import { readSettings, settingsDocument } from '../core/settings/read';

/**
 * The part of the plugin class that this module uses. The `Plugin` class
 * of Obsidian satisfies this interface, and a test drives this module
 * with a double of the two methods.
 */
export interface PluginDataHost {
	loadData(): Promise<unknown>;
	saveData(data: unknown): Promise<void>;
}

/** The key that holds the settings. */
export const SETTINGS_KEY = 'settings';

/** The key that holds the credentials of the fallback. */
export const SECRET_FALLBACK_KEY = 'secretFallback';

export class PluginDataStore implements SettingsStore {
	private readonly host: PluginDataHost;

	constructor(host: PluginDataHost) {
		this.host = host;
	}

	async read(): Promise<SettingsReading> {
		const document = await this.document();
		return readSettings(document[SETTINGS_KEY]);
	}

	async write(settings: SyncedSettings): Promise<void> {
		const document = await this.document();
		const held = document[SETTINGS_KEY];
		document[SETTINGS_KEY] = {
			...(isMap(held) ? held : {}),
			...settingsDocument(settings),
		};
		await this.host.saveData(document);
	}

	/**
	 * The credential that the reference names, or null where the file
	 * holds none. The value comes back as the file holds it. The caller
	 * decides what an empty value states.
	 */
	async readSecret(ref: string): Promise<string | null> {
		const fallback = this.fallbackOf(await this.document());
		const value = fallback[ref];
		return typeof value === 'string' ? value : null;
	}

	async writeSecret(ref: string, value: string): Promise<void> {
		const document = await this.document();
		const fallback = this.fallbackOf(document);
		fallback[ref] = value;
		document[SECRET_FALLBACK_KEY] = fallback;
		await this.host.saveData(document);
	}

	/**
	 * Removes the credential that the reference names. The file keeps no
	 * empty set of credentials: where the last credential goes, the key
	 * of the fallback goes with it.
	 */
	async removeSecret(ref: string): Promise<void> {
		const document = await this.document();
		const fallback = this.fallbackOf(document);
		if (!(ref in fallback)) {
			return;
		}
		const kept = without(fallback, ref);
		if (Object.keys(kept).length === 0) {
			await this.host.saveData(without(document, SECRET_FALLBACK_KEY));
			return;
		}
		document[SECRET_FALLBACK_KEY] = kept;
		await this.host.saveData(document);
	}

	/** The whole data file, as a set of named values. */
	private async document(): Promise<Record<string, unknown>> {
		const held: unknown = await this.host.loadData();
		return isMap(held) ? { ...held } : {};
	}

	private fallbackOf(
		document: Record<string, unknown>,
	): Record<string, unknown> {
		const held = document[SECRET_FALLBACK_KEY];
		return isMap(held) ? { ...held } : {};
	}
}

/** The same set of values, without the value of one key. */
function without(
	held: Readonly<Record<string, unknown>>,
	key: string,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(held).filter(([name]) => name !== key),
	);
}
