/**
 * The decisions behind the plan-ID traceability check:
 *
 * - which IDs the check reads out of the test plan;
 * - which words in a title are IDs, and which words only look like IDs;
 * - which titles the check reads out of a suite file;
 * - what the comparison of the two sets says;
 * - the wording that the check prints around all of that.
 *
 * The grammar tests run against the real plan, and not against a copy of it.
 * A copy would drift, and then the tests would prove the copy. The control is
 * two-sided: the check catches an ID that nobody defined, and the check
 * passes over a technical word of the same shape.
 *
 * The script itself only finds the files and reads them. A run can end in two
 * ways, and these tests exercise both ways as a process. The interface
 * includes the exit status, and not only the words that the run prints.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type {
	Reconciliation,
	SuiteFile,
	SuiteScan,
} from '../scripts/plan-ids-core';
import {
	citedIds,
	readPlan,
	readSuites,
	reconcile,
} from '../scripts/plan-ids-core';
import { failureLines, reportLines } from '../scripts/plan-ids-text';
import { readTitles } from '../scripts/plan-ids-titles';

const PLAN_PATH = fileURLToPath(
	new URL('../docs/davenport-test-plan.md', import.meta.url),
);
const SCRIPT = fileURLToPath(
	new URL('../scripts/plan-ids.mjs', import.meta.url),
);

const PLAN = readPlan(readFileSync(PLAN_PATH, 'utf8'));

/** A plan of two suites and one sweep, in the shape of the real plan. */
const SMALL = readPlan(
	[
		'## Part 4 — Invariant sweeps',
		'',
		'- **XV-1 A standing assertion.** It runs everywhere.',
		'',
		'## Part 5 — Suites',
		'',
		'### 5.1 First suite [QQ] — §1.1',
		'',
		'- **QQ-1 [D]** The first item.',
		'- **QQ-2 [E]** The second item.',
		'',
		'### 5.2 Second suite [ZQ] — §1.2',
		'',
		'- **ZQ-1** The item with no shape tag.',
		'',
		'### 6.1 A protocol [V]',
		'',
		'- **B-1** — The first protocol item. **B-2** The second one.',
	].join('\n'),
);

/** The result of the whole comparison over one file of source. */
function run(source: string): {
	found: SuiteScan;
	result: Reconciliation;
} {
	const files: SuiteFile[] = [
		{ path: 'test/suites/example.test.ts', text: source },
	];
	const found = readSuites(files, PLAN);
	return { found, result: reconcile(PLAN, found) };
}

describe('the IDs that the plan contains', () => {
	it('takes the suite tags from the headings of the suites part', () => {
		expect(SMALL.suitePrefixes).toEqual(['QQ', 'ZQ']);
	});

	it('takes an ID from every bold span, with a shape tag or without one', () => {
		expect(SMALL.ids).toEqual([
			'XV-1',
			'QQ-1',
			'QQ-2',
			'ZQ-1',
			'B-1',
			'B-2',
		]);
	});

	it('separates the test IDs from the sweeps and the protocol items', () => {
		expect(SMALL.suiteIds).toEqual(['QQ-1', 'QQ-2', 'ZQ-1']);
	});

	it('sorts the longest prefix first, so a short one takes no match', () => {
		expect(SMALL.prefixes).toEqual(['QQ', 'XV', 'ZQ', 'B']);
	});

	it('names a suite that declares a tag and defines no ID', () => {
		const corpus = readPlan('### 5.9 Empty suite [EE] — §9');
		expect(corpus.emptySuites).toEqual(['EE']);
		expect(PLAN.emptySuites).toEqual([]);
	});

	it('reads the whole corpus of the real plan', () => {
		expect(PLAN.suitePrefixes).toHaveLength(26);
		expect(PLAN.ids).toHaveLength(266);
		expect(PLAN.suiteIds).toHaveLength(227);
	});

	it('holds the sweeps and the protocol items outside the test IDs', () => {
		const others = PLAN.ids.filter((id) => !PLAN.suiteIds.includes(id));
		expect(others).toContain('IV-1');
		expect(others).toContain('A-11');
		expect(others).toHaveLength(39);
	});

	it('numbers every suite from one, with no gap and no repeat', () => {
		const counts = new Map<string, number>();
		for (const id of PLAN.suiteIds) {
			const prefix = id.slice(0, id.indexOf('-'));
			counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
		}
		for (const [prefix, total] of counts) {
			const wanted = Array.from(
				{ length: total },
				(_unused, index) => `${prefix}-${String(index + 1)}`,
			);
			expect(
				PLAN.suiteIds.filter((id) => id.startsWith(`${prefix}-`)),
			).toEqual(wanted);
		}
	});
});

