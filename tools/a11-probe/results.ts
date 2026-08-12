/**
 * The results file: its shape, the name it takes, and how a thrown value
 * is written into it.
 *
 * The probe writes this shape and the comparison script reads it, so both
 * sides are typed from here and neither can drift from the other without
 * the type check saying so. Nothing in this module touches a platform,
 * which is what lets the naming and the wording be tested directly.
 */

/** The one folder in a vault the probe writes into. */
export const PROBE_FOLDER = 'frontmatter-probe';

/**
 * A results file's name read back: the date, the time, and the counter a
 * second run in the same second takes. This is the reading half of what
 * `resultsPath` below writes, and the two are pinned to each other by a
 * test that runs a written name back through this pattern.
 */
export const RESULTS_NAME =
	/^emission-samples-(\d{8})-(\d{6})Z(?:-\d+)?\.json$/;

/** What one environment emitted, for every fixture in the corpus. */
export interface ProbeResults {
	readonly kind: 'frontmatter-emission-samples';
	/** When the run finished, as an ISO 8601 instant. */
	readonly timestamp: string;
	/** The Obsidian version the run happened on, or `unknown`. */
	readonly obsidianVersion: string;
	/** The plugin API version the run happened on. */
	readonly apiVersion: string;
	readonly platform: ProbePlatform;
	/** The mutation every fixture was put through. */
	readonly marker: ProbeMarker;
	readonly perFixture: readonly FixtureResult[];
}

/** Which device the run happened on, in the terms the app reports. */
export interface ProbePlatform {
	readonly isDesktop: boolean;
	readonly isMobile: boolean;
	readonly isIosApp: boolean;
	readonly isAndroidApp: boolean;
	readonly isMacOS: boolean;
	readonly isWin: boolean;
	readonly isLinux: boolean;
	/** The engine string, which carries the OS and the app build. */
	readonly userAgent: string;
}

/**
 * The frontmatter key and value written into every fixture. Fixed across
 * fixtures, runs, and devices: identical input everywhere is what makes
 * differing output mean something.
 */
export interface ProbeMarker {
	readonly key: string;
	readonly value: string;
}

/**
 * How the wait for the app to read the note back ended before the writer
 * ran. An emission that waited the whole timeout out was written with the
 * app's view of the note possibly still stale, which is a reason to
 * distrust it rather than a reason to throw it away.
 */
export type MetadataSettling = 'event' | 'timeout';

export type FixtureResult = FixtureEmission | FixtureFailure;

/** A fixture that went through the writer and came back out. */
export interface FixtureEmission {
	readonly id: string;
	/** SHA-256 of the fixture's text as the build embedded it. */
	readonly inputHash: string;
	/** How the wait before the writer ran ended. */
	readonly settledBy: MetadataSettling;
	/** The bytes the file held afterwards, base64-encoded. */
	readonly outputBase64: string;
	/** SHA-256 of those same bytes. */
	readonly outputHash: string;
}

/** A fixture the writer refused, recorded rather than aborting the run. */
export interface FixtureFailure {
	readonly id: string;
	readonly inputHash: string;
	readonly error: string;
}

/** How many names a run tries before giving up on an unused one. */
export const NAME_ATTEMPTS = 50;

/** Whether this fixture's record carries emitted bytes. */
export function isEmission(result: FixtureResult): result is FixtureEmission {
	return 'outputBase64' in result;
}

/**
 * The path a run started at this instant writes its results to, skipping
 * names another run has taken so that a second run in the same second
 * cannot overwrite the first. `RESULTS_NAME` above reads these back.
 */
export function resultsPath(
	folder: string,
	now: Date,
	taken: (path: string) => boolean,
): string {
	const stamp = now
		.toISOString()
		.slice(0, 19)
		.replace(/[-:]/g, '')
		.replace('T', '-');
	for (let attempt = 1; attempt <= NAME_ATTEMPTS; attempt += 1) {
		const suffix = attempt === 1 ? '' : `-${String(attempt)}`;
		const path = `${folder}/emission-samples-${stamp}Z${suffix}.json`;
		if (!taken(path)) {
			return path;
		}
	}
	throw new Error(`${folder} already holds every name this run tried`);
}

/**
 * A thrown value, said in a way a notice can carry. A name worth reading
 * is kept — a parser says which parser refused — but the bare word Error
 * in front of its own message is noise on a phone screen.
 */
export function describeError(error: unknown): string {
	if (error instanceof Error) {
		if (error.message === '') {
			return error.name;
		}
		return error.name === 'Error'
			? error.message
			: `${error.name}: ${error.message}`;
	}
	if (typeof error === 'string') {
		return error;
	}
	return `a thrown ${typeof error}`;
}
