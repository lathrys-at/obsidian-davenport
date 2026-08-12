/**
 * The file sequencer for shuffled runs. Vitest hands the sequencer its test
 * files in the order the directory crawl returned them, and that order is not
 * the same twice, so a seeded shuffle laid straight over it yields a
 * different order each run and the printed seed reproduces nothing. Sorting
 * by project and module id first gives the shuffle the same input every run,
 * which is what makes the seed a replay: the same seed puts the same files in
 * the same order on any machine.
 *
 * Test order inside a file is Vitest's own shuffle over declaration order,
 * which is already stable, and it takes the same seed.
 */

import { shuffle } from '@vitest/utils/helpers';
import { BaseSequencer } from 'vitest/node';
import type { TestSpecification } from 'vitest/node';

/** Orders test files by seeded shuffle over a canonical starting order. */
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
	override sort(files: TestSpecification[]): Promise<TestSpecification[]> {
		return Promise.resolve(
			shuffle(sortByModuleId(files), this.ctx.config.sequence.seed),
		);
	}
}
