/**
 * The file sequencer. Vitest hands the sequencer its test files in the order
 * the directory crawl returned them, and that order is not the same twice, so
 * a seeded shuffle laid straight over it yields a different order each run
 * and the printed seed reproduces nothing. Sorting the files first gives the
 * shuffle the same input every run, which is what makes the seed a replay:
 * the same seed puts the same files in the same order on any machine.
 *
 * Test order inside a file is Vitest's own shuffle over declaration order,
 * which is already stable, and it takes the same seed.
 */

import { shuffle } from '@vitest/utils/helpers';
import { BaseSequencer } from 'vitest/node';
import type { TestSpecification } from 'vitest/node';

/**
 * The starting order the shuffle permutes: project name first, then module
 * id, compared as UTF-16 code units so no locale reaches the result. Both
 * keys are there to make the starting order well defined rather than to keep
 * a project's files adjacent — the shuffle that follows interleaves projects
 * freely, which is where this parts company with Vitest's own sequencer, and
 * a second project would run interleaved with the first.
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
	 * Shuffles the sorted files under the run's seed. With shuffling turned
	 * off the sorted order is the answer: Vitest draws a seed only when it is
	 * shuffling something, so shuffling here regardless would randomize the
	 * order from the wall clock and report no seed for it, leaving a run that
	 * asked for a fixed order with neither one nor a way back to the order it
	 * got.
	 */
	override sort(files: TestSpecification[]): Promise<TestSpecification[]> {
		const canonical = sortByModuleId(files);
		const { shuffle: shuffling, seed } = this.ctx.config.sequence;
		return Promise.resolve(
			shuffling ? shuffle(canonical, seed) : canonical,
		);
	}
}
