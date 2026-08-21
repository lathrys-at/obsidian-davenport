/**
 * The comparison of the content of two records.
 *
 * A device that meets a record file with different bytes asks one
 * question first: did the state change, or did another build write the
 * same state with other bytes? The skew rule answers only the second
 * case, so the device must separate the two before it applies that rule.
 *
 * The comparison passes over two fields. It passes over the checksum,
 * which follows from every other field. It passes over the normalization
 * stamp, which states the build and not the state.
 *
 * The comparison runs both records through the emitter of the device that
 * compares them. The emitter covers every field of the closed schema, so
 * a difference in any field reaches the text. One emitter on both sides
 * also removes the version of the emitter from the answer, which is the
 * whole point of the question.
 *
 * The base snapshot stands beside that text, and it needs the same
 * treatment for the same reason. The bundled table decides whether a
 * record carries a timezone definition or a reference to one, and two
 * devices can hold two releases of that table. The two devices therefore
 * compute two base snapshots from one state of the server. A comparison
 * that read those bytes whole would call that difference a change of the
 * state, and the two devices would rewrite the record in turn and never
 * stop. The skew rule exists to stop exactly that, and the comparison
 * must reach the skew rule for the rule to work.
 *
 * The comparison therefore splits the base snapshot in two parts.
 *
 * - The first part is the calendar with no definition under a name that
 *   a value of that calendar refers to. A table release decides whether
 *   such a definition stands in the record, so those bytes state the
 *   release and not the state. The comparison reads every other byte of
 *   the calendar. A definition that no value refers to therefore stays in
 *   this part, because no table release removes such a definition.
 * - The second part holds each definition that the first part removed, by
 *   name. The comparison reads a definition only where both records carry
 *   one under that name. A device keeps such a definition only where its
 *   table lacks the name, so two records that both carry one came from
 *   two devices that both lack it. A difference in those bytes is
 *   therefore a change of the server and not a difference of two tables.
 *
 * The split asks no table, so two devices at two releases split one
 * calendar the same way.
 *
 * One difference stays outside the comparison. A server can add a
 * definition under a referenced name that no table holds, and a server can
 * take such a definition away. One record then carries the definition and
 * the other does not, which is the shape that a table release also makes,
 * and no part of a record separates the two causes. The comparison passes
 * over it, and the record takes the new state with the next change of any
 * other byte.
 *
 * Both sides must already hold the canonical form of this build. The
 * reader gives that form back, and so does the builder of a record. A
 * snapshot that the parse boundary refuses stands in the comparison
 * whole, because nothing can split a text that no device can read.
 */

import type { RecordData } from '../model/record';
import type { JCalComponent } from '../ics/jcal';
import { parseIcs } from '../ics/parse';
import { serializeCalendar } from '../ics/serializer';
import {
	definedZones,
	definitionsOf,
	referencedZones,
	withoutDefinitions,
} from '../ics/zones';
import { emitFrontmatter } from './emitter';
import { CHECKSUM_KEY, recordEntries } from './schema';

/** The keys that state the build, and not the state of the event. */
const BUILD_KEYS: readonly string[] = [CHECKSUM_KEY, 'normalization'];

/**
 * The character that stands between the two halves of the key. The
 * emitter writes an escape in the place of this character inside a text,
 * and it writes the character nowhere else. The two halves of the key
 * therefore cannot run into each other.
 */
const SEPARATOR = '\u0000';

/**
 * A text that two records share when their content is the same, except
 * for the definitions that a table release can move. {@link
 * sameRecordContent} is the whole comparison, and this text is the part
 * of it that stands as one value. No file ever holds this text.
 */
export function recordContentKey(data: RecordData): string {
	return contentParts(data).key;
}

/** True when two records hold the same state of the same event. */
export function sameRecordContent(
	left: RecordData,
	right: RecordData,
): boolean {
	const first = contentParts(left);
	const second = contentParts(right);
	return (
		first.key === second.key &&
		sharedDefinitionsAgree(first.definitions, second.definitions)
	);
}

/** The two parts that the comparison of one record reads. */
interface ContentParts {
	/** The fields and the calendar, with the moving definitions removed. */
	readonly key: string;
	/** The removed definitions, by the name that each one states. */
	readonly definitions: ReadonlyMap<string, string>;
}

function contentParts(data: RecordData): ContentParts {
	const entries = recordEntries(data).filter(
		(entry) => !BUILD_KEYS.includes(entry.key),
	);
	const base = splitBase(data.baseIcs);
	return {
		key: emitFrontmatter(entries) + SEPARATOR + base.text,
		definitions: base.definitions,
	};
}

interface SplitBase {
	readonly text: string;
	readonly definitions: ReadonlyMap<string, string>;
}

/**
 * The base snapshot without the definitions that a table release can
 * move, and those definitions by name.
 */
function splitBase(baseIcs: string): SplitBase {
	const parsed = parseIcs(baseIcs);
	if (!parsed.ok) {
		return { text: baseIcs, definitions: new Map() };
	}
	const defined = definedZones(parsed.calendar);
	const moving = referencedZones(parsed.calendar, (name) =>
		defined.includes(name),
	);
	const definitions = new Map<string, string>();
	for (const name of moving) {
		definitions.set(name, definitionText(parsed.calendar, name));
	}
	return {
		text: serializeCalendar(
			withoutDefinitions(parsed.calendar, (name) =>
				moving.includes(name),
			),
		),
		definitions,
	};
}

/**
 * A text that states the definitions of one name. The text is a
 * comparison value and no file holds it, so the form needs to separate
 * two definitions and needs nothing else.
 */
function definitionText(calendar: JCalComponent, name: string): string {
	return JSON.stringify(definitionsOf(calendar, name));
}

/** True where no name carries two different definitions. */
function sharedDefinitionsAgree(
	left: ReadonlyMap<string, string>,
	right: ReadonlyMap<string, string>,
): boolean {
	for (const [name, definition] of left) {
		const other = right.get(name);
		if (other !== undefined && other !== definition) {
			return false;
		}
	}
	return true;
}
