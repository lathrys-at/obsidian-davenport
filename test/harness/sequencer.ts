/**
 * The file sequencer. It decides the order in which the run executes the
 * test files.
 *
 * Vitest gives the sequencer the test files in the order in which the
 * directory crawl found them. This crawl order is not the same on two runs.
 * A seeded shuffle over the crawl order therefore gives a different order on
 * each run, and the seed that the run prints cannot repeat that order. The
 * sequencer sorts the files before the shuffle. The shuffle then gets the
 * same input on every run, and the seed is enough to repeat a run: one seed
 * puts the same files in the same order on every machine.
 *
 * The order of the tests inside one file is a separate shuffle. Vitest does
 * that shuffle itself, over the order in which the file declares the tests.
 * That declaration order is already stable, and the shuffle inside a file
 * uses the same seed.
 */

import { shuffle } from '@vitest/utils/helpers';
import { BaseSequencer } from 'vitest/node';
import type { TestSpecification } from 'vitest/node';

/**
 * Returns the files in sorted order. The shuffle starts from this order. The
 * sort compares the project name first, then the module id. Both comparisons
 * use UTF-16 code units, so the locale of the machine does not change the
 * result.
 *
 * The two sort keys are there to make the sorted order well defined, and not
 * to keep the files of one project together. The shuffle that follows mixes
 * the projects freely, so the files of a second project would run mixed in
 * with the files of the first. This free mixing is the difference between
 * this sequencer and the sequencer that Vitest supplies.
 */
export function sortByModuleId(
	files: readonly TestSpecification[],
): TestSpecification[] {
	return [...files].sort((a, b) => {
		if (a.project.name !== b.project.name) {
			return a.project.name < b.project.name ? -1 : 1;
		}
		if (a.moduleId === b.moduleId) return 0;
		return a.moduleId < b.moduleId ? -1 : 1;
	});
}

export class SeededSequencer extends BaseSequencer {
	/**
	 * Returns the sorted files, shuffled under the seed of the run. When the
	 * run turns shuffling off, this method returns the sorted order without a
	 * shuffle.
	 *
	 * The check on the shuffle flag is necessary. Vitest draws a seed only
	 * when it shuffles something. Without the check, the shuffle takes its
	 * randomness from the wall clock, and the run reports no seed for the
	 * order that comes out. A run that asked for a fixed order then gets two
	 * problems: the order is not fixed, and no seed can bring that order
	 * back.
	 */
	override sort(files: TestSpecification[]): Promise<TestSpecification[]> {
		const canonical = sortByModuleId(files);
		const { shuffle: shuffling, seed } = this.ctx.config.sequence;
		return Promise.resolve(
			shuffling ? shuffle(canonical, seed) : canonical,
		);
	}
}
