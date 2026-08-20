/**
 * The plugin must not call the global fetch function. Every network request
 * goes through the transport port instead. Three guards hold this rule.
 *
 * Two of the guards are static. The first static guard is the set of lint
 * selectors, and these selectors report a direct fetch in the source files.
 * The second static guard is the bundle scan, and this scan reports a direct
 * fetch in the built bundle. The third guard works while the code runs. That
 * third guard is the fetch poison, and the poison has its own tests. This
 * file tests the two static guards.
 *
 * Each test uses a guard in the form that the repository configures. The
 * tests read the selectors out of the lint configuration, and they run the
 * scan as a separate process. If a guard becomes weaker in either place, a
 * test in this file fails. The tests make that change visible.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { createJiti } from 'jiti';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GitHost } from './harness/run-git';
import {
	GREP_ANSWERS,
	GREP_MATCH,
	GREP_NO_MATCH,
	runGit,
} from './harness/run-git';
import type { ProcessResult } from './harness/run-node';
import { WINDOWS_ABORT_STATUS, runNode } from './harness/run-node';

interface RestrictedSyntax {
	readonly selector: string;
	readonly message?: string;
}

interface ConfigBlock {
	readonly name?: string;
	readonly files?: readonly string[];
	readonly rules?: Readonly<Record<string, unknown>>;
}

const REFLECT_CALL = "Reflect.get(globalThis, 'fetch')('https://a.test/');";
const REFLECT_HOLDER = "const read = Reflect.get(holder, 'fetch');";
const REFLECT_TEMPLATE = 'const read = Reflect.get(holder, `fetch`);';
const REFLECT_INTERPOLATED =
	'const read = Reflect.get(holder, `fet${middle}ch`);';
const REFLECT_ELSEWHERE = "const url = Reflect.get(input, 'url');";
const MEMBER_CALL = "window.fetch('https://a.test/');";

const linter = new Linter();
let config: readonly ConfigBlock[] = [];

beforeAll(async () => {
	const jiti = createJiti(import.meta.url);
	config = await jiti.import<readonly ConfigBlock[]>('../eslint.config.mts', {
		default: true,
	});
});

function blockNamed(name: string): ConfigBlock {
	const block = config.find((entry) => entry.name === name);
	if (!block) {
		throw new Error(`the lint configuration has no block named ${name}`);
	}
	return block;
}

/** The syntax that the block with this name does not allow. */
function restrictions(name: string): RestrictedSyntax[] {
	const rule: unknown = blockNamed(name).rules?.['no-restricted-syntax'];
	if (!Array.isArray(rule)) {
		throw new Error(
			`the block named ${name} has no list of restricted syntax`,
		);
	}
	const options: readonly unknown[] = rule;
	return options.slice(1).map(asRestriction);
}

function asRestriction(option: unknown): RestrictedSyntax {
	const selector: unknown =
		typeof option === 'object' && option !== null
			? Reflect.get(option, 'selector')
			: undefined;
	if (typeof selector !== 'string') {
		throw new Error(
			'an option of the restricted-syntax rule has no selector',
		);
	}
	return { selector };
}

function refused(name: string, code: string): string[] {
	const config: Linter.Config = {
		rules: { 'no-restricted-syntax': ['error', ...restrictions(name)] },
	};
	return linter.verify(code, config).map((message) => message.message);
}

describe.each([['davenport/no-global-fetch'], ['davenport/core-boundary']])(
	'%s',
	(name) => {
		it('reports a fetch that Reflect.get reads off a holder object', () => {
			expect(refused(name, REFLECT_CALL)).toHaveLength(1);
			expect(refused(name, REFLECT_HOLDER)).toHaveLength(1);
		});

		it('also reports a key that a template string spells', () => {
			expect(refused(name, REFLECT_TEMPLATE)).toHaveLength(1);
		});

		it('still reports a fetch named on a global object', () => {
			expect(refused(name, MEMBER_CALL)).toHaveLength(1);
		});

		it('reports nothing when Reflect.get reads a different property', () => {
			expect(refused(name, REFLECT_ELSEWHERE)).toEqual([]);
		});

		// This fixture builds the key while the code runs, so the fixture
		// never spells the word fetch. Lint reads only what the source
		// spells, and therefore lint reports nothing. The fetch poison
		// covers this shape, because the poison replaces the property.
		it('reports nothing when the source does not spell the key', () => {
			expect(refused(name, REFLECT_INTERPOLATED)).toEqual([]);
		});
	},
);

describe('the lint exemption for the fetch poison', () => {
	it('covers the poison file and its test file, and no other file', () => {
		expect(blockNamed('davenport/fetch-poison-reflect').files).toEqual([
			'test/harness/sweeps/fetch-poison.ts',
			'test/harness/sweeps/fetch-poison.test.ts',
		]);
	});

	it('allows the Reflect.get spelling and reports the member spellings', () => {
		const name = 'davenport/fetch-poison-reflect';
		expect(refused(name, REFLECT_HOLDER)).toEqual([]);
		expect(refused(name, REFLECT_TEMPLATE)).toEqual([]);
		expect(refused(name, MEMBER_CALL)).toHaveLength(1);
	});
});

