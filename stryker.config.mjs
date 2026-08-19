/**
 * The configuration of the mutation lane. StrykerJS makes a small change to
 * the source, runs the tests, and asks whether a test fails. A mutant is one
 * such change. A test that fails kills the mutant. A mutant survives when
 * every test passes. A mutant that survives marks source that the tests run
 * and do not check.
 *
 * The lane runs on a schedule, and it runs on request. The lane is not part
 * of the required check of a pull request. A run takes far longer than the
 * test suite.
 *
 * `scripts/mutation-ratchet.mjs` reads the JSON report of the run. The check
 * compares the score of the run against the floor in `mutation-baseline.json`.
 *
 *     npm run mutation
 *     node scripts/mutation-ratchet.mjs
 *
 * The `reports` directory and the `.stryker-tmp` directory hold the output of
 * a run. Git ignores both directories.
 */
import { MUTATED } from './scripts/mutation-ratchet-core.ts';

export default {
	packageManager: 'npm',
	testRunner: 'vitest',

	// The lane mutates the source files, and it mutates no test file. A test
	// of the check compares this selection against the files that the
	// coverage instrument reads.
	mutate: [...MUTATED],

	// The check needs the JSON report. A person needs the HTML report. The
	// two text reporters put the score and the progress in the log of the
	// run.
	reporters: ['clear-text', 'progress', 'html', 'json'],
	htmlReporter: { fileName: 'reports/mutation/mutation.html' },
	jsonReporter: { fileName: 'reports/mutation/mutation.json' },

	// A run must give the same score for the same commit. The floor has no
	// meaning if the score moves for another reason. Therefore the run keeps
	// no state between two runs, and each run tests every mutant again.
	incremental: false,

	// Stryker measures which test runs which line, and it then runs only the
	// tests that reach the mutant. A test that does not reach the mutant
	// cannot fail because of the mutant.
	coverageAnalysis: 'perTest',

	// Vitest runs only the test files that import the mutated file, through
	// the module graph. This option holds the default of the runner. The
	// option is written out because it explains the count of tests in the log.
	vitest: { related: true },

	// Stryker copies the repository into this directory, and it makes each
	// mutant in the copy. The working tree keeps the source that a person
	// wrote.
	tempDirName: '.stryker-tmp',

	// Stryker copies each file of the repository into the sandbox, and
	// Stryker does not read .gitignore. These patterns hold what a build
	// writes, the vaults that the QA script makes, the configuration of the
	// agents, and the credentials of a live run. No test reads one of these
	// files. A local run without these patterns copies many megabytes.
	ignorePatterns: [
		'.claude',
		'.vaults',
		'coverage',
		'reports',
		'main.js',
		'bundle-meta.json',
		'tools/*/dist',
		'.env',
		'.env.*',
		'!.env.example',
	],
};
