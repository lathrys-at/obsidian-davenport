/**
 * The note corpus, embedded when the probe is built.
 *
 * A plugin bundle has no way to read the repository's fixture files once it
 * is running in a vault, so the build reads them and generates this module
 * in place. `build.mjs` holds that half; this is the shape it produces.
 */
declare module 'probe-corpus' {
	export interface ProbeFixture {
		/** The fixture's name, without the extension. */
		readonly id: string;
		readonly fileName: string;
		/** The note's text, exactly as the fixture file holds it. */
		readonly content: string;
	}

	export const PROBE_CORPUS: readonly ProbeFixture[];
}