describe('the key spelling that the two static guards cannot see', () => {
	// The lint exemption exists because two files read fetch off a holder
	// object, and those two files spell the key as a literal. A constant
	// that holds the key is the one form that neither the lint selector nor
	// the bundle scan can follow. An example of that form in the repository
	// would therefore show a reader how to get past both static guards.
	//
	// The heldKey pattern uses POSIX character classes because the -E
	// option of git grep does not read \s or \w. git grep finds no match
	// for a pattern that it cannot read. A pattern of that kind would
	// report a clean repository and hide a real match. The command searches
	// the tracked files, so the check follows the repository and not the
	// working directory.
	const heldKey = (value: string): string =>
		'^[[:space:]]*(const|let|var)[[:space:]]+[[:alnum:]_]+[[:space:]]*' +
		`=[[:space:]]*['"\`]${value}['"\`]`;

	/**
	 * Runs one search over the tracked files. git grep gives 0 for a match
	 * and 1 for no match. The harness refuses every other status. Therefore
	 * a search that a host aborted fails its case, and the empty output of
	 * that search reaches no assertion.
	 */
	const search = (pattern: string, host?: GitHost): ProcessResult =>
		runGit({ args: ['grep', '-nE', pattern], answers: GREP_ANSWERS }, host);

	/**
	 * A constant with the shape that the search pattern finds. The value of
	 * this constant is not the key.
	 */
	const CONTROL = 'not-a-key-at-all';

	it('is written nowhere in the repository', () => {
		const held = search(heldKey('fetch'));
		expect(held.stdout).toBe('');
		expect(held.status).toBe(GREP_NO_MATCH);
	});

	// The test above is worth having only when the search pattern can find
	// a constant of this shape at all. This test builds the same pattern
	// around the control value above, and runs the pattern through the same
	// git grep. The line that declares the control has the shape, so this
	// test must find that line.
	it('finds a constant of this shape when the repository has one', () => {
		const found = search(heldKey(CONTROL));
		expect(found.status).toBe(GREP_MATCH);
		expect(found.stdout).toContain('fetch-guards.test.ts');
	});

	// The first case above passes when the output is empty. A host that
	// aborts git also leaves the output empty. This case runs the same
	// search against a host that aborts git. The search fails, and the
	// failure names the status.
	it('fails and names the status when a host aborts git', () => {
		const aborted: GitHost = {
			platform: 'win32',
			run: () => ({
				status: WINDOWS_ABORT_STATUS,
				stdout: '',
				stderr: '',
			}),
		};
		expect(() => search(heldKey('fetch'), aborted)).toThrow(/3221226505/u);
	});
});

describe('the bundle scan', () => {
	const script = fileURLToPath(
		new URL('../scripts/scan-bundle.mjs', import.meta.url),
	);

	/**
	 * One directory that all the cases share. The block removes this
	 * directory when the block ends.
	 */
	let directory = '';

	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), 'davenport-scan-'));
	});

	afterAll(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	/** Runs the bundle scan over a file that holds this text. */
	function scan(bundle: string): { status: number | null; output: string } {
		const file = join(directory, 'bundle.js');
		writeFileSync(file, bundle, 'utf8');
		const result = runNode([script, file]);
		return { status: result.status, output: result.stdout + result.stderr };
	}

	it.each([
		['a bare call', 'fetch("https://a.test/");'],
		[
			'a call through a global object with a dotted key',
			'globalThis.fetch("https://a.test/");',
		],
		[
			'a call through a global object with a bracketed key',
			'self["fetch"]("https://a.test/");',
		],
		[
			'a Reflect.get read that the code calls at once',
			'Reflect.get(globalThis,"fetch")("https://a.test/");',
		],
		[
			'a Reflect.get read that the code stores in a variable',
			"const f=Reflect.get(h,'fetch');",
		],
		[
			'a key that a template string spells',
			'const f=Reflect.get(h,`fetch`);',
		],
	])('fails a bundle that carries %s', (_name, bundle) => {
		const result = scan(bundle);
		expect(result.status).toBe(1);
		expect(result.output).toContain('direct fetch');
	});

	it('passes a bundle that does not reach fetch', () => {
		const result = scan(
			'const url=Reflect.get(input,"url");requestUrl({url});',
		);
		expect(result.status).toBe(0);
		expect(result.output).toContain('no direct fetch usage');
	});

	it('prints the full path of the file that the scan read', () => {
		expect(scan('fetch("https://a.test/");').output).toContain(
			join(directory, 'bundle.js'),
		);
	});
});
