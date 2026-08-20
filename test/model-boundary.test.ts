/**
 * The other folders of the engine import the domain types from
 * src/core/model/, and no file of the model imports anything from those
 * folders. Two patterns of one lint rule hold this direction. The first
 * permits a specifier of the form `./name` and refuses every other form. The
 * second refuses a name of one dot and a name of two dots, which have that
 * form and spell a folder. A specifier that both patterns permit therefore
 * spells a path inside src/core/model/. Such a specifier names a file of the
 * same folder, or it names a folder of the same folder, and the index file
 * of that folder then loads.
 *
 * This file tests that rule in the form that the repository configures. Each
 * test asks the lint configuration which import rule it gives to one file.
 * Each test then runs that rule over a source that such a file could hold. A
 * test asks the whole configuration, and not one block of the configuration.
 * A later block that takes the rule away therefore fails a test here.
 *
 * The tests hold four claims. The rule reports an import that names a module
 * outside the model. The rule reports nothing for an import that stays
 * inside the model. The rule refuses each module that the core boundary
 * refuses, because the rule of the model takes the place of the rule that
 * the core boundary sets. The message of the rule gives the correct remedy
 * for a module of the engine and for a module of a platform.
 */

import { existsSync, readdirSync } from 'node:fs';
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
/** The file of the engine that the one-way test reads the rule for. */
const ENGINE_FILE = 'src/core/ics/stamp.ts';

/** A specifier of the allowed form, which names a file of the same folder. */
const SIBLING_TYPE = "import type { EventFields } from './event';";
const SIBLING_VALUE = "import { fields } from './event';";
const SIBLING_EXPORT = "export type { EventFields } from './event';";

/**
 * A specifier of the allowed form, which names a folder of the same folder.
 * The index file of that folder loads in place of it. A lint rule reads the
 * text of a specifier and cannot read the disk, so the rule cannot tell this
 * specifier from the one above.
 */
const SIBLING_FOLDER = "import type { Piece } from './parts';";

/**
 * A specifier of one segment whose segment is one dot. It spells the folder
 * of the file itself. The second pattern refuses it.
 */
const OWN_FOLDER = "import type { Inside } from './.';";

/**
 * A specifier of one segment whose segment is two dots. It spells the folder
 * above src/core/model/, and the index file of that folder loads. The second
 * pattern refuses it.
 */
const PARENT_FOLDER = "import type { Escaped } from './..';";

/**
 * A file name that starts with two dots. The second pattern must leave this
 * name alone, because the name does not spell a folder.
 */
const DOTTED_NAME = "import type { X } from './..foo';";

/**
 * An import that names a module of the ICS folder of the engine. The rule
 * under test exists to report an import of this shape.
 */
const ENGINE_TYPE = "import type { NormalizationStamp } from '../ics/stamp';";
const ENGINE_VALUE = "import { stampFor } from '../ics/stamp';";
const ENGINE_EXPORT = "export type { NormalizationStamp } from '../ics/stamp';";
const ENGINE_ALL = "export * from '../ics/stamp';";
const ENGINE_SIDE_EFFECT = "import '../ics/stamp';";
const ENGINE_EQUALS = "import stamp = require('../ics/stamp');";

/** A module of the engine that is not a module of the ICS folder. */
const PORT_TYPE = "import type { Clock } from '../ports/clock';";
const ADAPTER_TYPE = "import type { VaultFiles } from '../../adapters/vault';";
const NESTED = "import type { Piece } from './parts/piece';";

/**
 * A module of the model, which this specifier reaches through the parent
 * folder. The rule permits one spelling, and this is not that spelling.
 */
const PARENT_TO_MODEL = "import type { EventFields } from '../model/event';";

/** A module of a platform, which the core boundary refuses everywhere. */
const OBSIDIAN = "import { Notice } from 'obsidian';";
const ELECTRON = "import { app } from 'electron';";
const NODE_PREFIXED = "import { readFile } from 'node:fs';";
const NODE_BARE = "import { readFile } from 'fs';";

/** The imports that a test file beside a model file can hold. */
const VITEST = "import { describe, it } from 'vitest';";

/** An import that a file of the engine takes from the model. */
const MODEL_FROM_ENGINE =
	"import type { NormalizationStamp } from '../model/normalization';";

const linter = new Linter();
const eslint = new ESLint({ cwd: ROOT });

