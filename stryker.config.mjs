/**
 * The configuration of mutation testing. StrykerJS makes a small change to
 * the source, runs the tests, and asks whether a test fails. A mutant is one
 * such change. A test that fails kills the mutant. A mutant survives when
 * every test passes. A mutant that survives marks source that the tests run
 * and do not check.
 *
 * A person runs this tool by hand to find the gaps in the tests. No workflow
 * runs the tool, no check reads its report, and no merge waits for a run. A
 * run takes far longer than the test suite.
 *
 *     npm run mutation
 *
 * The `reports` directory and the `.stryker-tmp` directory hold the output of
 * a run. Git ignores both directories.
 */
export default {
	packageManager: 'npm',
	testRunner: 'vitest',

	// The tool mutates the source files, and it mutates no test file. A case
	// in `test/stryker-config.test.ts` compares this list against the files
	// that the coverage instrument reads. This list is the `include` list of
	// that instrument, with the test files taken back out. A file outside the
	// coverage selection has no floor for its lines, and a file outside this
	// list gets no mutants at all.
	mutate: ['src/**/*.ts', '!src/**/*.test.ts'],

	// A person needs the HTML report. The two text reporters put the score
	// and the progress in the log of the run. The JSON report holds the same
	// data as the HTML report, in the form that a program reads.
	reporters: ['clear-text', 'progress', 'html', 'json'],
	htmlReporter: { fileName: 'reports/mutation/mutation.html' },
	jsonReporter: { fileName: 'reports/mutation/mutation.json' },

	// A run must give the same score for the same commit. A score that moves
	// for another reason says nothing about the tests. Therefore the run
	// keeps no state between two runs, and each run tests every mutant again.
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
