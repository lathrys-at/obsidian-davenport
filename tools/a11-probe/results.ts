/**
 * The results file. This module gives the shape of the file, the name of
 * the file, and the way a thrown value becomes text in the file.
 *
 * The probe writes this shape, and the comparison script reads this
 * shape. Both sides take their types from this module. If the two sides
 * drift apart, the type check reports the difference. This module calls
 * no platform API. Therefore a test can check the file names and the
 * error wording directly.
 */

/** The one folder in a vault that the probe writes into. */
export const PROBE_FOLDER = 'frontmatter-probe';

/**
 * The pattern that reads the name of a results file back. The pattern
 * finds the date, the time, and the counter that a second run in the same
 * second uses. The function `resultsPath` below writes these names. A
 * test sends a written name back through this pattern, and thus the
 * pattern and the function stay together.
 */
export const RESULTS_NAME =
	/^emission-samples-(\d{8})-(\d{6})Z(?:-\d+)?\.json$/;

/** What one environment emitted for each fixture in the corpus. */
export interface ProbeResults {
	readonly kind: 'frontmatter-emission-samples';
	/** The time when the run finished, as an ISO 8601 instant. */
	readonly timestamp: string;
	/**
	 * The version of Obsidian that the run used. The value is `unknown`
	 * when the app gives no version.
	 */
	readonly obsidianVersion: string;
	/** The version of the plugin API that the run used. */
	readonly apiVersion: string;
	readonly platform: ProbePlatform;
	/** The change that the probe made to every fixture. */
	readonly marker: ProbeMarker;
	readonly perFixture: readonly FixtureResult[];
}

/** The device that the run used, in the terms that the app reports. */
export interface ProbePlatform {
	readonly isDesktop: boolean;
	readonly isMobile: boolean;
	readonly isIosApp: boolean;
	readonly isAndroidApp: boolean;
	readonly isMacOS: boolean;
	readonly isWin: boolean;
	readonly isLinux: boolean;
	/**
	 * The user agent string of the browser engine. This string carries
	 * the operating system and the build of the app.
	 */
	readonly userAgent: string;
}

/**
 * The frontmatter key and the frontmatter value that the probe writes
 * into every fixture. The key and the value stay the same for every
 * fixture, every run, and every device. The input must be the same
 * everywhere, because only then does output that differs have a meaning.
 */
export interface ProbeMarker {
	readonly key: string;
	readonly value: string;
}

/**
 * How the wait ended. Before the writer runs, the probe waits for the app
 * to read the note back. The value `event` means that the app reported
 * the note. The value `timeout` means that the wait used all of its time.
 * After a timeout, the view that the app held of the note was possibly
 * still stale. The bytes that the probe recorded after a timeout are a
 * reason to distrust the record, and not a reason to discard the record.
 */
export type MetadataSettling = 'event' | 'timeout';

export type FixtureResult = FixtureEmission | FixtureFailure;

/** A fixture that the writer accepted, and that the probe read back. */
export interface FixtureEmission {
	readonly id: string;
	/**
	 * The SHA-256 hash of the fixture text, as the build embedded the
	 * text.
	 */
	readonly inputHash: string;
	/** How the wait ended. The wait came before the writer. */
	readonly settledBy: MetadataSettling;
	/** The bytes that the file held after the writer ran, in base64. */
	readonly outputBase64: string;
	/** The SHA-256 hash of those same bytes. */
	readonly outputHash: string;
}

/**
 * A fixture that the writer refused. The probe records the refusal and
 * continues the run.
 */
export interface FixtureFailure {
	readonly id: string;
	readonly inputHash: string;
	readonly error: string;
}

/**
 * How many names a run tries before the run stops the search for a name
 * that no other run took.
 */
export const NAME_ATTEMPTS = 50;

/** True when the record of this fixture carries emitted bytes. */
export function isEmission(result: FixtureResult): result is FixtureEmission {
	return 'outputBase64' in result;
}

/**
 * The path where a run that started at this instant writes its results.
 * The function steps past each name that another run already took.
 * Thus a second run in the same second cannot overwrite the file of the
 * first run. The pattern `RESULTS_NAME` above reads these names back.
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
 * A thrown value as text that a notice can show. The function keeps an
 * error name that tells the reader something: the name of a parser tells
 * which parser refused the fixture. The function drops the bare name
 * `Error`, because that name adds nothing in front of its own message on
 * a phone screen.
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
