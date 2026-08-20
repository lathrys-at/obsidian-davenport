/**
 * The guard on the configuration of the mutation tool.
 *
 * A person runs `npm run mutation` by hand. No workflow runs the tool, and no
 * check reads its report. Therefore nothing else in this repository loads
 * `stryker.config.mjs`: ESLint ignores the file, and the TypeScript project
 * does not hold it. A configuration that does not load would stay invisible
 * until the next run by hand. This case loads the file and reads the
 * selection out of it.
 *
 * The case reads the configuration the way Stryker reads it. Node imports
 * the file and prints the value of `mutate`. A comparison of the text of the
 * file would instead pin the shape of the source, and the formatter moves
 * that shape.
 *
 * The selection must name the files that the coverage instrument reads. A
 * file outside the coverage selection has no floor for its lines, and a file
 * outside the mutation selection gets no mutants at all. A test file belongs
 * to neither selection.
 */

import { describe, expect, it } from 'vitest';
import vitestConfig from '../vitest.config';
import { runNode } from './harness/run-node';

describe('the files that the mutation tool mutates', () => {
	it('gives Stryker the files that the coverage instrument reads', () => {
		const covered = vitestConfig.test?.coverage?.include;
		const skipped = vitestConfig.test?.coverage?.exclude ?? [];
		expect(covered).toStrictEqual(['src/**/*.ts']);
		expect(skipped).toContain('src/**/*.test.ts');

		const url = new URL('../stryker.config.mjs', import.meta.url).href;
		const result = runNode([
			'--input-type=module',
			'-e',
			`import config from ${JSON.stringify(url)};
				process.stdout.write(JSON.stringify(config.mutate));`,
		]);
		expect(result.stderr).toBe('');
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout) as unknown).toStrictEqual([
			...(covered ?? []),
			...['src/**/*.test.ts'].map((pattern) => `!${pattern}`),
		]);
	});
});