/**
 * The source files of the model, at any depth, without the test files beside
 * them. The read is recursive, so a file in a folder under the model counts.
 */
const modelSources = readdirSync(join(ROOT, MODEL), { recursive: true }).filter(
	(name) =>
		typeof name === 'string' &&
		name.endsWith('.ts') &&
		!name.endsWith('.test.ts'),
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

	it.each([
		['a value import', ENGINE_VALUE],
		['a named export', ENGINE_EXPORT],
		['an export of everything', ENGINE_ALL],
		['an import for the side effect', ENGINE_SIDE_EFFECT],
		['an import that stands for a call of require', ENGINE_EQUALS],
	])('also reports the same module through %s', (_name, code) => {
		expect(refused(rule, code)).toHaveLength(1);
	});

	it.each([
		['a port', PORT_TYPE],
		['an adapter', ADAPTER_TYPE],
		['a folder under the model', NESTED],
		['a module of the model through the parent folder', PARENT_TO_MODEL],
		['the folder above the model, through the allowed form', PARENT_FOLDER],
		['the model folder itself, through the allowed form', OWN_FOLDER],
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

	// A lint rule reads the text of a specifier. It cannot read the disk, so
	// it cannot tell a file of the same folder from a folder of the same
	// folder. The rule permits both, and the module that loads for the
	// second is the index file of that folder. That file is inside
	// src/core/model/, so the direction of the dependency holds. This test
	// records the behaviour as a decision.
	it('reports nothing for a folder of the model that loads its index file', () => {
		expect(refused(rule, SIBLING_FOLDER)).toEqual([]);
	});

	// The second pattern refuses a name of one dot and a name of two dots. A
	// file name that starts with two dots is a name and not a folder, so the
	// pattern must leave it alone.
	it('reports nothing for a file name that starts with two dots', () => {
		expect(refused(rule, DOTTED_NAME)).toEqual([]);
	});

	// The two patterns give two different messages. A specifier that spells
	// a folder gets the message of the second pattern, which names both
	// forms that spell a folder.
	it('names the folder forms in the message of the second pattern', () => {
		const message = refused(rule, PARENT_FOLDER)[0];
		expect(message).toContain("'./..'");
		expect(message).toContain("'./.'");
	});
});

// The rule of the model takes the place of the rule that the core boundary
// gives to the same file. These tests hold that the model keeps each ban of
// the core boundary, and that the message keeps the remedy that a platform
// import needs.
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

	// A count of the errors cannot see the text of an error. The remedy for
	// a module of a platform is a port, and the remedy for a module of the
	// engine is a move into the model. One message carries both, so this
	// test reads the message itself.
	it('sends a platform import to a port, and not into the model', () => {
		const message = refused(rule, OBSIDIAN)[0];
		expect(message).toContain('src/adapters/');
		expect(message).toContain('port');
	});

	it('sends an engine import into the model, and names the allowed form', () => {
		const message = refused(rule, ENGINE_TYPE)[0];
		expect(message).toContain(MODEL);
		expect(message).toContain("'./name'");
	});
});

describe('the files that the rule covers', () => {
	it('covers every source file of the model', async () => {
		expect(modelSources.length).toBeGreaterThan(0);
		for (const name of modelSources) {
			const rule = await importRule(join(MODEL, String(name)));
			expect(refused(rule, ENGINE_TYPE)).toHaveLength(1);
		}
	});

	// The resolver answers for a path, and it does not read the file at that
	// path. A test that names a path which no longer exists would therefore
	// pass and hold nothing.
	it('leaves the engine free to read the model', async () => {
		expect(existsSync(join(ROOT, ENGINE_FILE))).toBe(true);
		const rule = await importRule(ENGINE_FILE);
		expect(refused(rule, MODEL_FROM_ENGINE)).toEqual([]);
	});

	// The exemption for a test file drops the whole rule, and not the
	// imports of the test tools alone. These two imports record that
	// decision. A test file is not part of the engine, so an import in a
	// test file makes no dependency between the folders.
	it.each([
		['the test tools', VITEST],
		['a module of another folder of the engine', ENGINE_TYPE],
	])(
		'leaves a test file beside a model file free to import %s',
		async (_name, code) => {
			const rule = await importRule(`${MODEL}/record.test.ts`);
			expect(refused(rule, code)).toEqual([]);
		},
	);
});
