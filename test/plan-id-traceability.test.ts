/**
 * The decisions behind the plan-ID traceability check:
 *
 * - which IDs the check reads out of the test plan;
 * - what the check does with a plan that gives it no vocabulary;
 * - which words in a title are IDs, and which words only look like IDs;
 * - which titles the check reads out of a suite file;
 * - what the comparison of the two sets says;
 * - the wording that the check prints around all of that;
 * - which files the check reads for the citations.
 *
 * The last of these decides where the rules of the suites hold. The check
 * reads every file under the suite root whose name ends in `.test.ts`. The
 * check reads no other file. A title that the check cannot read fails the
 * check inside that set. The same title outside that set changes nothing,
 * because the check never reads the file that carries the title.
 *
 * The grammar tests run against the real plan, and not against a copy of it.
 * A copy would drift, and then the tests would prove the copy. The control is
 * two-sided: the check catches an ID that nobody defined, and the check
 * passes over a technical word of the same shape.
 *
 * The script itself only finds the files and reads them. A run can end in
 * several ways, and these tests exercise each way as a process. The interface
 * includes the exit status, and not only the words that the run prints.
 */

import { spawnSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
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
	planFaults,
	readPlan,
	readSuites,
	reconcile,
} from '../scripts/plan-ids-core';
import {
	failureLines,
	faultLines,
	reportLines,
} from '../scripts/plan-ids-text';
import { readTitles } from '../scripts/plan-ids-titles';

const PLAN_PATH = fileURLToPath(
	new URL('../docs/davenport-test-plan.md', import.meta.url),
);
const SCRIPT = fileURLToPath(
	new URL('../scripts/plan-ids.mjs', import.meta.url),
);
const MOCK_ATTACHMENTS = fileURLToPath(
	new URL('./harness/caldav-mock/attachments.ts', import.meta.url),
);
/** A harness test that builds a title with a template. The check reads no title of this file. */
const FOLD_ROUND_TRIP = fileURLToPath(
	new URL('./harness/ics-fold-round-trip.test.ts', import.meta.url),
);

/** A title that a template builds. The check cannot read a title of this shape. */
const COMPUTED = 'it(`the case ${name} makes`, () => {});\n';

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

/** One title for every test ID that the plan contains. */
function everyTestId(): string {
	return PLAN.suiteIds
		.map((id) => `it('${id} covered', () => {});`)
		.join('\n');
}

