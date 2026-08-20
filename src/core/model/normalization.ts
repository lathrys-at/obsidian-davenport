/**
 * The normalization stamp of a record.
 *
 * The bytes of a record follow from three things: the bytes that the
 * server sent, the intent that the vault holds, and the value of each
 * component of this stamp that the record carries. The code that writes
 * those bytes changes from one plugin version to the next, so a record
 * states which version of that code wrote it. The statement is the stamp.
 * A device reads the stamp before it compares bytes.
 *
 * The stamp has two components. Each component is one whole number, and a
 * component never decreases from one plugin version to the next.
 *
 * The core component covers three inputs to the byte form. The first
 * input is the rules of the canonical serializer. The second input is the
 * serializer of the parse library. The third input is the code that
 * writes the frontmatter of a record. The third input has no code yet,
 * and the core component covers that code from the day that the code
 * lands. Every record carries the core component.
 *
 * The timezone component covers two inputs. The first input is the
 * release of the timezone table that the plugin bundles. The second input
 * is the code that writes a timezone definition from that table. The
 * component covers every byte of a record that the bundled table can
 * reach.
 *
 * A record carries the timezone component only when the bundled table can
 * reach the bytes of that record. Each way that the table can reach those
 * bytes is one reach. The file stamp.ts holds the list of the known
 * reaches, and the predicates that find each one.
 */

/** The two components as one record carries them. */
export interface NormalizationStamp {
	readonly core: number;
	/** The component is absent from a record that shows no reach of the table. */
	readonly timezone?: number;
}

/** The value that this build holds for each component. */
export interface NormalizationVersions {
	readonly core: number;
	readonly timezone: number;
}
