/**
 * The shape of a results file: everything one environment emitted for the
 * whole corpus, written into the vault as JSON.
 *
 * The probe writes this shape and the comparison script reads it, so both
 * sides are typed from here and neither can drift from the other without
 * the type check saying so.
 */

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

export type FixtureResult = FixtureEmission | FixtureFailure;

/** A fixture that went through the writer and came back out. */
export interface FixtureEmission {
	readonly id: string;
	/** SHA-256 of the fixture's text as the build embedded it. */
	readonly inputHash: string;
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

/** Whether this fixture's record carries emitted bytes. */
export function isEmission(result: FixtureResult): result is FixtureEmission {
	return 'outputBase64' in result;
}
