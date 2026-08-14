import { describe, expect, it } from 'vitest';
import type { TestSpecification, Vitest } from 'vitest/node';
import { SeededSequencer, sortByModuleId } from './sequencer';

function spec(moduleId: string, project = 'root'): TestSpecification {
	return { moduleId, project: { name: project } } as TestSpecification;
}

/** Makes a sequencer whose config holds only the sequence settings. */
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

/** The same files, in several orders that a directory crawl can produce. */
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

describe('the sort before the shuffle', () => {
	it('puts the given files in order of module id', () => {
		expect(ids(sortByModuleId(crawled))).toEqual(canonical);
	});

	it('does not change the array that the caller gives', () => {
		const handed = [...crawled];
		sortByModuleId(handed);
		expect(ids(handed)).toEqual(ids(crawled));
	});

	it('sorts by project name first and by module id second', () => {
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

	// The expected order below looks wrong, but the order is correct. A
	// locale-aware comparator puts these four files in a different order: it
	// puts the capital letters among the lowercase letters and not before
	// them, and it ignores the hyphen instead of ranking the hyphen below
	// every letter. The order below is the order of the UTF-16 code units,
	// and that order does not change with the locale of the machine.
	it('sorts by UTF-16 code unit, and no locale changes the order', () => {
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
	it('gives the same order for one seed, for every crawl order', async () => {
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

	it('gives a different order for a different seed', async () => {
		const atSeven = ids(
			await sequencer({ shuffle: true, seed: 7 }).sort([...crawled]),
		);
		const atEight = ids(
			await sequencer({ shuffle: true, seed: 8 }).sort([...crawled]),
		);
		expect(atSeven).not.toEqual(atEight);
	});

	it('shuffles the files and does not return the sorted order', async () => {
		const shuffled = ids(
			await sequencer({ shuffle: true, seed: 7 }).sort([...crawled]),
		);
		expect(shuffled).not.toEqual(canonical);
		expect([...shuffled].sort()).toEqual(canonical);
	});

	it('returns the sorted order when shuffling is off and no seed is set', async () => {
		const ordered = await sequencer({ shuffle: false }).sort([...crawled]);
		expect(ids(ordered)).toEqual(canonical);
	});

	it('returns the sorted order when shuffling is off and a seed is set', async () => {
		const ordered = await sequencer({ shuffle: false, seed: 7 }).sort([
			...crawled,
		]);
		expect(ids(ordered)).toEqual(canonical);
	});

	it('does not change the array that the caller gives', async () => {
		const handed = [...crawled];
		await sequencer({ shuffle: true, seed: 7 }).sort(handed);
		expect(ids(handed)).toEqual(ids(crawled));
	});
});
