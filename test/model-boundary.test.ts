/**
 * The other folders of the engine import the domain types from
 * src/core/model/, and no file of the model imports anything from those
 * folders. One lint rule holds this direction: a file of the model imports a
 * module of the same folder, and no other module.
 *
 * This file tests that rule in the form that the repository configures. Each
 * test asks the lint configuration which import rule it gives to one file.
 * Each test then runs that rule over a source that such a file could hold. A
 * test asks the whole configuration, and not one block of the configuration.
 * A later block that takes the rule away therefore fails a test here.
 *
 * The tests hold three claims. The rule reports an import that names a
 * module outside the model. The rule reports nothing for an import that
 * names a module of the model. The rule refuses each module that the core
 * boundary refuses, because the rule of the model takes the place of the
 * rule that the core boundary sets.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/** The configuration that the resolver gives back for one file. */
interface ResolvedConfig {
	readonly rules?: Readonly<Record<string, unknown>>;
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MODEL = 'src/core/model';

/** A module of the model, which a file of the model can import. */
const SIBLING_TYPE = "import type { EventFields } from './event';";
const SIBLING_VALUE = "import { fields } from './event';";
const SIBLING_EXPORT = "export type { EventFields } from './event';";

/**
 * An import that names a module of the ICS folder of the engine. The rule
 * under test exists to report an import of this shape.
 */
const ENGINE_TYPE = "import type { NormalizationStamp } from '../ics/stamp';";
const ENGINE_VALUE = "import { stampFor } from '../ics/stamp';";
const ENGINE_EXPORT = "export type { NormalizationStamp } from '../ics/stamp';";
const ENGINE_ALL = "export * from '../ics/stamp';";
const ENGINE_SIDE_EFFECT = "import '../ics/stamp';";

/** A module of the engine that is not a module of the ICS folder. */
const PORT_TYPE = "import type { Clock } from '../ports/clock';";
const ADAPTER_TYPE = "import type { VaultFiles } from '../../adapters/vault';";
const NESTED = "import type { Piece } from './parts/piece';";

/** A module of a platform, which the core boundary refuses everywhere. */
const OBSIDIAN = "import { Notice } from 'obsidian';";
const ELECTRON = "import { app } from 'electron';";
const NODE_PREFIXED = "import { readFile } from 'node:fs';";
const NODE_BARE = "import { readFile } from 'fs';";

/** The import that a test file beside a model file needs. */
const VITEST = "import { describe, it } from 'vitest';";

/** An import that a file of the engine takes from the model. */
const MODEL_FROM_ENGINE =
	"import type { NormalizationStamp } from '../model/normalization';";

const linter = new Linter();
const eslint = new ESLint({ cwd: ROOT });

/** The source files of the model, without the test files beside them. */
const modelSources = readdirSync(join(ROOT, MODEL)).filter(
	(name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
);

function isRuleEntry(value: unknown): value is Linter.RuleEntry {
	return Array.isArray(value) && value.length > 0;
}

/** The import rule that the whole lint configuration gives to this file. */
async function importRule(path: string): Promise<Linter.RuleEntry> {
	const config = (await eslint.calculateConfigForFile(
		join(ROOT, path),
	)) as ResolvedConfig;
	const entry = config.rules?.['no-restricted-imports'];
	if (!isRuleEntry(entry)) {
		throw new Error(`the lint configuration gives ${path} no import rule`);
	}
	return entry;
}

/** The messages that this import rule reports over this source. */
function refused(rule: Linter.RuleEntry, code: string): string[] {
	const config: Linter.Config = {
		languageOptions: {
			parser: tseslint.parser,
			sourceType: 'module',
		},
		rules: { 'no-restricted-imports': rule },
	};
	return linter.verify(code, config).map((message) => message.message);
}

describe('the import rule of a file in the model', () => {
	let rule: Linter.RuleEntry;

	beforeAll(async () => {
		rule = await importRule(`${MODEL}/record.ts`);
	});

	it('reports an import of a module of the engine', () => {
		expect(refused(rule, ENGINE_TYPE)).toHaveLength(1);
	});

	it('names the folder and the rule in the message', () => {
		expect(refused(rule, ENGINE_TYPE)[0]).toContain(MODEL);
		expect(refused(rule, ENGINE_TYPE)[0]).toContain('same folder');
	});

	it.each([
		['a value import', ENGINE_VALUE],
		['a named export', ENGINE_EXPORT],
		['an export of everything', ENGINE_ALL],
		['an import for the side effect', ENGINE_SIDE_EFFECT],
	])('also reports the same module through %s', (_name, code) => {
		expect(refused(rule, code)).toHaveLength(1);
	});

	it.each([
		['a port', PORT_TYPE],
		['an adapter', ADAPTER_TYPE],
		['a folder under the model', NESTED],
	])('reports the import of %s', (_name, code) => {
		expect(refused(rule, code)).toHaveLength(1);
	});

	it.each([
		['a type', SIBLING_TYPE],
		['a value', SIBLING_VALUE],
		['an export', SIBLING_EXPORT],
	])('reports nothing for %s of a module of the model', (_name, code) => {
		expect(refused(rule, code)).toEqual([]);
	});
});

// The rule of the model takes the place of the rule that the core boundary
// gives to the same file. These tests hold that the model keeps each ban of
// the core boundary.
describe('the modules that the core boundary refuses', () => {
	let rule: Linter.RuleEntry;

	beforeAll(async () => {
		rule = await importRule(`${MODEL}/record.ts`);
	});

	it.each([
		['the Obsidian API', OBSIDIAN],
		['Electron', ELECTRON],
		['a node builtin with the prefix', NODE_PREFIXED],
		['a node builtin without the prefix', NODE_BARE],
	])('stay refused in the model: %s', (_name, code) => {
		expect(refused(rule, code)).toHaveLength(1);
	});
});

describe('the files that the rule covers', () => {
	it('covers every source file of the model', async () => {
		expect(modelSources.length).toBeGreaterThan(0);
		for (const name of modelSources) {
			const rule = await importRule(`${MODEL}/${name}`);
			expect(refused(rule, ENGINE_TYPE)).toHaveLength(1);
		}
	});

	it('leaves the engine free to read the model', async () => {
		const rule = await importRule('src/core/ics/stamp.ts');
		expect(refused(rule, MODEL_FROM_ENGINE)).toEqual([]);
	});

	it('leaves a test file beside a model file free to take its tools', async () => {
		const rule = await importRule(`${MODEL}/record.test.ts`);
		expect(refused(rule, VITEST)).toEqual([]);
	});
});
