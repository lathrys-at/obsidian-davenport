/**
 * The decisions behind the repeat-build check:
 *
 * - which files of a build the check compares;
 * - where two files first differ;
 * - how much of each file the report shows around that place;
 * - what makes the check fail.
 *
 * No function here reads a file, and no function starts a build. The caller
 * runs the build two times, reads the files that each run wrote, and gives
 * the bytes to these functions. Therefore a test can exercise every decision
 * directly. `repeat-build.mjs` runs the builds, reads the files, prints the
 * report, and sets the exit status. `repeat-build-text.ts` holds the wording
 * that the check prints.
 *
 * The claim of this check is narrow. Two runs of one build, on one machine,
 * from the same source, must write the same bytes. The check does not
 * compare two machines, and it does not compare two versions of the tools.
 * The repository pins the version of Node and the version of esbuild, and the
 * claim holds for those versions.
 *
 * The check compares every file that the build declares, and it compares the
 * file that holds the declaration. A build that declares no file is a fault,
 * and the check fails on that fault. Such a change never leaves a check that
 * compares nothing and reports success.
 */

/** A value that the text gave, or the reason that the text cannot give it. */
export type Reading<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly reason: string };

/** The count of bytes that one line of the report shows. */
export const LINE = 16;

/**
 * The count of bytes that the report shows around a difference. The window
 * holds four lines. One line stands before the line that holds the
 * difference, and two lines stand after it.
 */
export const WINDOW = 4 * LINE;

/** One file that a run of the build wrote. */
export interface Artifact {
	readonly path: string;
	/**
	 * The SHA-256 digest of the bytes, as lower-case hexadecimal. The report
	 * gives this digest, so that a person can compare this file against a
	 * file of another build. The comparison reads the bytes, and the
	 * comparison never reads the digest.
	 */
	readonly digest: string;
	readonly bytes: Uint8Array;
}

/** A part of a file, and the place in that file where the part starts. */
export interface Window {
	readonly start: number;
	readonly bytes: Uint8Array;
}

/** One file that the two runs wrote with different bytes. */
export interface Difference {
	readonly path: string;
	/** The place of the first byte that the two files do not share. */
	readonly offset: number;
	readonly firstSize: number;
	readonly secondSize: number;
	readonly firstWindow: Window;
	readonly secondWindow: Window;
}

/** One file that the two runs wrote with the same bytes. */
export interface Match {
	readonly path: string;
	readonly size: number;
	readonly digest: string;
}

/** What the check found when it compared the two runs. */
export interface Comparison {
	readonly matches: readonly Match[];
	readonly differences: readonly Difference[];
	/** The files that the first run wrote and the second run did not. */
	readonly onlyFirst: readonly string[];
	/** The files that the second run wrote and the first run did not. */
	readonly onlySecond: readonly string[];
	readonly fails: boolean;
}

/**
 * The files that a metafile declares. esbuild writes one key of `outputs` for
 * each file that the build wrote. The check takes every key, and the check
 * passes over no kind of file. A source map is an output file here, because
 * the check asks whether the build repeats itself, and it does not ask what a
 * release carries.
 *
 * The paths come back in sorted order, so that the report names the files in
 * the same order on every run.
 */
export function outputPaths(text: string): Reading<readonly string[]> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { ok: false, reason: `is not JSON: ${reason}` };
	}
	if (!isRecord(parsed)) {
		return { ok: false, reason: 'is not a JSON object' };
	}
	const outputs = parsed.outputs;
	if (!isRecord(outputs)) {
		return { ok: false, reason: 'holds no outputs object' };
	}
	const paths = Object.keys(outputs).sort();
	if (paths.length === 0) {
		return { ok: false, reason: 'declares no output file' };
	}
	return { ok: true, value: paths };
}

/**
 * The place of the first byte that the two files do not share. The answer is
 * absent when the two files hold the same bytes. When one file is the start
 * of the other file, the answer is the count of bytes of the shorter file.
 */
export function firstDifference(
	first: Uint8Array,
	second: Uint8Array,
): number | undefined {
	const shared = Math.min(first.length, second.length);
	for (let index = 0; index < shared; index += 1) {
		if (first[index] !== second[index]) {
			return index;
		}
	}
	return first.length === second.length ? undefined : shared;
}

/**
 * The part of a file that the report shows around one place. The window
 * starts one line before the line that holds the place, and the window holds
 * four lines. The window is empty when the file ends before the place.
 */
export function windowOf(bytes: Uint8Array, offset: number): Window {
	const start = Math.max(0, Math.floor(offset / LINE) * LINE - LINE);
	return { start, bytes: bytes.slice(start, start + WINDOW) };
}

/**
 * What the two runs of the build gave. The comparison reads the bytes of
 * each file that both runs wrote. It also names each file that only one run
 * wrote.
 *
 * Three things make the comparison fail. The first is a file whose bytes are
 * not the same in the two runs. The second is a file that only one run wrote.
 * The third is a pair of runs that wrote no file at all.
 */
export function compare(
	first: readonly Artifact[],
	second: readonly Artifact[],
): Comparison {
	const left = new Map(first.map((artifact) => [artifact.path, artifact]));
	const right = new Map(second.map((artifact) => [artifact.path, artifact]));
	const matches: Match[] = [];
	const differences: Difference[] = [];
	const onlyFirst: string[] = [];
	const onlySecond: string[] = [];
	const paths = [...new Set([...left.keys(), ...right.keys()])].sort();
	for (const path of paths) {
		const one = left.get(path);
		const two = right.get(path);
		if (one === undefined) {
			onlySecond.push(path);
			continue;
		}
		if (two === undefined) {
			onlyFirst.push(path);
			continue;
		}
		const offset = firstDifference(one.bytes, two.bytes);
		if (offset === undefined) {
			matches.push({
				path,
				size: one.bytes.length,
				digest: one.digest,
			});
			continue;
		}
		differences.push({
			path,
			offset,
			firstSize: one.bytes.length,
			secondSize: two.bytes.length,
			firstWindow: windowOf(one.bytes, offset),
			secondWindow: windowOf(two.bytes, offset),
		});
	}
	return {
		matches,
		differences,
		onlyFirst,
		onlySecond,
		fails:
			paths.length === 0 ||
			differences.length > 0 ||
			onlyFirst.length > 0 ||
			onlySecond.length > 0,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
