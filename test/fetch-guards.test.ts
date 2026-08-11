/**
 * The static halves of the network-discipline ban: the lint selectors that
 * refuse a direct fetch in the source, and the scan that refuses one in the
 * bundle. The runtime half is the fetch poison, which has its own tests.
 *
 * Both halves are exercised as they are actually configured — the
 * selectors are read out of the lint configuration and the scan is run as
 * a process — so a guard weakened in either place fails here rather than
 * going quiet.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { createJiti } from 'jiti';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

/** The syntax the named configuration block refuses. */
function restrictions(name: string): RestrictedSyntax[] {
	const rule: unknown = blockNamed(name).rules?.['no-restricted-syntax'];
	if (!Array.isArray(rule)) {
		throw new Error(`${name} restricts no syntax at all`);
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
		throw new Error('a restricted-syntax option names no selector');
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
		it('refuses fetch read off a holder with Reflect.get', () => {
			expect(refused(name, REFLECT_CALL)).toHaveLength(1);
			expect(refused(name, REFLECT_HOLDER)).toHaveLength(1);
		});

		it('refuses the templated spelling of the key as well', () => {
			expect(refused(name, REFLECT_TEMPLATE)).toHaveLength(1);
		});

		it('still refuses the member spellings', () => {
			expect(refused(name, MEMBER_CALL)).toHaveLength(1);
		});

		it('says nothing about Reflect.get reaching another property', () => {
			expect(refused(name, REFLECT_ELSEWHERE)).toEqual([]);
		});

		// A key assembled at run time reads as fetch and is not spelled as
		// it, which is the boundary the poison covers and lint does not.
		it('says nothing about a key it cannot read off the page', () => {
			expect(refused(name, REFLECT_INTERPOLATED)).toEqual([]);
		});
	},
);

describe('the exemption the fetch poison carries', () => {
	it('covers the poison and its tests and nothing else', () => {
		expect(blockNamed('davenport/fetch-poison-reflect').files).toEqual([
			'test/harness/sweeps/fetch-poison.ts',
			'test/harness/sweeps/fetch-poison.test.ts',
		]);
	});

	it('lets the Reflect spelling through and keeps the rest banned', () => {
		const name = 'davenport/fetch-poison-reflect';
		expect(refused(name, REFLECT_HOLDER)).toEqual([]);
		expect(refused(name, REFLECT_TEMPLATE)).toEqual([]);
		expect(refused(name, MEMBER_CALL)).toHaveLength(1);
	});
});

describe('the key spelling the static halves cannot see', () => {
	// The exemption exists because two files read fetch off a holder. They
	// spell the key out where they do it: a constant holding the key is the
	// one form neither the selector nor the scan can follow, and an example
	// of it in the tree is a worked answer for evading both.
	//
	// Written in POSIX classes because git's -E does not read \s or \w, and
	// a pattern it cannot read matches nothing and reports a clean tree.
	// The grep runs over tracked files, so the check follows the repository
	// rather than the working directory.
	const heldKey = (value: string): string =>
		'^[[:space:]]*(const|let|var)[[:space:]]+[[:alnum:]_]+[[:space:]]*' +
		`=[[:space:]]*['"\`]${value}['"\`]`;

	/** A constant of the shape the ban looks for, holding something else. */
	const CONTROL = 'not-a-key-at-all';

	it('is written nowhere in the repository', () => {
		const held = spawnSync('git', ['grep', '-nE', heldKey('fetch')], {
			encoding: 'utf8',
		});
		expect(held.stdout).toBe('');
	});

	// The negative above is worth having only if the pattern can find a
	// constant at all, which the same engine is asked here: the line
	// declaring the control above is one, and this must find it.
	it('finds a constant of that shape when there is one', () => {
		const found = spawnSync('git', ['grep', '-nE', heldKey(CONTROL)], {
			encoding: 'utf8',
		});
		expect(found.stdout).toContain('fetch-guards.test.ts');
	});
});

describe('the bundle scan', () => {
	const script = fileURLToPath(
		new URL('../scripts/scan-bundle.mjs', import.meta.url),
	);

	/** One directory for every case, taken down when the block ends. */
	let directory = '';

	beforeAll(() => {
		directory = mkdtempSync(join(tmpdir(), 'davenport-scan-'));
	});

	afterAll(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	/** Runs the scan over a bundle holding this text. */
	function scan(bundle: string): { status: number | null; output: string } {
		const file = join(directory, 'bundle.js');
		writeFileSync(file, bundle, 'utf8');
		const result = spawnSync(process.execPath, [script, file], {
			encoding: 'utf8',
		});
		return { status: result.status, output: result.stdout + result.stderr };
	}

	it.each([
		['a bare call', 'fetch("https://a.test/");'],
		['a global member call', 'globalThis.fetch("https://a.test/");'],
		['a bracketed member call', 'self["fetch"]("https://a.test/");'],
		[
			'a Reflect.get call',
			'Reflect.get(globalThis,"fetch")("https://a.test/");',
		],
		['a Reflect.get read off a holder', "const f=Reflect.get(h,'fetch');"],
		['a templated key', 'const f=Reflect.get(h,`fetch`);'],
	])('fails a bundle carrying %s', (_name, bundle) => {
		const result = scan(bundle);
		expect(result.status).toBe(1);
		expect(result.output).toContain('direct fetch');
	});

	it('passes a bundle that reaches no fetch at all', () => {
		const result = scan(
			'const url=Reflect.get(input,"url");requestUrl({url});',
		);
		expect(result.status).toBe(0);
		expect(result.output).toContain('no direct fetch usage');
	});

	it('names the file it scanned as a path', () => {
		expect(scan('fetch("https://a.test/");').output).toContain(
			join(directory, 'bundle.js'),
		);
	});
});
