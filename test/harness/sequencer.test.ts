import { shuffle } from '@vitest/utils/helpers';
import { describe, expect, it } from 'vitest';
import type { TestSpecification } from 'vitest/node';
import { sortByModuleId } from './sequencer';

function spec(moduleId: string, project = 'root'): TestSpecification {
	return { moduleId, project: { name: project } } as TestSpecification;
}

const crawled = [
	spec('/repo/test/smoke.test.ts'),
	spec('/repo/test/harness/clock.test.ts'),
	spec('/repo/test/fetch-guards.test.ts'),
	spec('/repo/src/core/model/event.test.ts'),
];

function ids(files: readonly TestSpecification[]): string[] {
	return files.map((file) => file.moduleId);
}

describe('the file sequencer', () => {
	it('orders the files it is handed by module id', () => {
		expect(ids(sortByModuleId(crawled))).toEqual([
			'/repo/src/core/model/event.test.ts',
			'/repo/test/fetch-guards.test.ts',
			'/repo/test/harness/clock.test.ts',
			'/repo/test/smoke.test.ts',
		]);
	});

	it('leaves the array it was handed alone', () => {
		const handed = [...crawled];
		sortByModuleId(handed);
		expect(ids(handed)).toEqual(ids(crawled));
	});

	it('groups projects before module ids, so a project stays together', () => {
		const mixed = [
			spec('/repo/a.test.ts', 'second'),
			spec('/repo/z.test.ts', 'first'),
			spec('/repo/b.test.ts', 'second'),
		];
		expect(sortByModuleId(mixed).map((file) => file.project.name)).toEqual([
			'first',
			'second',
			'second',
		]);
	});

	it('gives one seed one order however the crawl returned the files', () => {
		const orders = [
			crawled,
			[...crawled].reverse(),
			[
				crawled[1],
				crawled[3],
				crawled[0],
				crawled[2],
			] as TestSpecification[],
		].map((files) => ids(shuffle(sortByModuleId(files), 7)));

		expect(new Set(orders.map((order) => order.join('|'))).size).toBe(1);
	});

	it('gives two seeds two orders', () => {
		expect(ids(shuffle(sortByModuleId(crawled), 7))).not.toEqual(
			ids(shuffle(sortByModuleId(crawled), 8)),
		);
	});
});