describe('the words in a title that are IDs', () => {
	it('takes an ID that stands alone', () => {
		expect(citedIds('FM-2 rejects both keys', PLAN.prefixes)).toEqual([
			'FM-2',
		]);
	});

	it('takes every ID of a title, in the order of the title', () => {
		expect(citedIds('TS-6 and TS-7 share a setup', PLAN.prefixes)).toEqual([
			'TS-6',
			'TS-7',
		]);
	});

	it('takes the ID and not the qualifier that follows it', () => {
		expect(
			citedIds(
				'AD-3 (the materialization-map half) applies',
				PLAN.prefixes,
			),
		).toEqual(['AD-3']);
	});

	it('takes an ID that a sweep or a protocol item owns', () => {
		expect(citedIds('PM-2 is the IV-3 anchor', PLAN.prefixes)).toEqual([
			'PM-2',
			'IV-3',
		]);
		expect(citedIds('the fake stands for A-11', PLAN.prefixes)).toEqual([
			'A-11',
		]);
	});

	it('takes an ID that the plan does not contain', () => {
		expect(citedIds('FM-99 does not exist', PLAN.prefixes)).toEqual([
			'FM-99',
		]);
	});

	// The two sides of the control. The first side is an ID that nobody
	// defined, and the check catches it. The second side is the technical
	// words of the same shape, and the check passes over every one of them.
	it.each([
		'UTF-8',
		'SHA-256',
		'ISO-8601',
		'RFC-5545',
		'RFC-6578',
		'RFC-8607',
		'HTTP/1.1',
		'base64',
		'X-ALT-DESC',
		'PARTSTAT=NEEDS-ACTION',
		'If-None-Match',
	])('reads no ID out of %s', (word) => {
		expect(
			citedIds(`the test writes ${word} and stops`, PLAN.prefixes),
		).toEqual([]);
	});

	it('reads no ID out of a prefix that the plan never defines', () => {
		expect(citedIds('ZZ-1 and QQ-4 mean nothing', PLAN.prefixes)).toEqual(
			[],
		);
	});

	it('reads no ID out of a longer word that ends in one', () => {
		expect(citedIds('XFM-2 and NOTS-1 are words', PLAN.prefixes)).toEqual(
			[],
		);
	});

	// A longer number and a padded number are each their own ID. The plan
	// contains neither one, and the check therefore reports the title. A
	// mistyped ID fails loudly, and it never passes as the ID beside it.
	it('reads a longer number as its own ID', () => {
		expect(citedIds('FM-20 is not FM-2', PLAN.prefixes)).toEqual([
			'FM-20',
			'FM-2',
		]);
		expect(citedIds('A-260 is not A-26', PLAN.prefixes)).toEqual([
			'A-260',
			'A-26',
		]);
	});

	it('reads a number with a leading zero as its own ID', () => {
		expect(citedIds('FM-02 is not FM-2', PLAN.prefixes)).toEqual([
			'FM-02',
			'FM-2',
		]);
		const { result } = run("it('FM-02 pads the number', () => {});");
		expect(result.unknown.map((citation) => citation.id)).toEqual([
			'FM-02',
		]);
	});

	it('reads nothing when the plan gives no prefix', () => {
		expect(citedIds('FM-2 stands alone', [])).toEqual([]);
	});
});

