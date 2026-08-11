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
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { createJiti } from 'jiti';
import { beforeAll, describe, expect, it } from 'vitest';

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

		it('still refuses the member spellings', () => {
			expect(refused(name, MEMBER_CALL)).toHaveLength(1);
		});

		it('says nothing about Reflect.get reaching another property', () => {
			expect(refused(name, REFLECT_ELSEWHERE)).toEqual([]);
		});
	},
);

describe('the exemption the fetch poison tests carry', () => {
	it('covers that one file and nothing else', () => {
		expect(blockNamed('davenport/fetch-poison-reflect').files).toEqual([
			'test/harness/sweeps/fetch-poison.test.ts',
		]);
	});

	it('lets the Reflect spelling through and keeps the rest banned', () => {
		const name = 'davenport/fetch-poison-reflect';
		expect(refused(name, REFLECT_HOLDER)).toEqual([]);
		expect(refused(name, MEMBER_CALL)).toHaveLength(1);
	});
});

describe('the bundle scan', () => {
	const script = fileURLToPath(
		new URL('../scripts/scan-bundle.mjs', import.meta.url),
	);

	/** Runs the scan over a bundle holding this text. */
	function scan(bundle: string): { status: number | null; output: string } {
		const file = join(
			mkdtempSync(join(tmpdir(), 'davenport-scan-')),
			'b.js',
		);
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
});
