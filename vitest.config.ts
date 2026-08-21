import { coverageConfigDefaults, defineConfig } from 'vitest/config';
import { SeededSequencer } from './test/harness/sequencer';

export default defineConfig({
	test: {
		environment: 'node',
		unstubGlobals: true,
		include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
		setupFiles: ['./test/harness/sweeps/setup.ts'],
		// Files and the tests inside them run in a random order, so a test
		// that passes only on state a neighbour left behind fails here rather
		// than the day an unrelated change reorders the suite. Vitest picks a
		// seed per run and prints it in the banner; passing that seed back
		// replays the order exactly, which is what the sequencer is for.
		// Property-test inputs are not covered by this seed: the constant in
		// test/harness/arbitraries/seed.ts fixes those, and the variable
		// DAVENPORT_PROPERTY_SEED overrides the constant.
		sequence: {
			sequencer: SeededSequencer,
			shuffle: true,
		},
		coverage: {
			provider: 'v8',
			// The json-summary reporter writes the counts of each file.
			// scripts/coverage-ratchet.mjs reads those counts and compares
			// them against the floors in coverage-baseline.json.
			reporter: ['text', 'lcov', 'json-summary'],
			include: ['src/**/*.ts'],
			exclude: [...coverageConfigDefaults.exclude, 'src/**/*.test.ts'],
		},
	},
});
