/**
 * The read of the settings, and the write of the settings back to data.
 *
 * The plugin gives this reader the value that the data file holds. The
 * reader gives back the settings that the plugin uses, and the problems
 * that it found. Each absent part takes its default, so a data file with
 * no settings in it starts the plugin with empty settings.
 *
 * The reader keeps two rules.
 *
 * 1. The reader never throws. It gives a value back for every input. A
 *    user can write anything into the data file, and a plugin that throws
 *    at load states nothing to that user.
 * 2. The reader reads the fields that it knows, and it passes over every
 *    other field. A field of a later version of the plugin is therefore
 *    not a fault.
 *
 * 3. The reader keeps the raw form of every entry that it refuses. A
 *    write puts each of those entries back into the file without a
 *    change, so a refusal never becomes an erasure. An entry that a newer
 *    version of the plugin wrote therefore survives the writes of this
 *    version, and the credential of that entry keeps its owner.
 *
 * The writers below state the fields of one entry one by one. No other
 * value reaches the data file through them. A credential holds no field
 * of the settings, so no credential reaches the file through this path
 * either.
 */

import type { AccountConfig, SyncedSettings } from '../model/settings';
import type { CalendarRegistryEntry } from '../model/registry';
import type { FieldFault, SettingsProblem, SettingsSection } from './problems';
import type { UnknownMap } from './fields';
import { isMap } from './fields';
import { readAccount } from './accounts';
import { readCalendar } from './calendars';

/** The settings of a plugin that holds no account and no calendar. */
export const DEFAULT_SETTINGS: SyncedSettings = { accounts: [], calendars: [] };

/**
 * One entry of the file, as the reader found it.
 *
 * An accepted entry carries the value that finds it again: the id of an
 * account, and the name of a calendar. A refused entry carries no such
 * value. The reader refuses an entry because a field of that entry is
 * wrong, and the field that holds the fault can be the field that would
 * name the entry. A refused entry therefore travels as the value that the
 * file holds, and nothing reads inside it.
 */
export type HeldEntry =
	| {
			readonly kind: 'accepted';
			readonly key: string;
			readonly value: UnknownMap;
	  }
	| { readonly kind: 'refused'; readonly value: unknown };

/** The entries of each section, in the order that the file holds them. */
export interface HeldSections {
	readonly accounts: readonly HeldEntry[];
	readonly calendars: readonly HeldEntry[];
}

/** The sections of a file that holds no entry. */
export const NO_HELD_SECTIONS: HeldSections = { accounts: [], calendars: [] };

export interface SettingsReading {
	readonly settings: SyncedSettings;
	readonly problems: readonly SettingsProblem[];
	/**
	 * Every entry that the file holds, accepted and refused. A write
	 * reads this list to put each refused entry back where it stood.
	 */
	readonly held: HeldSections;
}

/** Reads the settings out of the value that the data file holds. */
export function readSettings(value: unknown): SettingsReading {
	if (value === undefined || value === null) {
		return {
			settings: DEFAULT_SETTINGS,
			problems: [],
			held: NO_HELD_SECTIONS,
		};
	}
	if (!isMap(value)) {
		return {
			settings: DEFAULT_SETTINGS,
			problems: [{ kind: 'not-a-map' }],
			held: NO_HELD_SECTIONS,
		};
	}
	const problems: SettingsProblem[] = [];
	const heldAccounts: HeldEntry[] = [];
	const heldCalendars: HeldEntry[] = [];
	const accounts = readSection(
		value.accounts,
		'accounts',
		problems,
		heldAccounts,
		(entry) => {
			const reading = readAccount(entry);
			return {
				value: reading.account,
				name: reading.name,
				faults: reading.faults,
				key: reading.account?.id ?? null,
				keyField: 'id' as const,
			};
		},
	);
	const calendars = readSection(
		value.calendars,
		'calendars',
		problems,
		heldCalendars,
		(entry) => {
			const reading = readCalendar(entry);
			return {
				value: reading.entry,
				name: reading.name,
				faults: reading.faults,
				key: reading.entry?.name ?? null,
				keyField: 'name' as const,
			};
		},
	);
	return {
		settings: { accounts, calendars },
		problems,
		held: { accounts: heldAccounts, calendars: heldCalendars },
	};
}

/**
 * One account in the form that the data file holds. The result states
 * each field of the account, and it holds no other value.
 */
export function accountDocument(account: AccountConfig): UnknownMap {
	return {
		id: account.id,
		serverUrl: account.serverUrl,
		username: account.username,
		credentialType: account.credentialType,
		credentialRef: account.credentialRef,
	};
}

/**
 * One entry of the registry in the form that the data file holds. The
 * result states each field of the entry, and it holds no other value.
 */
export function calendarDocument(entry: CalendarRegistryEntry): UnknownMap {
	return {
		name: entry.name,
		source: entry.source,
		...(entry.accountId === undefined
			? {}
			: { accountId: entry.accountId }),
		collectionHref: entry.collectionHref,
		mode: entry.mode,
		components: [...entry.components],
		...(entry.defaultTimezone === undefined
			? {}
			: { defaultTimezone: entry.defaultTimezone }),
		...(entry.color === undefined ? {} : { color: entry.color }),
	};
}

/** What the reader of one entry gives back to the reader of a section. */
interface EntryReading<T> {
	readonly value: T | null;
	readonly name: string | null;
	readonly faults: readonly FieldFault[];
	/** The value that must differ between the entries of the section. */
	readonly key: string | null;
	readonly keyField: 'id' | 'name';
}

/**
 * Reads one list of entries. The reader refuses an entry that holds a
 * fault, and it refuses an entry whose key stands on an entry that it
 * already read.
 */
function readSection<T>(
	value: unknown,
	section: SettingsSection,
	problems: SettingsProblem[],
	held: HeldEntry[],
	read: (entry: UnknownMap) => EntryReading<T>,
): readonly T[] {
	if (value === undefined || value === null) {
		return [];
	}
	if (!Array.isArray(value)) {
		problems.push({ kind: 'section-not-a-list', section });
		return [];
	}
	const entries: readonly unknown[] = value;
	const accepted: T[] = [];
	const keys: string[] = [];
	entries.forEach((entry, index) => {
		if (!isMap(entry)) {
			problems.push({ kind: 'entry-not-a-map', section, index });
			held.push({ kind: 'refused', value: entry });
			return;
		}
		const reading = read(entry);
		for (const fault of reading.faults) {
			problems.push({
				kind: 'entry-field',
				section,
				index,
				name: reading.name,
				fault,
			});
		}
		if (reading.value === null || reading.key === null) {
			held.push({ kind: 'refused', value: entry });
			return;
		}
		if (keys.includes(reading.key)) {
			problems.push({
				kind: 'entry-field',
				section,
				index,
				name: reading.name,
				fault: {
					kind: 'repeated',
					field: reading.keyField,
					value: reading.key,
				},
			});
			held.push({ kind: 'refused', value: entry });
			return;
		}
		keys.push(reading.key);
		held.push({ kind: 'accepted', key: reading.key, value: entry });
		accepted.push(reading.value);
	});
	return accepted;
}
