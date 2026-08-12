import { describe, expect, it } from 'vitest';
import type { TestSpecification, Vitest } from 'vitest/node';
import { SeededSequencer, sortByModuleId } from './sequencer';

function spec(moduleId: string, project = 'root'): TestSpecification {
	return { moduleId, project: { name: project } } as TestSpecification;
}

/** A sequencer that knows nothing but the sequencing half of the config. */
function sequencer(sequence: {
	shuffle: boolean;
	seed?: number;
}): SeededSequencer {
	return new SeededSequencer({ config: { sequence } } as unknown as Vitest);
}

const crawled = [
	spec('/repo/test/smoke.test.ts'),
	spec('/repo/test/harness/clock.test.ts'),
	spec('/repo/test/fetch-guards.test.ts'),
	spec('/repo/src/core/model/event.test.ts'),
	spec('/repo/test/harness/sweeps/registry.test.ts'),
	spec('/repo/test/live/credentials.test.ts'),
];

function rotate(
	files: readonly TestSpecification[],
	by: number,
): TestSpecification[] {
	return [...files.slice(by), ...files.slice(0, by)];
}

/** The same files, handed over in orders a crawl could plausibly differ by. */
const crawlOrders: TestSpecification[][] = [
	[...crawled],
	[...crawled].reverse(),
	rotate(crawled, 2),
	rotate(crawled, 4).reverse(),
];

function ids(files: readonly TestSpecification[]): string[] {
	return files.map((file) => file.moduleId);
}

const canonical = [
	'/repo/src/core/model/event.test.ts',
	'/repo/test/fetch-guards.test.ts',
	'/repo/test/harness/clock.test.ts',
	'/repo/test/harness/sweeps/registry.test.ts',
	'/repo/test/live/credentials.test.ts',
	'/repo/test/smoke.test.ts',
];

describe('the canonical order', () => {
	it('orders the files it is handed by module id', () => {
		expect(ids(sortByModuleId(crawled))).toEqual(canonical);
	});

	it('leaves the array it was handed alone', () => {
		const handed = [...crawled];
		sortByModuleId(handed);
		expect(ids(handed)).toEqual(ids(crawled));
	});

	it('orders by project name before module id', () => {
		const mixed = [
			spec('/repo/a.test.ts', 'second'),
			spec('/repo/z.test.ts', 'first'),
			spec('/repo/b.test.ts', 'second'),
		];
		expect(
			sortByModuleId(mixed).map(
				(file) => `${file.project.name}:${file.moduleId}`,
			),
		).toEqual([
			'first:/repo/z.test.ts',
			'second:/repo/a.test.ts',
			'second:/repo/b.test.ts',
		]);
	});

	// A collating comparator puts these four in a different order: it sorts
	// capitals among the lowercase letters rather than ahead of them, and
	// looks past the hyphen instead of ranking it below every letter. The
	// order below is the code-unit one, which is the same under every locale
	// a run might pick up.
	it('orders by code unit, out of reach of the ambient locale', () => {
		const collated = [
			spec('/repo/test/feedback.test.ts'),
			spec('/repo/test/Feed.test.ts'),
			spec('/repo/test/feed-fixture/x.test.ts'),
			spec('/repo/test/feed.test.ts'),
		];
		expect(ids(sortByModuleId(collated))).toEqual([
			'/repo/test/Feed.test.ts',
			'/repo/test/feed-fixture/x.test.ts',
			'/repo/test/feed.test.ts',
			'/repo/test/feedback.test.ts',
		]);
	});
});

describe('the file sequencer', () => {
	it('gives one seed one order however the crawl returned the files', async () => {
		const orders = await Promise.all(
			crawlOrders.map(async (files) =>
				ids(
					await sequencer({ shuffle: true, seed: 7 }).sort([
						...files,
					]),
				),
			),
		);

		expect(new Set(orders.map((order) => order.join('|'))).size).toBe(1);
	});

	it('gives two seeds two orders', async () => {
		const atSeven = ids(
			await sequencer({ shuffle: true, seed: 7 }).sort([...crawled]),
		);
		const atEight = ids(
			await sequencer({ shuffle: true, seed: 8 }).sort([...crawled]),
		);
		expect(atSeven).not.toEqual(atEight);
	});

	it('shuffles, rather than handing back the order it sorted', async () => {
		const shuffled = ids(
			await sequencer({ shuffle: true, seed: 7 }).sort([...crawled]),
		);
		expect(shuffled).not.toEqual(canonical);
		expect([...shuffled].sort()).toEqual(canonical);
	});

	it('hands back the sorted order when shuffling is off', async () => {
		const ordered = await sequencer({ shuffle: false }).sort([...crawled]);
		expect(ids(ordered)).toEqual(canonical);
	});

	it('stays on the sorted order with shuffling off and a seed given', async () => {
		const ordered = await sequencer({ shuffle: false, seed: 7 }).sort([
			...crawled,
		]);
		expect(ids(ordered)).toEqual(canonical);
	});

	it('leaves the array it was handed alone', async () => {
		const handed = [...crawled];
		await sequencer({ shuffle: true, seed: 7 }).sort(handed);
		expect(ids(handed)).toEqual(ids(crawled));
	});
});
