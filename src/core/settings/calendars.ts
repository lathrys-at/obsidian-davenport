/**
 * The reader of one entry of the calendar registry.
 *
 * The registry entries arrive with the settings, and the plugin reads each
 * entry the way it reads an account. An entry that holds a fault is not
 * part of the settings that the plugin uses, and the settings screen
 * states the fault.
 *
 * The plugin fills the registry when it finds the calendars of an account.
 * That step is not part of the plugin yet. The reader stands here now, so
 * that a registry which reaches the data file from another device survives
 * a read and a write on this device.
 *
 * Two rules stand beside the fields. A calendar of a feed takes the mode
 * `remote-owned` alone, because Davenport writes to no feed. A calendar of
 * a CalDAV server names the account that reaches that server; a calendar
 * of a feed names no account.
 */

import type {
	CalendarRegistryEntry,
	CalendarSource,
	ComponentType,
	OwnershipMode,
} from '../model/registry';
import type { FieldFault } from './problems';
import type { UnknownMap } from './fields';
import {
	optionalText,
	requiredText,
	requiredWord,
	requiredWordList,
} from './fields';

/** The places that a calendar comes from. */
export const CALENDAR_SOURCES: readonly CalendarSource[] = ['caldav', 'feed'];

/** The modes that state which side owns a calendar. */
export const OWNERSHIP_MODES: readonly OwnershipMode[] = [
	'vault-owned',
	'remote-owned',
	'bidirectional',
];

/** The component types that a collection accepts. */
export const COMPONENT_TYPES: readonly ComponentType[] = ['VEVENT', 'VTODO'];

/** What the reader made of one entry of the registry. */
export interface CalendarReading {
	/** The entry, or null where one field or more holds a fault. */
	readonly entry: CalendarRegistryEntry | null;
	/** The name of the entry, or null where the entry states no name. */
	readonly name: string | null;
	readonly faults: readonly FieldFault[];
}

/** Reads one entry of the calendar registry. */
export function readCalendar(entry: UnknownMap): CalendarReading {
	const faults: FieldFault[] = [];
	const name = requiredText(entry, 'name', faults);
	const source = requiredWord(entry, 'source', CALENDAR_SOURCES, faults);
	const collectionHref = requiredText(entry, 'collectionHref', faults);
	const mode = requiredWord(entry, 'mode', OWNERSHIP_MODES, faults);
	const components = requiredWordList(
		entry,
		'components',
		COMPONENT_TYPES,
		faults,
	);
	const accountId = optionalText(entry, 'accountId', faults);
	const defaultTimezone = optionalText(entry, 'defaultTimezone', faults);
	const color = optionalText(entry, 'color', faults);
	if (source === 'feed' && mode !== null && mode !== 'remote-owned') {
		faults.push({ kind: 'feed-mode', field: 'mode', value: mode });
	}
	if (source === 'caldav' && accountId === undefined) {
		faults.push({ kind: 'missing', field: 'accountId' });
	}
	if (
		faults.length > 0 ||
		name === null ||
		source === null ||
		collectionHref === null ||
		mode === null ||
		components === null ||
		accountId === null ||
		defaultTimezone === null ||
		color === null
	) {
		return { entry: null, name, faults };
	}
	return {
		entry: {
			name,
			source,
			collectionHref,
			mode,
			components,
			...(accountId === undefined ? {} : { accountId }),
			...(defaultTimezone === undefined ? {} : { defaultTimezone }),
			...(color === undefined ? {} : { color }),
		},
		name,
		faults,
	};
}