describe('the IDs that the plan contains', () => {
	it('takes the suite tags from the headings of the suites part', () => {
		expect(SMALL.suitePrefixes).toEqual(['QQ', 'ZQ']);
	});

	it('takes an ID from every item, with a shape tag or without one', () => {
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
		expect(SMALL.otherIds).toEqual(['XV-1', 'B-1', 'B-2']);
	});

	it('reads the whole corpus of the real plan', () => {
		expect(PLAN.suitePrefixes).toHaveLength(26);
		expect(PLAN.ids).toHaveLength(267);
		expect(PLAN.suiteIds).toHaveLength(227);
		expect(PLAN.otherIds).toHaveLength(40);
	});

	it('keeps the sweeps and the protocol items outside the test IDs', () => {
		expect(PLAN.otherIds).toContain('IV-1');
		expect(PLAN.otherIds).toContain('A-11');
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

	it('takes the first tag of a heading that carries two', () => {
		const corpus = readPlan(
			[
				'### 5.1 First suite [QQ] and [ZQ] — §1',
				'- **QQ-1 [D]** One.',
			].join('\n'),
		);
		expect(corpus.suitePrefixes).toEqual(['QQ']);
		expect(corpus.suiteIds).toEqual(['QQ-1']);
	});

	it('counts a tag one time when two headings carry it', () => {
		const corpus = readPlan(
			[
				'### 5.1 First part [QQ] — §1',
				'- **QQ-1 [D]** One.',
				'### 5.2 Second part [QQ] — §2',
				'- **QQ-2 [D]** Two.',
			].join('\n'),
		);
		expect(corpus.suitePrefixes).toEqual(['QQ']);
	});

	// A bold technical word must not become a plan ID. If it did, its letters
	// would join the vocabulary, and every title that carried the same word
	// would read as a citation of a real ID.
	it.each([
		['a word inside a sentence', 'The digest is **SHA-256** everywhere.'],
		['a word that opens a paragraph', '**UTF-8** is the encoding.'],
		['a bold marker inside a word', 'The item x**ZZ-1** is not an item.'],
	])('defines no ID from %s', (_what, line) => {
		const corpus = readPlan(
			['### 5.1 First suite [QQ] — §1', '- **QQ-1 [D]** One.', line].join(
				'\n',
			),
		);
		expect(corpus.ids).toEqual(['QQ-1']);
		expect(corpus.prefixes).toEqual(['QQ']);
	});

	it('defines an ID that follows the end of a sentence', () => {
		const corpus = readPlan(
			[
				'### 6.1 A protocol [V]',
				'- **B-1** The first one. **B-2** The second one.',
			].join('\n'),
		);
		expect(corpus.ids).toEqual(['B-1', 'B-2']);
	});
});

describe('a plan that gives the check no vocabulary', () => {
	it('finds no fault in the real plan', () => {
		expect(planFaults(PLAN)).toEqual([]);
	});

	it('reports a plan with no suite and no ID', () => {
		expect(planFaults(readPlan('# A plan with nothing in it'))).toEqual([
			{ kind: 'no-suite' },
			{ kind: 'no-id' },
		]);
	});

	it('reports a suite that defines no ID', () => {
		const corpus = readPlan(
			[
				'### 5.1 First suite [QQ] — §1',
				'- **QQ-1 [D]** One.',
				'### 5.2 Second suite [ZQ] — §2',
				'- ZQ-1 without the bold marker.',
			].join('\n'),
		);
		expect(planFaults(corpus)).toEqual([
			{ kind: 'empty-suite', tag: 'ZQ' },
		]);
	});

	it('states each fault and the consequence of the faults', () => {
		const lines = faultLines(
			planFaults(readPlan('### 5.1 First suite [QQ] — §1')),
		).join('\n');
		expect(lines).toContain('the plan defines no ID');
		expect(lines).toContain('the plan declares the suite QQ');
		expect(lines).toContain(
			'The comparison did not run. The plan failed the checks above.',
		);
	});

	it('says nothing about a plan that carries its vocabulary', () => {
		expect(faultLines(planFaults(PLAN))).toEqual([]);
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

	// A number that no item carries is its own ID, and the plan does not
	// contain it. Therefore the check reports the title. A mistyped ID fails
	// loudly, and it never passes as the ID beside it, at any length.
	it.each([
		['a longer number', 'FM-20 is not FM-2', ['FM-20', 'FM-2']],
		['a four-digit number', 'FM-1000 is not FM-1', ['FM-1000', 'FM-1']],
		['a padded number', 'FM-02 is not FM-2', ['FM-02', 'FM-2']],
		['a longer protocol number', 'A-2600 is not A-26', ['A-2600', 'A-26']],
	])('reads %s as its own ID', (_what, title, wanted) => {
		expect(citedIds(title, PLAN.prefixes)).toEqual(wanted);
	});

	it('reports a number that no item carries', () => {
		const { result } = run("it('FM-1000 counts too high', () => {});");
		expect(result.unknown.map((citation) => citation.id)).toEqual([
			'FM-1000',
		]);
	});

	// A decimal number takes the shape of an ID and means something else. The
	// check must not read it as the ID in front of the point, because that ID
	// exists and the check would then report a test that nobody wrote.
	it('reads no ID out of a decimal number', () => {
		expect(citedIds('PM-2.5 is particulate matter', PLAN.prefixes)).toEqual(
			[],
		);
		expect(
			citedIds('the limit is A-11.4 micrograms', PLAN.prefixes),
		).toEqual([]);
	});

	it('takes an ID that a sentence ends with', () => {
		expect(citedIds('the anchor is PM-2.', PLAN.prefixes)).toEqual([
			'PM-2',
		]);
	});

	it('reads nothing when the plan gives no prefix', () => {
		expect(citedIds('FM-2 stands alone', [])).toEqual([]);
	});
});

describe('the titles that a suite file declares', () => {
	it('takes the title of every name that carries one', () => {
		const found = readTitles(
			[
				"describe('the group', () => {",
				"\tit('the first case', () => {});",
				'\ttest("the second case", () => {});',
				'});',
				"suite('the other group', () => {});",
				"bench('the benchmark', () => {});",
			].join('\n'),
		);
		expect(found.titles).toEqual([
			{ line: 1, title: 'the group' },
			{ line: 2, title: 'the first case' },
			{ line: 3, title: 'the second case' },
			{ line: 5, title: 'the other group' },
			{ line: 6, title: 'the benchmark' },
		]);
		expect(found.unreadable).toEqual([]);
	});

	it('takes the title of a call that a table of rows curries', () => {
		const found = readTitles(
			[
				"describe.each([['a'], ['b']])('the group %s', () => {",
				"\tit.each(rows())('the case %s', () => {});",
				"\tit.skip('the skipped case', () => {});",
				"\tit.skip.each([1])('the skipped row %i', () => {});",
				'});',
			].join('\n'),
		);
		expect(found.titles.map((site) => site.title)).toEqual([
			'the group %s',
			'the case %s',
			'the skipped case',
			'the skipped row %i',
		]);
		expect(found.unreadable).toEqual([]);
	});

	// A tagged template carries the rows of a table. The reader must step over
	// the template and take the title of the call that stands on it.
	it('takes the title of a call that a tagged table curries', () => {
		const found = readTitles(
			[
				'it.each`',
				'\ta    | b',
				'\t${1} | ${2}',
				"`('FM-99 tagged table $a', () => {});",
			].join('\n'),
		);
		expect(found.titles).toEqual([
			{ line: 1, title: 'FM-99 tagged table $a' },
		]);
		expect(found.unreadable).toEqual([]);
	});

	it('takes a title that a template with no expression spells', () => {
		const found = readTitles('it(`the plain template case`, () => {});');
		expect(found.titles).toEqual([
			{ line: 1, title: 'the plain template case' },
		]);
	});

	// A title that a program builds is not a title that the check can read.
	// The check keeps the place and the text of each one, and it never takes a
	// part of such a title for the whole of it.
	it.each([
		[
			'a template with an expression',
			'it(`the case ${name} makes`, () => {});',
		],
		[
			'a title that a program joins',
			"it('FM-' + number + ' one', () => {});",
		],
		['a title that a name stands for', 'it(titleFor(item), () => {});'],
		['a call with no title at all', 'it();'],
	])('cannot read %s', (_what, source) => {
		const found = readTitles(source);
		expect(found.titles).toEqual([]);
		expect(found.unreadable).toHaveLength(1);
		expect(found.unreadable[0]?.line).toBe(1);
	});

	it('keeps the text that stands where the title was expected', () => {
		const found = readTitles("it('FM-' + number + ' one', () => {});");
		expect(found.unreadable[0]?.text).toBe("'FM-' + number + ' one'");
	});

	// A call that gives no argument has no text that stands in the title. The
	// reader keeps the place alone, and the check words that site of its own.
	it('keeps no text for a call that gives no title', () => {
		const found = readTitles('it();');
		expect(found.unreadable).toEqual([{ line: 1, text: undefined }]);
	});

	// The word in front of a call decides whether the call declares a test. A
	// word behind a point that Vitest does not define as a modifier makes the
	// call something else. A suite that holds its rows in an array and calls
	// `test.run()` over them writes such a call. The check must pass over it,
	// and it must not ask the author to make that line a plain string.
	it.each([
		['a call that runs a row', 'test.run();'],
		['a call that takes the next row', 'it.next();'],
		['a call that closes a group', 'suite.close();'],
		['a call that reads a row of a table', 'test.rows.of(item);'],
		['a call that builds a test of its own', 'const own = test.extend(f);'],
		['a call that sets the fixtures of a file', 'test.scoped({ db: 1 });'],
	])('passes over %s', (_what, source) => {
		const found = readTitles(source);
		expect(found.titles).toEqual([]);
		expect(found.unreadable).toEqual([]);
	});

	// The other side of the same rule. A modifier keeps the call a test, so a
	// title that a program builds behind a modifier still fails.
	it.each([
		'skip',
		'only',
		'todo',
		'fails',
		'concurrent',
		'sequential',
		'shuffle',
		'describe',
		'suite',
	])('cannot read a title that stands behind %s', (modifier) => {
		const found = readTitles(`it.${modifier}('FM-' + number, () => {});`);
		expect(found.titles).toEqual([]);
		expect(found.unreadable).toHaveLength(1);
		expect(found.unreadable[0]?.text).toBe("'FM-' + number");
	});

	// Vitest carries a group of tests on the name of a test: `test.describe`
	// and `it.suite` start a group, and each one takes a title. A reader that
	// steps over these words loses the titles of that group.
	it.each([
		['test.describe', "test.describe('FM-1 one', () => {});"],
		['test.suite', "test.suite('FM-1 one', () => {});"],
		['it.describe', "it.describe('FM-1 one', () => {});"],
		['it.suite', "it.suite('FM-1 one', () => {});"],
	])('reads a plain title that %s takes', (_what, source) => {
		const found = readTitles(source);
		expect(found.titles).toEqual([{ line: 1, title: 'FM-1 one' }]);
		expect(found.unreadable).toEqual([]);
	});

	it('counts a title that a group of a test takes as a citation', () => {
		const { found, result } = run(
			"test.describe('FM-1 reads the vocabulary', () => {});",
		);
		expect(found.titleCount).toBe(1);
		expect(result.cited).toEqual(['FM-1']);
	});

	// The rows of a table stand between the modifier and the title. The rule
	// reads the word in front of the call that carries the title, so a title
	// behind a table of rows still reaches the reader.
	it.each(['each', 'for', 'runIf', 'skipIf', 'extend'])(
		'cannot read a title that stands behind %s and its rows',
		(modifier) => {
			const found = readTitles(
				`it.${modifier}(rows)('FM-' + number, () => {});`,
			);
			expect(found.titles).toEqual([]);
			expect(found.unreadable).toHaveLength(1);
		},
	);

	it('reads a plain title that stands behind a table of rows', () => {
		const found = readTitles("it.extend(f)('FM-1 one', () => {});");
		expect(found.titles).toEqual([{ line: 1, title: 'FM-1 one' }]);
	});

	it('reads a title that stands behind two modifiers', () => {
		const found = readTitles("it.skip.each([1])('FM-1 one %i', () => {});");
		expect(found.titles).toEqual([{ line: 1, title: 'FM-1 one %i' }]);
	});

	it('cites no ID from a title that it cannot read', () => {
		const { found, result } = run("it('FM-' + '99 one', () => {});");
		expect(result.cited).toEqual([]);
		expect(result.unknown).toEqual([]);
		expect(found.unreadable).toEqual([
			{
				path: 'test/suites/example.test.ts',
				line: 1,
				text: "'FM-' + '99 one'",
			},
		]);
	});

	it('passes over a name that no call follows', () => {
		const found = readTitles('const it = 1;\nconst test = describe;\n');
		expect(found.titles).toEqual([]);
		expect(found.unreadable).toEqual([]);
	});

	it('passes over a call on an object', () => {
		const found = readTitles("expect(pattern.test('FM-2')).toBe(true);");
		expect(found.titles).toEqual([]);
		expect(found.unreadable).toEqual([]);
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

	// The reader parses the file, so a quote character inside a regular
	// expression cannot put it out of step with the rest of the file.
	it('reads every title after a regular expression that holds a quote', () => {
		const found = readTitles(
			[
				"const first = /it's/;",
				'const second = /filename="([^"]*)"/i;',
				"it('FM-1 one', () => {});",
				"describe('FM-2 group', () => {",
				"\tit('FM-3 three', () => {});",
				'});',
			].join('\n'),
		);
		expect(found.titles.map((site) => site.title)).toEqual([
			'FM-1 one',
			'FM-2 group',
			'FM-3 three',
		]);
	});

	// The same shape stands in the mock server of the harness. The file itself
	// declares no title, and a file that appends titles to it keeps them all.
	it('reads every title of a real file that holds that shape', () => {
		const real = readFileSync(MOCK_ATTACHMENTS, 'utf8');
		expect(real).toContain('/filename="([^"]*)"/i');
		expect(readTitles(real, 'attachments.ts')).toEqual({
			titles: [],
			unreadable: [],
		});
		const appended = readTitles(
			`${real}\nit('FM-1 one', () => {});\nit('FM-2 two', () => {});\n`,
			'attachments.ts',
		);
		expect(appended.titles.map((site) => site.title)).toEqual([
			'FM-1 one',
			'FM-2 two',
		]);
		expect(appended.unreadable).toEqual([]);
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
		expect(found.titleCount).toBe(1);
		expect(result.unknown).toEqual([]);
		expect(result.cited).toEqual([]);
	});

	it('takes an ID out of the uncited set when a title cites it', () => {
		const { result } = run("it('FM-2 names both keys', () => {});");
		expect(result.unknown).toEqual([]);
		expect(result.cited).toEqual(['FM-2']);
		expect(result.citedTests).toEqual(['FM-2']);
		expect(result.uncited).not.toContain('FM-2');
		expect(result.uncited).toHaveLength(PLAN.suiteIds.length - 1);
	});

	it('counts a sweep against the citations and not against the test IDs', () => {
		const { result } = run(
			"it('the anchor of IV-3 stands here', () => {});",
		);
		expect(result.cited).toEqual(['IV-3']);
		expect(result.citedTests).toEqual([]);
		expect(result.uncited).toHaveLength(PLAN.suiteIds.length);
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
		const { found, result } = run(
			[
				"it('FM-1 one', () => {});",
				"it('FM-99 invents an ID', () => {});",
			].join('\n'),
		);
		const lines = failureLines(found, result).join('\n');
		expect(lines).toContain('test/suites/example.test.ts:2 cites FM-99');
		expect(lines).toContain('title: FM-99 invents an ID');
		expect(lines).toContain(
			'the count of citations of IDs that the plan does not contain is 1',
		);
	});

	it('says nothing when every citation is in the plan', () => {
		const { found, result } = run("it('FM-1 one', () => {});");
		expect(failureLines(found, result)).toEqual([]);
	});

	it('states the counts of the plan', () => {
		const { found, result } = run("it('FM-1 one', () => {});");
		expect(reportLines(PLAN, found, result)[0]).toContain(
			'the plan contains 267 IDs. The plan gives 227 of these IDs to the suites, and 40 to the sweeps',
		);
	});

	it('lists the IDs that the titles cite, and not the count alone', () => {
		const { found, result } = run(
			["it('FM-1 one', () => {});", "it('LG-2 two', () => {});"].join(
				'\n',
			),
		);
		const lines = reportLines(PLAN, found, result);
		expect(lines.join('\n')).toContain('the titles cite 2 IDs of the plan');
		expect(lines).toContain('  FM-1');
		expect(lines).toContain('  LG-2');
	});

	it('lists every test ID that no title cites', () => {
		const { found, result } = run("it('FM-1 one', () => {});");
		const lines = reportLines(PLAN, found, result).join('\n');
		expect(lines).toContain(
			`the count of test IDs that no title cites is ${String(PLAN.suiteIds.length - 1)}`,
		);
		expect(lines).toContain('FM-2');
	});

	// The caveat guards against one reading: that a cited ID is a finished
	// item. Full coverage is the state in which a reader draws that
	// conclusion, so the caveat must stand there too.
	it('states that a title covers one stage whenever the titles cite an ID', () => {
		for (const source of [
			"it('FM-1 one', () => {});",
			everyTestId(),
			"it('the anchor of IV-3 stands here', () => {});",
		]) {
			const { found, result } = run(source);
			expect(reportLines(PLAN, found, result).join('\n')).toContain(
				'A title for one stage does not cover the other stages',
			);
		}
	});

	it('states what full coverage means and what it does not mean', () => {
		const { found, result } = run(everyTestId());
		const lines = reportLines(PLAN, found, result).join('\n');
		expect(result.uncited).toEqual([]);
		expect(lines).toContain(
			'every test ID has at least one title that cites it',
		);
		expect(lines).toContain('This check does not compare the stages');
	});

	// A title that the check cannot read carries no citation. The check fails
	// on such a title. Therefore the lines that name the title belong to the
	// failure, and the report says nothing about the title.
	it('names the titles that it cannot read among the failures', () => {
		const { found, result } = run('it(titleFor(item), () => {});');
		const lines = failureLines(found, result).join('\n');
		expect(lines).toContain(
			'test/suites/example.test.ts:1 holds a title that the check cannot read',
		);
		expect(lines).toContain('title: titleFor(item)');
		expect(lines).toContain(
			'the count of titles that the check cannot read is 1',
		);
		expect(reportLines(PLAN, found, result).join('\n')).not.toContain(
			'titleFor(item)',
		);
	});

	it('names every title that it cannot read, and not the first alone', () => {
		const { found, result } = run(
			[
				"it('FM-1 one', () => {});",
				'it(titleFor(item), () => {});',
				"it('FM-' + number + ' two', () => {});",
			].join('\n'),
		);
		const lines = failureLines(found, result).join('\n');
		expect(lines).toContain('test/suites/example.test.ts:2');
		expect(lines).toContain('test/suites/example.test.ts:3');
		expect(lines).toContain("title: 'FM-' + number + ' two'");
		expect(lines).toContain(
			'the count of titles that the check cannot read is 2',
		);
	});

	// A call that gives no title has no text that stands in the title. The
	// lines of that call must not label a sentence as the title, and the
	// remedy must fit: the call needs a title, and not a title of another
	// shape.
	it('words a call that gives no title of its own', () => {
		const { found, result } = run("it('FM-1 one', () => {});\nit();");
		const lines = failureLines(found, result).join('\n');
		expect(lines).toContain(
			'test/suites/example.test.ts:2 holds a call that gives no title',
		);
		expect(lines).toContain(
			'the count of calls that give no title is 1. Give a title to each of these calls.',
		);
		expect(lines).not.toContain('title:');
		expect(lines).not.toContain('Make each of these titles a plain string');
	});

	// A file can hold both shapes. Each shape keeps its own lines and its own
	// count, so neither remedy stands under the wrong place.
	it('separates a call that gives no title from a title that it cannot read', () => {
		const { found, result } = run('it(titleFor(item), () => {});\nit();');
		const lines = failureLines(found, result).join('\n');
		expect(lines).toContain(
			'the count of titles that the check cannot read is 1',
		);
		expect(lines).toContain('the count of calls that give no title is 1');
		expect(lines).toContain('  title: titleFor(item)');
	});

	// The check can find more than one kind of failure in one run. It must
	// print every kind, and each kind must keep its own count line.
	it('prints both kinds of failure, in one order', () => {
		const { found, result } = run(
			[
				"it('FM-1 one', () => {});",
				'it(titleFor(item), () => {});',
				"it('FM-99 invents an ID', () => {});",
			].join('\n'),
		);
		const lines = failureLines(found, result);
		expect(lines).toEqual([
			'plan-id check: test/suites/example.test.ts:2 holds a title that the check cannot read',
			'  title: titleFor(item)',
			'plan-id check: the count of titles that the check cannot read is 1. The check reads a plain string, and the check cannot read a title that a program builds. Make each of these titles a plain string.',
			'plan-id check: test/suites/example.test.ts:3 cites FM-99, and the plan does not contain that ID',
			'  title: FM-99 invents an ID',
			'plan-id check: the count of citations of IDs that the plan does not contain is 1. Correct each title, or add the ID to the plan.',
		]);
	});

	it('counts one ID as one ID', () => {
		const { found, result } = run("it('FM-1 one', () => {});");
		const lines = reportLines(PLAN, found, result).join('\n');
		expect(lines).toContain('the titles cite 1 ID of the plan');
		expect(lines).toContain('the count of titles in the suite files is 1');
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

	/** A plan file in the scratch directory, and the path to it. */
	function planFile(name: string, text: string): string {
		const path = join(scratch, name);
		writeFileSync(path, text, 'utf8');
		return path;
	}

	it('passes over the tree of this repository', () => {
		const result = check([]);
		expect(result.err).toBe('');
		expect(result.status).toBe(0);
		expect(result.out).toContain('the plan contains 267 IDs');
	});

	it('fails on a title that cites an ID that the plan does not contain', () => {
		const suites = mkdtempSync(join(scratch, 'suites-'));
		writeFileSync(
			join(suites, 'invented.test.ts'),
			"it('FM-99 invents an ID', () => {});\n",
			'utf8',
		);
		const result = check([PLAN_PATH, suites]);
		expect(result.status).toBe(1);
		expect(result.err).toContain('cites FM-99');
		expect(result.err).toContain('invented.test.ts:1');
	});

	// The titles of the suites carry the traceability. A title that the check
	// cannot read drops out of that traceability. The run must stop there. A
	// report line on a run that passes states the loss and changes nothing.
	it('fails on a title of a suite file that it cannot read', () => {
		const suites = mkdtempSync(join(scratch, 'suites-'));
		writeFileSync(join(suites, 'computed.test.ts'), COMPUTED, 'utf8');
		const result = check([PLAN_PATH, suites]);
		expect(result.status).toBe(1);
		expect(result.err).toContain(
			'computed.test.ts:1 holds a title that the check cannot read',
		);
		expect(result.err).toContain('title: `the case ${name} makes`');
		expect(result.err).toContain(
			'the count of titles that the check cannot read is 1',
		);
	});

	it('fails on such a title in a directory under the suite root', () => {
		const suites = mkdtempSync(join(scratch, 'suites-'));
		const nested = join(suites, 'feed');
		mkdirSync(nested);
		writeFileSync(join(nested, 'computed.test.ts'), COMPUTED, 'utf8');
		const result = check([PLAN_PATH, suites]);
		expect(result.status).toBe(1);
		expect(result.err).toContain('feed/computed.test.ts:1');
	});

	// A run can hold more than one kind of failure. The check must print every
	// kind, and the order must hold, because a person reads the log from the
	// top.
	it('prints both kinds of failure in one run', () => {
		const suites = mkdtempSync(join(scratch, 'suites-'));
		writeFileSync(
			join(suites, 'both.test.ts'),
			[
				"it('FM-1 reads the vocabulary', () => {});",
				'it(`the case ${name} makes`, () => {});',
				"it('FM-99 invents an ID', () => {});",
				'',
			].join('\n'),
			'utf8',
		);
		const result = check([PLAN_PATH, suites]);
		expect(result.status).toBe(1);
		const unreadable = result.err.indexOf(
			'both.test.ts:2 holds a title that the check cannot read',
		);
		const counted = result.err.indexOf(
			'the count of titles that the check cannot read is 1',
		);
		const unknown = result.err.indexOf('both.test.ts:3 cites FM-99');
		expect(unreadable).toBeGreaterThan(-1);
		expect(counted).toBeGreaterThan(unreadable);
		expect(unknown).toBeGreaterThan(counted);
		expect(result.err).toContain(
			'the count of citations of IDs that the plan does not contain is 1',
		);
		expect(result.out).toContain('the titles cite 1 ID of the plan');
	});

	// `test` and `it` are ordinary words. A suite that holds its rows in an
	// array and calls a method over them writes a call that is not a test. The
	// check must not ask that author to make a plain string of a line that
	// carries no title.
	it('passes over a call of the suite root that declares no test', () => {
		const suites = mkdtempSync(join(scratch, 'suites-'));
		writeFileSync(
			join(suites, 'rows.test.ts'),
			[
				"it('FM-1 reads the vocabulary', () => {});",
				'for (const test of cases) {',
				'\ttest.run();',
				'}',
				'',
			].join('\n'),
			'utf8',
		);
		const result = check([PLAN_PATH, suites]);
		expect(result.err).toBe('');
		expect(result.status).toBe(0);
	});

	it('fails on a title that a program builds behind a modifier', () => {
		const suites = mkdtempSync(join(scratch, 'suites-'));
		writeFileSync(
			join(suites, 'skipped.test.ts'),
			"it.skip('computed ' + title, () => {});\n",
			'utf8',
		);
		const result = check([PLAN_PATH, suites]);
		expect(result.status).toBe(1);
		expect(result.err).toContain(
			'skipped.test.ts:1 holds a title that the check cannot read',
		);
		expect(result.err).toContain("title: 'computed ' + title");
	});

	// Vitest carries a group of tests on the name of a test. Such a group takes
	// a title, so the check must read that title and fail on a title that a
	// program builds there.
	it('fails on a title that a program builds behind a group of a test', () => {
		const suites = mkdtempSync(join(scratch, 'suites-'));
		writeFileSync(
			join(suites, 'group.test.ts'),
			[
				"test.describe('computed ' + title, () => {});",
				"it.suite('FM-1 reads the vocabulary', () => {});",
				'',
			].join('\n'),
			'utf8',
		);
		const result = check([PLAN_PATH, suites]);
		expect(result.status).toBe(1);
		expect(result.err).toContain(
			'group.test.ts:1 holds a title that the check cannot read',
		);
		expect(result.err).toContain("title: 'computed ' + title");
		expect(result.out).toContain(
			'the count of titles in the suite files is 1',
		);
		expect(result.out).toContain('the titles cite 1 ID of the plan');
	});

	it('names a call of a suite file that gives no title', () => {
		const suites = mkdtempSync(join(scratch, 'suites-'));
		writeFileSync(join(suites, 'empty.test.ts'), 'it();\n', 'utf8');
		const result = check([PLAN_PATH, suites]);
		expect(result.status).toBe(1);
		expect(result.err).toContain(
			'empty.test.ts:1 holds a call that gives no title',
		);
		expect(result.err).toContain(
			'the count of calls that give no title is 1',
		);
		expect(result.err).not.toContain('Make each of these titles');
	});

	// The check reads the test files under the suite root and no other file.
	// The set that it reads is the set that the rule holds for.
	it('passes over such a title in a file beside the suite root', () => {
		const tree = mkdtempSync(join(scratch, 'tree-'));
		const suites = join(tree, 'suites');
		const harness = join(tree, 'harness');
		mkdirSync(suites);
		mkdirSync(harness);
		writeFileSync(
			join(suites, 'good.test.ts'),
			"it('FM-1 reads the vocabulary', () => {});\n",
			'utf8',
		);
		writeFileSync(join(harness, 'helper.test.ts'), COMPUTED, 'utf8');
		const result = check([PLAN_PATH, suites]);
		expect(result.err).toBe('');
		expect(result.status).toBe(0);
		expect(result.out).toContain(
			'the count of titles in the suite files is 1',
		);
	});

	it('passes over such a title in a file of the suite root that holds no test', () => {
		const suites = mkdtempSync(join(scratch, 'suites-'));
		writeFileSync(
			join(suites, 'good.test.ts'),
			"it('FM-1 reads the vocabulary', () => {});\n",
			'utf8',
		);
		writeFileSync(join(suites, 'rows.ts'), COMPUTED, 'utf8');
		const result = check([PLAN_PATH, suites]);
		expect(result.err).toBe('');
		expect(result.status).toBe(0);
	});

	// The harness holds titles of this shape today. Those tests take their
	// names from what they cover, and the check never opens their files.
	it('passes over the tree of this repository, which holds such a title in the harness', () => {
		const held = readTitles(
			readFileSync(FOLD_ROUND_TRIP, 'utf8'),
			'ics-fold-round-trip.test.ts',
		);
		expect(held.unreadable.length).toBeGreaterThan(0);
		const result = check([]);
		expect(result.err).toBe('');
		expect(result.status).toBe(0);
		expect(result.out).not.toContain('ics-fold-round-trip');
	});

	it('says one line when it cannot read the plan', () => {
		const result = check([join(scratch, 'no-such-plan.md')]);
		expect(result.status).toBe(1);
		expect(result.err.trimEnd().split('\n')).toHaveLength(1);
		expect(result.err).toContain('cannot read the plan file at');
	});

	// A plan that the check cannot parse must turn the check red. A check that
	// reads nothing compares nothing, and a comparison of nothing passes.
	it('fails on a plan that defines no ID', () => {
		const result = check([planFile('empty.md', '')]);
		expect(result.status).toBe(1);
		expect(result.err).toContain('the plan defines no ID');
		expect(result.err).toContain('the plan declares no suite');
	});

	it('fails on a plan whose items lost the bold marker', () => {
		const result = check([
			planFile(
				'boldless.md',
				[
					'### 5.1 First suite [FM] — §1',
					'- FM-1 [D] The first item.',
				].join('\n'),
			),
		]);
		expect(result.status).toBe(1);
		expect(result.err).toContain('the plan declares the suite FM');
		expect(result.err).toContain('defines no ID for that suite');
	});

	it('fails on a plan whose headings lost their tags', () => {
		const result = check([
			planFile(
				'tagless.md',
				[
					'### 5.1 First suite — §1',
					'- **FM-1 [D]** The first item.',
				].join('\n'),
			),
		]);
		expect(result.status).toBe(1);
		expect(result.err).toContain('the plan declares no suite');
	});
});