describe('the titles that a suite file declares', () => {
	it('takes the title of a call to describe, to it, and to test', () => {
		const found = readTitles(
			[
				"describe('the group', () => {",
				"\tit('the first case', () => {});",
				'\ttest("the second case", () => {});',
				'});',
			].join('\n'),
		);
		expect(found.titles).toEqual([
			{ line: 1, title: 'the group' },
			{ line: 2, title: 'the first case' },
			{ line: 3, title: 'the second case' },
		]);
		expect(found.unreadable).toBe(0);
	});

	it('takes the title of a call that a table of rows curries', () => {
		const found = readTitles(
			[
				"describe.each([['a'], ['b']])('the group %s', () => {",
				"\tit.each(rows())('the case %s', () => {});",
				"\tit.skip('the skipped case', () => {});",
				'});',
			].join('\n'),
		);
		expect(found.titles.map((site) => site.title)).toEqual([
			'the group %s',
			'the case %s',
			'the skipped case',
		]);
		expect(found.unreadable).toBe(0);
	});

	it('takes a title that a template string spells', () => {
		const found = readTitles('it(`the case ${name} makes`, () => {});');
		expect(found.titles).toEqual([
			{ line: 1, title: 'the case ${name} makes' },
		]);
	});

	it('counts a title that is not text, and reads no ID from it', () => {
		const found = readTitles('it(titleFor(item), () => {});');
		expect(found.titles).toEqual([]);
		expect(found.unreadable).toBe(1);
	});

	it('passes over a name that no call follows', () => {
		const found = readTitles('const it = 1;\nconst test = describe;\n');
		expect(found.titles).toEqual([]);
		expect(found.unreadable).toBe(0);
	});

	it('passes over a call on an object', () => {
		const found = readTitles("expect(pattern.test('FM-2')).toBe(true);");
		expect(found.titles).toEqual([]);
		expect(found.unreadable).toBe(0);
	});

	it('passes over a comment and over text in quotes', () => {
		const found = readTitles(
			[
				"// it('a comment case', () => {});",
				"/* it('a block comment case', () => {}); */",
				'const held = "it(\'a quoted case\', () => {})";',
				"it('the real case', () => {});",
			].join('\n'),
		);
		expect(found.titles).toEqual([{ line: 4, title: 'the real case' }]);
	});
});

describe('what the citations and the plan say about each other', () => {
	it('reports a citation that the plan does not contain', () => {
		const { result } = run("it('FM-99 invents an ID', () => {});");
		expect(result.unknown).toEqual([
			{
				path: 'test/suites/example.test.ts',
				line: 1,
				title: 'FM-99 invents an ID',
				id: 'FM-99',
			},
		]);
	});

	it('reports nothing for a technical word of the same shape', () => {
		const { found, result } = run(
			"it('the corpus holds UTF-8 and SHA-256 bytes', () => {});",
		);
		expect(found.titles).toBe(1);
		expect(result.unknown).toEqual([]);
		expect(result.cited).toEqual([]);
	});

	it('takes an ID out of the uncited set when a title cites it', () => {
		const { result } = run("it('FM-2 names both keys', () => {});");
		expect(result.unknown).toEqual([]);
		expect(result.cited).toEqual(['FM-2']);
		expect(result.uncited).not.toContain('FM-2');
		expect(result.uncited).toHaveLength(226);
	});

	// The plan gives some IDs to more than one stage, and each stage brings
	// its own tests. Therefore more than one title can carry one ID, and this
	// is not a fault.
	it('accepts more than one title for one ID', () => {
		const { found, result } = run(
			[
				"it('UI-1 lists the read-side conditions', () => {});",
				"it('UI-1 lists the conditions that push adds', () => {});",
			].join('\n'),
		);
		expect(found.citations).toHaveLength(2);
		expect(result.unknown).toEqual([]);
		expect(result.cited).toEqual(['UI-1']);
	});

	it('keeps every ID of each set, and not the counts alone', () => {
		const { result } = run(
			[
				"it('FM-1 reads the vocabulary', () => {});",
				"it('FM-99 invents an ID', () => {});",
			].join('\n'),
		);
		expect(result.cited).toEqual(['FM-1']);
		expect(result.unknown.map((citation) => citation.id)).toEqual([
			'FM-99',
		]);
		expect(result.uncited).toContain('FM-2');
		expect(result.uncited).not.toContain('FM-1');
	});

	it('reads the citations of every file that it is given', () => {
		const files: SuiteFile[] = [
			{
				path: 'test/suites/one.test.ts',
				text: "it('FM-1 one', () => {});",
			},
			{
				path: 'test/suites/two.test.ts',
				text: "it('FM-2 two', () => {});",
			},
		];
		const found = readSuites(files, PLAN);
		expect(found.citations.map((citation) => citation.path)).toEqual([
			'test/suites/one.test.ts',
			'test/suites/two.test.ts',
		]);
	});
});

