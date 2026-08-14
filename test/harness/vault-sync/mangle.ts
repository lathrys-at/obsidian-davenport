/**
 * A merge mangler, or merger, models a sync tool that merges two changes
 * to one file, line by line and without a person. The two devices made
 * those two changes with no knowledge of each other. Such a merge
 * damages a file that is not a document.
 *
 * Every line of the merged file comes from one of the two changes, so
 * every line looks correct. The file as a whole holds a state that
 * nobody wrote. This damaged file is the failure that the tests for
 * records check against. Therefore the harness must make this file on
 * demand, and must make the same file every time.
 *
 * A merger is a plain function. Therefore a merger that replays merges
 * captured from a real tool can replace the modeled merge below, and
 * nothing else in the channel changes. The channel tells the merger
 * which side is in place and which side arrives, and the merger does not
 * work this out. The winner rule of the profile fixes the two roles.
 * Therefore two devices that merge one pair of changes make the same
 * call and get the same file.
 */

export interface MergeInputs {
	readonly path: string;
	/**
	 * The content that both sides started from. Null when the two sides
	 * share no such content.
	 */
	readonly base: string | null;
	/** The content that the merge treats as the content in place. */
	readonly local: string;
	/** The content that the merge treats as the content that arrives. */
	readonly incoming: string;
}

/** The merged content, or null when the tool makes no merge at all. */
export type MergeMangler = (inputs: MergeInputs) => string | null;

/**
 * What the merge writes for a line that both sides changed away from the
 * base content.
 */
export type LineConflictRule = 'take-incoming' | 'take-local' | 'markers';

export interface LineMergeOptions {
	readonly onBothChanged?: LineConflictRule;
}

const MARKER_LOCAL = '<<<<<<< local';
const MARKER_SPLIT = '=======';
const MARKER_INCOMING = '>>>>>>> incoming';

/**
 * A three-way merge. The merge aligns the base content, the content in
 * place, and the content that arrives by line number, and by nothing
 * else.
 *
 * A line that only one side changed comes from that side. A line that
 * both sides changed follows the rule in the options. That rule takes
 * the line that arrives by default, and writes no conflict marker into
 * the file.
 *
 * The function returns null when the call gives no base content, because
 * the merge then has nothing to align against. A real tool also makes no
 * merge when two devices make the same path with no knowledge of each
 * other, and the two sides then share no base content.
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

/**
 * A merger that makes no merge. Every divergence then falls back to the
 * conflict copy of the profile.
 */
export const declineMerge: MergeMangler = () => null;

function push(lines: string[], line: string | null): void {
	if (line !== null) {
		lines.push(line);
	}
}
