/**
 * Merge mangling: the damage a line-level automatic merge does to a file
 * that is not a document.
 *
 * A tool that merges two concurrent edits line by line produces a file
 * whose every line came from somewhere real and whose contents as a whole
 * belong to no version anybody wrote. That is the failure records are
 * checked against, so the harness needs to produce it on demand and
 * produce the same one every time.
 *
 * The merger is a plain function, so the modeled merge below can be
 * swapped for one replaying merges captured from a real tool without
 * anything else in the channel changing. It is told which side is in
 * place and which is arriving rather than working it out: the channel
 * fixes those roles by the profile's winner rule, so two devices merging
 * one pair of edits hand the merger the same call and get the same file.
 */

export interface MergeInputs {
	readonly path: string;
	/** Content both sides started from; null where they share none. */
	readonly base: string | null;
	/** The side the merge treats as already in place. */
	readonly local: string;
	/** The side the merge treats as arriving. */
	readonly incoming: string;
}

/** Merged content, or null where the tool would not merge at all. */
export type MergeMangler = (inputs: MergeInputs) => string | null;

/** What the merge emits for a line both sides changed away from the base. */
export type LineConflictRule = 'take-incoming' | 'take-local' | 'markers';

export interface LineMergeOptions {
	readonly onBothChanged?: LineConflictRule;
}

const MARKER_LOCAL = '<<<<<<< local';
const MARKER_SPLIT = '=======';
const MARKER_INCOMING = '>>>>>>> incoming';

/**
 * A three-way merge that aligns the three versions by line number and
 * nothing else. A line only one side changed takes that side; a line both
 * sides changed follows the configured rule, which defaults to taking the
 * incoming side silently — the spelling that leaves no trace in the file.
 *
 * Without a base there is nothing to align against and the merge declines,
 * which is how a tool behaves when two devices create the same path
 * independently.
 */
export function lineMergeMangler(options: LineMergeOptions = {}): MergeMangler {
	const rule = options.onBothChanged ?? 'take-incoming';
	return ({ base, local, incoming }) => {
		if (base === null) {
			return null;
		}
		const baseLines = base.split('\n');
		const localLines = local.split('\n');
		const incomingLines = incoming.split('\n');
		const height = Math.max(
			baseLines.length,
			localLines.length,
			incomingLines.length,
		);
		const merged: string[] = [];
		for (let index = 0; index < height; index += 1) {
			const baseLine = baseLines[index] ?? null;
			const localLine = localLines[index] ?? null;
			const incomingLine = incomingLines[index] ?? null;
			if (localLine === incomingLine) {
				push(merged, localLine);
			} else if (localLine === baseLine) {
				push(merged, incomingLine);
			} else if (incomingLine === baseLine) {
				push(merged, localLine);
			} else if (rule === 'take-incoming') {
				push(merged, incomingLine);
			} else if (rule === 'take-local') {
				push(merged, localLine);
			} else {
				merged.push(MARKER_LOCAL);
				push(merged, localLine);
				merged.push(MARKER_SPLIT);
				push(merged, incomingLine);
				merged.push(MARKER_INCOMING);
			}
		}
		return merged.join('\n');
	};
}

/** A merger that never merges; every divergence takes the profile's copy. */
export const declineMerge: MergeMangler = () => null;

function push(lines: string[], line: string | null): void {
	if (line !== null) {
		lines.push(line);
	}
}
