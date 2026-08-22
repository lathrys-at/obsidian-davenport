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
 * A write keeps every key that this module does not own. It keeps such a
 * key at the top level of the file, inside the settings, and inside each
 * entry that the settings hold. Two conditions make that rule necessary.
 * First, the file travels between devices when the setup of the user
 * carries it, and a later version of the plugin can write a key that this
 * version does not know. Second, the read of the settings passes over a
 * field that it does not know, so a write that dropped such a field would
 * take it away from the device that wrote it. A write finds the entry of
 * the file that stands for an entry of the settings by the id of an
 * account and by the name of a calendar.
 *
 * One call of this module runs at a time. Each method reads the whole
 * file, changes one part of it, and writes the whole file back. Two calls
 * that ran together would each write what the other one did not see, and
 * one of the two changes would go. The queue below therefore holds each
 * call until the call before it ends.
 */

import type { SettingsStore } from '../core/ports/settings-store';
import type { SyncedSettings } from '../core/model/settings';
import type { UnknownMap } from '../core/settings/fields';
import { isMap } from '../core/settings/fields';
import type { HeldEntry, SettingsReading } from '../core/settings/read';
import {
	accountDocument,
	calendarDocument,
	readSettings,
} from '../core/settings/read';

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
	/** The call that runs now. The next call waits for it to end. */
	private last: Promise<unknown> = Promise.resolve();

	constructor(host: PluginDataHost) {
		this.host = host;
	}

	read(): Promise<SettingsReading> {
		return this.queue(async () => {
			const document = await this.document();
			return readSettings(document[SETTINGS_KEY]);
		});
	}

	write(settings: SyncedSettings): Promise<void> {
		return this.queue(async () => {
			const document = await this.document();
			const held = document[SETTINGS_KEY];
			const heldSettings = isMap(held) ? held : {};
			const reading = readSettings(held);
			document[SETTINGS_KEY] = {
				...heldSettings,
				accounts: sectionDocument(
					settings.accounts.map((account) => ({
						key: account.id,
						value: accountDocument(account),
					})),
					reading.held.accounts,
				),
				calendars: sectionDocument(
					settings.calendars.map((entry) => ({
						key: entry.name,
						value: calendarDocument(entry),
					})),
					reading.held.calendars,
				),
			};
			await this.host.saveData(document);
		});
	}

	/**
	 * The credential that the reference names, or null where the file
	 * holds none. The value comes back as the file holds it. The caller
	 * decides what an empty value states.
	 */
	readSecret(ref: string): Promise<string | null> {
		return this.queue(async () => {
			const fallback = this.fallbackOf(await this.document());
			const value = fallback[ref];
			return typeof value === 'string' ? value : null;
		});
	}

	writeSecret(ref: string, value: string): Promise<void> {
		return this.queue(async () => {
			const document = await this.document();
			const fallback = this.fallbackOf(document);
			fallback[ref] = value;
			document[SECRET_FALLBACK_KEY] = fallback;
			await this.host.saveData(document);
		});
	}

	/**
	 * Removes the credential that the reference names. The file keeps no
	 * empty set of credentials: where the last credential goes, the key
	 * of the fallback goes with it.
	 */
	removeSecret(ref: string): Promise<void> {
		return this.queue(async () => {
			const document = await this.document();
			const fallback = this.fallbackOf(document);
			if (!(ref in fallback)) {
				return;
			}
			const kept = without(fallback, ref);
			if (Object.keys(kept).length === 0) {
				await this.host.saveData(
					without(document, SECRET_FALLBACK_KEY),
				);
				return;
			}
			document[SECRET_FALLBACK_KEY] = kept;
			await this.host.saveData(document);
		});
	}

	/**
	 * Runs one job after the job before it ends. A job that fails stops
	 * no later job: the queue holds the order of the jobs, and it carries
	 * no result from one job to the next.
	 */
	private queue<T>(job: () => Promise<T>): Promise<T> {
		const next = this.last.then(job, job);
		this.last = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
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

/** One entry that the settings hold, with the value that finds it again. */
interface WrittenEntry {
	readonly key: string;
	readonly value: UnknownMap;
}

/**
 * The entries of one section, in the order that the file holds them.
 *
 * An entry that the reader refused goes back into the file as it stands.
 * The plugin reads nothing inside such an entry, so the write carries it
 * whole and changes no byte of it. A refusal is therefore never an
 * erasure, and an entry that a newer version of the plugin wrote survives
 * the writes of this version.
 *
 * An entry that the reader accepted takes the fields of the write. The
 * fields of the file that the write does not state stand under those
 * fields, so a field that this version does not know survives as well. An
 * entry that the settings no longer hold goes. An entry that the settings
 * hold and the file does not comes after the entries of the file.
 */
function sectionDocument(
	written: readonly WrittenEntry[],
	held: readonly HeldEntry[],
): readonly unknown[] {
	const byKey = new Map(written.map((entry) => [entry.key, entry.value]));
	const taken = new Set<string>();
	const entries: unknown[] = [];
	for (const entry of held) {
		if (entry.kind === 'refused') {
			entries.push(entry.value);
			continue;
		}
		const match = byKey.get(entry.key);
		if (match === undefined) {
			continue;
		}
		taken.add(entry.key);
		entries.push({ ...entry.value, ...match });
	}
	for (const entry of written) {
		if (!taken.has(entry.key)) {
			entries.push(entry.value);
		}
	}
	return entries;
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
