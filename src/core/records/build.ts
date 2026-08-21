/**
 * The build of one record from the state that the plugin holds.
 *
 * The bytes of a record follow from four inputs: the state on the server,
 * the pointer to the venue, the materialization map with its content
 * hash, and the tombstone. This module takes those inputs and gives back
 * the content of one record. Two devices that hold one set of inputs
 * therefore build one record, and the writer sees no difference to write.
 *
 * The module does three things that the caller must not do again. It
 * puts the base snapshot into the canonical form of this build. It
 * applies the rule that decides what the record does with a timezone
 * definition. It reads the reaches of the bundled table out of the
 * result, and it writes the stamp that names this build.
 *
 * The checksum stands empty in the result. The seal computes the checksum
 * over the bytes of the whole file, so only the step that writes the file
 * can fill that field.
 */

import type { JCalComponent } from '../ics/jcal';
import { serializeCalendar } from '../ics/serializer';
import { normalizationStampAt } from '../ics/stamp';
import type { NormalizationVersions } from '../model/normalization';
import type {
	MaterializationEntry,
	RecordData,
	RecordFields,
	VenuePointer,
} from '../model/record';
import type { EventIdentity } from '../model/identity';
import type { Tombstone } from '../model/tombstone';
import type { BaseCalendar } from './base-ics';
import { baseCalendar } from './base-ics';
import { BLANK_CHECKSUM } from './schema';

/** The state that one record states. */
export interface RecordInput {
	readonly identity: EventIdentity;
	readonly resourceHref?: string;
	readonly etag?: string;
	readonly fields: RecordFields;
	/** The calendar as the server states it, after the parse boundary. */
	readonly calendar: JCalComponent;
	readonly venue?: VenuePointer;
	readonly materialization?: Readonly<Record<string, MaterializationEntry>>;
	readonly renderHashes?: {
		readonly description?: string;
		readonly attachments?: string;
	};
	readonly tombstone?: Tombstone;
}

/** The content of one record, and what the timezone rule did to it. */
export interface BuiltRecord {
	readonly data: RecordData;
	readonly base: BaseCalendar;
}

/** Builds the content of one record from the state that the plugin holds. */
export function buildRecord(
	versions: NormalizationVersions,
	input: RecordInput,
): BuiltRecord {
	const base = baseCalendar(input.calendar);
	const instanceDates = Object.keys(input.materialization ?? {});
	const data: RecordData = {
		identity: input.identity,
		...only('resourceHref', input.resourceHref),
		...only('etag', input.etag),
		fields: input.fields,
		baseIcs: serializeCalendar(base.calendar),
		...only('venue', input.venue),
		...only('materialization', input.materialization),
		...only('renderHashes', input.renderHashes),
		...only('tombstone', input.tombstone),
		normalizationVersion: normalizationStampAt(versions, {
			calendar: base.calendar,
			instanceDates,
		}),
		checksum: BLANK_CHECKSUM,
	};
	return { data, base };
}

function only<K extends string, T>(
	key: K,
	value: T | undefined,
): Partial<Record<K, T>> {
	return value === undefined ? {} : ({ [key]: value } as Record<K, T>);
}