describe('what the check prints', () => {
	it('names the file, the line, the title and the ID that failed', () => {
		const { result } = run(
			[
				"it('FM-1 one', () => {});",
				"it('FM-99 invents an ID', () => {});",
			].join('\n'),
		);
		const lines = failureLines(result).join('\n');
		expect(lines).toContain('test/suites/example.test.ts:2 cites FM-99');
		expect(lines).toContain('title: FM-99 invents an ID');
		expect(lines).toContain(
			'the count of citations that the plan does not',
		);
	});

	it('says nothing when every citation is in the plan', () => {
		const { result } = run("it('FM-1 one', () => {});");
		expect(failureLines(result)).toEqual([]);
	});

	it('states the counts and lists every ID that no title cites', () => {
		const { found, result } = run("it('FM-1 one', () => {});");
		const lines = reportLines(PLAN, found, result).join('\n');
		expect(lines).toContain('the plan contains 266 IDs, and 227 of them');
		expect(lines).toContain(
			'the count of test IDs that no title cites is 226',
		);
		expect(lines).toContain('FM-2');
		expect(lines).not.toMatch(/\bFM-1\b/);
	});

	it('states that a cited ID can still be incomplete', () => {
		const { found, result } = run("it('FM-1 one', () => {});");
		expect(reportLines(PLAN, found, result).join('\n')).toContain(
			'more than one stage',
		);
	});

	it('reports the count of the titles that it could not read', () => {
		const { found, result } = run('it(titleFor(item), () => {});');
		expect(reportLines(PLAN, found, result).join('\n')).toContain(
			'the count of titles that are not text is 1',
		);
	});
});

describe('the check as a process', () => {
	const scratch = mkdtempSync(join(tmpdir(), 'davenport-plan-ids-'));

	afterAll(() => {
		rmSync(scratch, { recursive: true, force: true });
	});

	function check(argv: readonly string[]): {
		status: number | null;
		out: string;
		err: string;
	} {
		const result = spawnSync(process.execPath, [SCRIPT, ...argv], {
			encoding: 'utf8',
		});
		return {
			status: result.status,
			out: result.stdout,
			err: result.stderr,
		};
	}

	it('passes over the tree of this repository', () => {
		const result = check([]);
		expect(result.err).toBe('');
		expect(result.status).toBe(0);
		expect(result.out).toContain('the plan contains 266 IDs');
	});

	it('fails on a title that cites an ID that the plan does not contain', () => {
		const file = join(scratch, 'invented.test.ts');
		writeFileSync(file, "it('FM-99 invents an ID', () => {});\n", 'utf8');
		const result = check([PLAN_PATH, scratch]);
		expect(result.status).toBe(1);
		expect(result.err).toContain('cites FM-99');
		expect(result.err).toContain('invented.test.ts:1');
	});

	it('says one line when it cannot read the plan', () => {
		const result = check([join(scratch, 'no-such-plan.md')]);
		expect(result.status).toBe(1);
		expect(result.err.trimEnd().split('\n')).toHaveLength(1);
		expect(result.err).toContain('cannot read the plan');
	});
});
