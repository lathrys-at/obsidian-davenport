import { describe, expect, it } from 'vitest';
import type { VaultFileEvent } from '../../../src/core/ports/vault';
import { noteFixture } from '../fixtures/note-corpus';
import {
	CASE_INSENSITIVE_FILESYSTEM,
	FakeVault,
	type FilesystemProfile,
	NORMALIZING_FILESYSTEM,
	PERMISSIVE_FILESYSTEM,
	RESERVED_NAME_FILESYSTEM,
} from './index';

/** The name with the accent as one code point. */
const NFC_NAME = 'caf\u00e9.md';
/** The same name, with the letter e and a separate accent after it. */
const NFD_NAME = 'cafe\u0301.md';

const NOTE = noteFixture('minimal').content;

const setTitle = (frontmatter: Record<string, unknown>): void => {
	frontmatter.title = 'Changed';
};

interface ScriptRun {
	readonly outcomes: readonly string[];
	readonly events: readonly VaultFileEvent[];
	readonly paths: readonly string[];
	readonly snapshot: string;
}

type Step = (
	label: string,
	action: (vault: FakeVault) => Promise<unknown>,
) => Promise<void>;

type Script = (step: Step) => Promise<void>;

function outcomeOf(value: unknown): string {
	if (value === undefined) {
		return 'ok';
	}
	return JSON.stringify(value);
}

function refusalOf(error: unknown): string {
	return `refused: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Runs the script against a fresh vault on the given filesystem, and
 * reports what the run left behind. The report holds the result of each
 * step, the events, the paths, and the snapshot. A run against two
 * filesystems therefore compares as data.
 */
async function runScript(
	filesystem: FilesystemProfile,
	initialFiles: Readonly<Record<string, string>>,
	script: Script,
): Promise<ScriptRun> {
	let vault: FakeVault;
	try {
		vault = new FakeVault(initialFiles, filesystem);
	} catch (error) {
		return {
			outcomes: [`seed -> ${refusalOf(error)}`],
			events: [],
			paths: [],
			snapshot: '',
		};
	}
	const events: VaultFileEvent[] = [];
	const outcomes: string[] = [];
	vault.onFileEvent((event) => events.push(event));
	const step: Step = async (label, action) => {
		try {
			outcomes.push(`${label} -> ${outcomeOf(await action(vault))}`);
		} catch (error) {
			outcomes.push(`${label} -> ${refusalOf(error)}`);
		}
	};
	await script(step);
	return {
		outcomes,
		events,
		paths: vault.paths(),
		snapshot: vault.snapshot(),
	};
}

/**
 * Runs one script two times: on the given filesystem, and on the
 * permissive filesystem. The first report is the hostile run, and the
 * second report is the baseline.
 */
async function runBoth(
	filesystem: FilesystemProfile,
	initialFiles: Readonly<Record<string, string>>,
	script: Script,
): Promise<readonly [ScriptRun, ScriptRun]> {
	return [
		await runScript(filesystem, initialFiles, script),
		await runScript(PERMISSIVE_FILESYSTEM, initialFiles, script),
	];
}

const writeBothCases: Script = async (step) => {
	await step('write Note.md', (vault) => vault.write('Note.md', 'one'));
	await step('write note.md', (vault) => vault.write('note.md', 'two'));
	await step('read Note.md', (vault) => vault.read('Note.md'));
	await step('exists note.md', (vault) => vault.exists('note.md'));
};

const writeBothSpellings: Script = async (step) => {
	await step('write the NFC name', (vault) => vault.write(NFC_NAME, 'one'));
	await step('write the NFD name', (vault) => vault.write(NFD_NAME, 'two'));
	await step('read the NFC name', (vault) => vault.read(NFC_NAME));
	await step('exists the NFD name', (vault) => vault.exists(NFD_NAME));
};

const writeReservedName: Script = async (step) => {
	await step('write CON.md', (vault) => vault.write('CON.md', 'one'));
};

describe('the permissive filesystem is the default', () => {
	it('behaves the same with no profile as with the permissive profile', async () => {
		const script: Script = async (step) => {
			await step('write a.md', (vault) => vault.write('a.md', 'one'));
			await step('write a.md again', (vault) =>
				vault.write('a.md', 'two'),
			);
			await step('rename a.md', (vault) => vault.rename('a.md', 'b.md'));
			await step('trash b.md', (vault) => vault.trash('b.md'));
			await step('read b.md', (vault) => vault.read('b.md'));
		};
		const withProfile = await runScript(PERMISSIVE_FILESYSTEM, {}, script);
		const events: VaultFileEvent[] = [];
		const bare = new FakeVault();
		bare.onFileEvent((event) => events.push(event));
		const outcomes: string[] = [];
		const step: Step = async (label, action) => {
			try {
				outcomes.push(`${label} -> ${outcomeOf(await action(bare))}`);
			} catch (error) {
				outcomes.push(`${label} -> ${refusalOf(error)}`);
			}
		};
		await script(step);
		expect(outcomes).toEqual(withProfile.outcomes);
		expect(events).toEqual(withProfile.events);
		expect(bare.snapshot()).toBe(withProfile.snapshot);
	});
});

describe('each profile changes only the behavior that it names', () => {
	it('tells two spellings of one name apart on the case-insensitive filesystem', async () => {
		const [hostile, baseline] = await runBoth(
			CASE_INSENSITIVE_FILESYSTEM,
			{},
			writeBothSpellings,
		);
		expect(hostile.paths).toEqual(baseline.paths);
		expect(hostile.events).toEqual(baseline.events);
	});

	it('accepts a reserved name on the case-insensitive filesystem and on the normalizing filesystem', async () => {
		for (const filesystem of [
			CASE_INSENSITIVE_FILESYSTEM,
			NORMALIZING_FILESYSTEM,
		]) {
			const [hostile, baseline] = await runBoth(
				filesystem,
				{},
				writeReservedName,
			);
			expect(hostile.outcomes, filesystem.name).toEqual(
				baseline.outcomes,
			);
			expect(hostile.paths, filesystem.name).toEqual(['CON.md']);
		}
	});

	it('tells two names that differ in case apart on the reserved-name filesystem and on the normalizing filesystem', async () => {
		for (const filesystem of [
			RESERVED_NAME_FILESYSTEM,
			NORMALIZING_FILESYSTEM,
		]) {
			const [hostile, baseline] = await runBoth(
				filesystem,
				{},
				writeBothCases,
			);
			expect(hostile.outcomes, filesystem.name).toEqual(
				baseline.outcomes,
			);
			expect(hostile.paths, filesystem.name).toEqual([
				'Note.md',
				'note.md',
			]);
		}
	});

	it('tells two spellings of one name apart on the reserved-name filesystem', async () => {
		const [hostile, baseline] = await runBoth(
			RESERVED_NAME_FILESYSTEM,
			{},
			writeBothSpellings,
		);
		expect(hostile.outcomes).toEqual(baseline.outcomes);
		expect(hostile.paths).toHaveLength(2);
	});
});

describe('the case-insensitive filesystem', () => {
	it('puts two names that differ only in case on one file, and the permissive filesystem holds two files', async () => {
		const [hostile, baseline] = await runBoth(
			CASE_INSENSITIVE_FILESYSTEM,
			{},
			writeBothCases,
		);
		expect(hostile.paths).toEqual(['Note.md']);
		expect(hostile.events).toEqual([
			{ kind: 'created', path: 'Note.md' },
			{ kind: 'modified', path: 'Note.md' },
		]);
		expect(hostile.outcomes).toEqual([
			'write Note.md -> ok',
			'write note.md -> ok',
			'read Note.md -> "two"',
			'exists note.md -> true',
		]);
		expect(baseline.paths).toEqual(['Note.md', 'note.md']);
		expect(baseline.events).toEqual([
			{ kind: 'created', path: 'Note.md' },
			{ kind: 'created', path: 'note.md' },
		]);
		expect(baseline.outcomes).toEqual([
			'write Note.md -> ok',
			'write note.md -> ok',
			'read Note.md -> "one"',
			'exists note.md -> true',
		]);
	});

	it('reports a changed file when a write lands on a seeded file under another case', async () => {
		const script: Script = async (step) => {
			await step('write note.md', (vault) =>
				vault.write('note.md', 'two'),
			);
		};
		const [hostile, baseline] = await runBoth(
			CASE_INSENSITIVE_FILESYSTEM,
			{ 'Note.md': 'one' },
			script,
		);
		expect(hostile.events).toEqual([{ kind: 'modified', path: 'Note.md' }]);
		expect(hostile.paths).toEqual(['Note.md']);
		expect(baseline.events).toEqual([{ kind: 'created', path: 'note.md' }]);
		expect(baseline.paths).toEqual(['Note.md', 'note.md']);
	});

	it('reaches the seeded file through another case on every operation, and reports the spelling that created the file', async () => {
		const script: Script = async (step) => {
			await step('read NOTE.md', (vault) => vault.read('NOTE.md'));
			await step('exists NOTE.md', (vault) => vault.exists('NOTE.md'));
			await step('frontmatter NOTE.md', (vault) =>
				vault.frontmatter('NOTE.md'),
			);
			await step('update NOTE.md', (vault) =>
				vault.updateFrontmatter('NOTE.md', setTitle),
			);
			await step('trash NOTE.md', (vault) => vault.trash('NOTE.md'));
		};
		const [hostile, baseline] = await runBoth(
			CASE_INSENSITIVE_FILESYSTEM,
			{ 'Note.md': NOTE },
			script,
		);
		expect(hostile.events).toEqual([
			{ kind: 'modified', path: 'Note.md' },
			{ kind: 'deleted', path: 'Note.md' },
		]);
		expect(hostile.paths).toEqual([]);
		expect(baseline.events).toEqual([]);
		expect(baseline.paths).toEqual(['Note.md']);
		for (const outcome of baseline.outcomes) {
			expect(outcome).toMatch(/no file at NOTE\.md|-> false/);
		}
	});

	it('reports the stored spelling as the old path of a rename', async () => {
		const script: Script = async (step) => {
			await step('rename NOTE.md to Other.md', (vault) =>
				vault.rename('NOTE.md', 'Other.md'),
			);
		};
		const [hostile, baseline] = await runBoth(
			CASE_INSENSITIVE_FILESYSTEM,
			{ 'Note.md': 'one' },
			script,
		);
		expect(hostile.outcomes).toEqual(['rename NOTE.md to Other.md -> ok']);
		expect(hostile.events).toEqual([
			{ kind: 'renamed', path: 'Other.md', oldPath: 'Note.md' },
		]);
		expect(hostile.paths).toEqual(['Other.md']);
		expect(baseline.outcomes).toEqual([
			'rename NOTE.md to Other.md -> refused: fake vault: this vault holds no file at NOTE.md',
		]);
		expect(baseline.events).toEqual([]);
		expect(baseline.paths).toEqual(['Note.md']);
	});

	it('refuses a rename onto the stored spelling of the same file', async () => {
		const cases: readonly (readonly [FilesystemProfile, string, string])[] =
			[
				[CASE_INSENSITIVE_FILESYSTEM, 'Note.md', 'NOTE.md'],
				[NORMALIZING_FILESYSTEM, NFC_NAME, NFD_NAME],
			];
		for (const [filesystem, stored, other] of cases) {
			const script: Script = async (step) => {
				await step('rename onto the stored spelling', (vault) =>
					vault.rename(other, stored),
				);
			};
			const [hostile, baseline] = await runBoth(
				filesystem,
				{ [stored]: 'one' },
				script,
			);
			expect(hostile.outcomes, filesystem.name).toEqual([
				`rename onto the stored spelling -> refused: fake vault: the new path is the same path as the old path: ${other}`,
			]);
			expect(hostile.events, filesystem.name).toEqual([]);
			expect(baseline.outcomes, filesystem.name).toEqual([
				`rename onto the stored spelling -> refused: fake vault: this vault holds no file at ${other}`,
			]);
		}
	});

	it('refuses a rename where the two paths are the same string, on every filesystem', async () => {
		const cases: readonly (readonly [FilesystemProfile, string, string])[] =
			[
				[CASE_INSENSITIVE_FILESYSTEM, 'Note.md', 'note.md'],
				[NORMALIZING_FILESYSTEM, NFC_NAME, NFD_NAME],
				[RESERVED_NAME_FILESYSTEM, 'Note.md', 'Note.md'],
				[PERMISSIVE_FILESYSTEM, 'Note.md', 'Note.md'],
			];
		for (const [filesystem, stored, requested] of cases) {
			const run = await runScript(
				filesystem,
				{ [stored]: 'one' },
				async (step) => {
					await step('rename to the same string', (vault) =>
						vault.rename(requested, requested),
					);
				},
			);
			expect(run.outcomes, filesystem.name).toEqual([
				`rename to the same string -> refused: fake vault: the new path is the same path as the old path: ${requested}`,
			]);
			expect(run.events, filesystem.name).toEqual([]);
		}
	});

	it('refuses a rename onto a name that another file holds under another case', async () => {
		const script: Script = async (step) => {
			await step('rename a.md to b.md', (vault) =>
				vault.rename('a.md', 'b.md'),
			);
		};
		const [hostile, baseline] = await runBoth(
			CASE_INSENSITIVE_FILESYSTEM,
			{ 'a.md': 'one', 'B.md': 'two' },
			script,
		);
		expect(hostile.outcomes).toEqual([
			'rename a.md to b.md -> refused: fake vault: the rename target exists: b.md',
		]);
		expect(hostile.events).toEqual([]);
		expect(hostile.paths).toEqual(['B.md', 'a.md']);
		expect(baseline.paths).toEqual(['B.md', 'b.md']);
		expect(baseline.events).toEqual([
			{ kind: 'renamed', path: 'b.md', oldPath: 'a.md' },
		]);
	});

	it('refuses a rename that changes only the case, and accepts the same change through a third name', async () => {
		const script: Script = async (step) => {
			await step('rename note.md to Note.md', (vault) =>
				vault.rename('note.md', 'Note.md'),
			);
			await step('rename note.md to temp.md', (vault) =>
				vault.rename('note.md', 'temp.md'),
			);
			await step('rename temp.md to Note.md', (vault) =>
				vault.rename('temp.md', 'Note.md'),
			);
		};
		const [hostile, baseline] = await runBoth(
			CASE_INSENSITIVE_FILESYSTEM,
			{ 'note.md': 'one' },
			script,
		);
		expect(hostile.outcomes).toEqual([
			'rename note.md to Note.md -> refused: fake vault: the rename target exists: Note.md',
			'rename note.md to temp.md -> ok',
			'rename temp.md to Note.md -> ok',
		]);
		expect(hostile.events).toEqual([
			{ kind: 'renamed', path: 'temp.md', oldPath: 'note.md' },
			{ kind: 'renamed', path: 'Note.md', oldPath: 'temp.md' },
		]);
		expect(baseline.outcomes).toEqual([
			'rename note.md to Note.md -> ok',
			'rename note.md to temp.md -> refused: fake vault: this vault holds no file at note.md',
			'rename temp.md to Note.md -> refused: fake vault: this vault holds no file at temp.md',
		]);
		expect(baseline.events).toEqual([
			{ kind: 'renamed', path: 'Note.md', oldPath: 'note.md' },
		]);
		expect(hostile.paths).toEqual(['Note.md']);
		expect(baseline.paths).toEqual(['Note.md']);
	});

	it('refuses two seeded names that differ only in case, and the permissive filesystem accepts both', async () => {
		const [hostile, baseline] = await runBoth(
			CASE_INSENSITIVE_FILESYSTEM,
			{ 'Note.md': 'one', 'note.md': 'two' },
			async (step) => {
				await step('read Note.md', (vault) => vault.read('Note.md'));
			},
		);
		expect(hostile.outcomes).toEqual([
			'seed -> refused: fake vault: this filesystem uses one name for Note.md and for note.md',
		]);
		expect(baseline.paths).toEqual(['Note.md', 'note.md']);
	});
});

const reservedDevice = (name: string): string =>
	`Windows reserves the name "${name}" for a device`;

const REFUSED_NAMES: readonly (readonly [string, string])[] = [
	['CON.md', reservedDevice('CON')],
	['con.md', reservedDevice('CON')],
	['NUL', reservedDevice('NUL')],
	['PRN.md', reservedDevice('PRN')],
	['AUX.md', reservedDevice('AUX')],
	['COM1.md', reservedDevice('COM1')],
	['COM9.md', reservedDevice('COM9')],
	['COM\u00b9.md', reservedDevice('COM\u00b9')],
	['COM\u00b2.md', reservedDevice('COM\u00b2')],
	['COM\u00b3.md', reservedDevice('COM\u00b3')],
	['LPT1.md', reservedDevice('LPT1')],
	['LPT9.md', reservedDevice('LPT9')],
	['LPT\u00b9.md', reservedDevice('LPT\u00b9')],
	['LPT\u00b2.md', reservedDevice('LPT\u00b2')],
	['LPT\u00b3.md', reservedDevice('LPT\u00b3')],
	['CON.md.bak', reservedDevice('CON')],
	['notes/CON.md', reservedDevice('CON')],
	['AUX/notes.md', reservedDevice('AUX')],
	['notes.', 'the part "notes." ends with a dot'],
	['notes/note.md.', 'the part "note.md." ends with a dot'],
	['note.md ', 'the part "note.md " ends with a space'],
	['notes /note.md', 'the part "notes " ends with a space'],
];

const ACCEPTED_NAMES: readonly string[] = [
	'CONSOLE.md',
	'COM0.md',
	'com10.md',
	'LPT.md',
	'notes/con-man.md',
	'a.CON.md',
	' note.md',
	'note..md',
	'.hidden.md',
	'.',
	'..',
	'./a.md',
	'a/../b.md',
];

const RELATIVE_NAMES: readonly string[] = ['.', '..', './a.md', 'a/../b.md'];

describe('the reserved-name filesystem', () => {
	it('refuses each name that Windows reserves, and the permissive filesystem accepts each one', async () => {
		const script: Script = async (step) => {
			for (const [name] of REFUSED_NAMES) {
				await step(`write ${name}`, (vault) =>
					vault.write(name, 'one'),
				);
			}
		};
		const [hostile, baseline] = await runBoth(
			RESERVED_NAME_FILESYSTEM,
			{},
			script,
		);
		expect(hostile.outcomes).toEqual(
			REFUSED_NAMES.map(
				([name, reason]) =>
					`write ${name} -> refused: fake vault: ${reason}: ${name}`,
			),
		);
		expect(hostile.events).toEqual([]);
		expect(hostile.paths).toEqual([]);
		expect(baseline.outcomes).toEqual(
			REFUSED_NAMES.map(([name]) => `write ${name} -> ok`),
		);
		expect(baseline.paths).toHaveLength(REFUSED_NAMES.length);
	});

	it('accepts a name that only looks like a name that Windows reserves', async () => {
		const script: Script = async (step) => {
			for (const name of ACCEPTED_NAMES) {
				await step(`write ${name}`, (vault) =>
					vault.write(name, 'one'),
				);
			}
		};
		const [hostile, baseline] = await runBoth(
			RESERVED_NAME_FILESYSTEM,
			{},
			script,
		);
		expect(hostile.outcomes).toEqual(baseline.outcomes);
		expect(hostile.paths).toEqual(baseline.paths);
		expect(hostile.paths).toHaveLength(ACCEPTED_NAMES.length);
	});

	it('accepts the parts "." and ".." in a path, on both filesystems', async () => {
		const script: Script = async (step) => {
			for (const name of RELATIVE_NAMES) {
				await step(`write ${name}`, (vault) =>
					vault.write(name, 'one'),
				);
				await step(`read ${name}`, (vault) => vault.read(name));
			}
		};
		const [hostile, baseline] = await runBoth(
			RESERVED_NAME_FILESYSTEM,
			{},
			script,
		);
		expect(hostile.outcomes).toEqual(baseline.outcomes);
		expect(hostile.outcomes).toHaveLength(RELATIVE_NAMES.length * 2);
		for (const outcome of hostile.outcomes) {
			expect(outcome).not.toContain('refused');
		}
		expect(hostile.paths).toEqual(['.', '..', './a.md', 'a/../b.md']);
		expect(hostile.events).toEqual(baseline.events);
	});

	it('reports the first problem in the path, from left to right', async () => {
		const cases: readonly (readonly [string, string])[] = [
			['notes./CON.md', 'the part "notes." ends with a dot'],
			['a /CON.md', 'the part "a " ends with a space'],
			['CON.md/a ', reservedDevice('CON')],
			['NUL.', 'the part "NUL." ends with a dot'],
		];
		const script: Script = async (step) => {
			for (const [name] of cases) {
				await step(`write ${name}`, (vault) =>
					vault.write(name, 'one'),
				);
			}
		};
		const hostile = await runScript(RESERVED_NAME_FILESYSTEM, {}, script);
		expect(hostile.outcomes).toEqual(
			cases.map(
				([name, reason]) =>
					`write ${name} -> refused: fake vault: ${reason}: ${name}`,
			),
		);
	});

	it('refuses the reserved name on every path that reaches the vault', async () => {
		const script: Script = async (step) => {
			await step('write CON.md', (vault) => vault.write('CON.md', 'one'));
			await step('read CON.md', (vault) => vault.read('CON.md'));
			await step('exists CON.md', (vault) => vault.exists('CON.md'));
			await step('frontmatter CON.md', (vault) =>
				vault.frontmatter('CON.md'),
			);
			await step('update CON.md', (vault) =>
				vault.updateFrontmatter('CON.md', setTitle),
			);
			await step('rename note.md to CON.md', (vault) =>
				vault.rename('note.md', 'CON.md'),
			);
			await step('rename CON.md to note.md', (vault) =>
				vault.rename('CON.md', 'note.md'),
			);
			await step('trash CON.md', (vault) => vault.trash('CON.md'));
		};
		const [hostile, baseline] = await runBoth(
			RESERVED_NAME_FILESYSTEM,
			{ 'note.md': NOTE },
			script,
		);
		for (const outcome of hostile.outcomes) {
			expect(outcome).toContain(
				`refused: fake vault: ${reservedDevice('CON')}: CON.md`,
			);
		}
		expect(hostile.outcomes).toHaveLength(8);
		expect(hostile.events).toEqual([]);
		expect(hostile.paths).toEqual(['note.md']);
		expect(baseline.paths).toEqual(['note.md']);
		expect(baseline.events).toEqual([
			{ kind: 'created', path: 'CON.md' },
			{ kind: 'modified', path: 'CON.md' },
			{ kind: 'deleted', path: 'CON.md' },
		]);
		expect(baseline.outcomes).toEqual([
			'write CON.md -> ok',
			'read CON.md -> "one"',
			'exists CON.md -> true',
			'frontmatter CON.md -> null',
			'update CON.md -> ok',
			'rename note.md to CON.md -> refused: fake vault: the rename target exists: CON.md',
			'rename CON.md to note.md -> refused: fake vault: the rename target exists: note.md',
			'trash CON.md -> ok',
		]);
	});

	it('refuses a seeded reserved name, and the permissive filesystem accepts it', async () => {
		const [hostile, baseline] = await runBoth(
			RESERVED_NAME_FILESYSTEM,
			{ 'notes/COM3.md': 'one' },
			async (step) => {
				await step('paths', (vault) =>
					Promise.resolve(vault.paths().join(',')),
				);
			},
		);
		expect(hostile.outcomes).toEqual([
			`seed -> refused: fake vault: ${reservedDevice('COM3')}: notes/COM3.md`,
		]);
		expect(baseline.paths).toEqual(['notes/COM3.md']);
	});
});

describe('the normalizing filesystem', () => {
	it('has two names for this test that hold different code points', () => {
		expect(NFD_NAME).not.toBe(NFC_NAME);
		expect(NFD_NAME).toHaveLength(NFC_NAME.length + 1);
		expect(NFD_NAME.normalize('NFC')).toBe(NFC_NAME);
	});

	it('puts the NFC spelling and the NFD spelling of one name on one file, and the permissive filesystem holds two files', async () => {
		const [hostile, baseline] = await runBoth(
			NORMALIZING_FILESYSTEM,
			{},
			writeBothSpellings,
		);
		expect(hostile.paths).toEqual([NFC_NAME]);
		expect(hostile.events).toEqual([
			{ kind: 'created', path: NFC_NAME },
			{ kind: 'modified', path: NFC_NAME },
		]);
		expect(hostile.outcomes).toEqual([
			'write the NFC name -> ok',
			'write the NFD name -> ok',
			'read the NFC name -> "two"',
			'exists the NFD name -> true',
		]);
		expect(baseline.paths).toEqual([NFD_NAME, NFC_NAME]);
		expect(baseline.events).toEqual([
			{ kind: 'created', path: NFC_NAME },
			{ kind: 'created', path: NFD_NAME },
		]);
		expect(baseline.outcomes).toEqual([
			'write the NFC name -> ok',
			'write the NFD name -> ok',
			'read the NFC name -> "one"',
			'exists the NFD name -> true',
		]);
	});

	it('keeps the spelling that created the file, and reads and writes through both spellings', async () => {
		const script: Script = async (step) => {
			await step('write the NFD name', (vault) =>
				vault.write(NFD_NAME, NOTE),
			);
			await step('read the NFC name', (vault) => vault.read(NFC_NAME));
			await step('update through NFC', (vault) =>
				vault.updateFrontmatter(NFC_NAME, setTitle),
			);
			await step('frontmatter through NFC', (vault) =>
				vault.frontmatter(NFC_NAME),
			);
			await step('frontmatter through NFD', (vault) =>
				vault.frontmatter(NFD_NAME),
			);
		};
		const hostile = await runScript(NORMALIZING_FILESYSTEM, {}, script);
		expect(hostile.paths).toEqual([NFD_NAME]);
		expect(hostile.paths[0]).not.toBe(NFC_NAME);
		expect(hostile.events).toEqual([
			{ kind: 'created', path: NFD_NAME },
			{ kind: 'modified', path: NFD_NAME },
		]);
		const throughNfc = hostile.outcomes[3]?.split(' -> ')[1];
		const throughNfd = hostile.outcomes[4]?.split(' -> ')[1];
		expect(throughNfd).toBe(throughNfc);
		expect(throughNfd).toContain('"title":"Changed"');
	});

	it('refuses a rename onto the other spelling of a name that a file holds', async () => {
		const script: Script = async (step) => {
			await step('rename plain.md to the NFD name', (vault) =>
				vault.rename('plain.md', NFD_NAME),
			);
		};
		const [hostile, baseline] = await runBoth(
			NORMALIZING_FILESYSTEM,
			{ [NFC_NAME]: 'one', 'plain.md': 'two' },
			script,
		);
		expect(hostile.outcomes).toEqual([
			`rename plain.md to the NFD name -> refused: fake vault: the rename target exists: ${NFD_NAME}`,
		]);
		expect(hostile.events).toEqual([]);
		expect(hostile.paths).toEqual([NFC_NAME, 'plain.md']);
		expect(baseline.paths).toEqual([NFD_NAME, NFC_NAME]);
	});

	it('refuses a rename between the two spellings of one name, and accepts the same change through a third name', async () => {
		const script: Script = async (step) => {
			await step('rename NFC to NFD', (vault) =>
				vault.rename(NFC_NAME, NFD_NAME),
			);
			await step('rename NFC to temp.md', (vault) =>
				vault.rename(NFC_NAME, 'temp.md'),
			);
			await step('rename temp.md to NFD', (vault) =>
				vault.rename('temp.md', NFD_NAME),
			);
		};
		const [hostile, baseline] = await runBoth(
			NORMALIZING_FILESYSTEM,
			{ [NFC_NAME]: 'one' },
			script,
		);
		expect(hostile.outcomes).toEqual([
			`rename NFC to NFD -> refused: fake vault: the rename target exists: ${NFD_NAME}`,
			'rename NFC to temp.md -> ok',
			'rename temp.md to NFD -> ok',
		]);
		expect(hostile.events).toEqual([
			{ kind: 'renamed', path: 'temp.md', oldPath: NFC_NAME },
			{ kind: 'renamed', path: NFD_NAME, oldPath: 'temp.md' },
		]);
		expect(baseline.outcomes).toEqual([
			'rename NFC to NFD -> ok',
			`rename NFC to temp.md -> refused: fake vault: this vault holds no file at ${NFC_NAME}`,
			'rename temp.md to NFD -> refused: fake vault: this vault holds no file at temp.md',
		]);
		expect(baseline.events).toEqual([
			{ kind: 'renamed', path: NFD_NAME, oldPath: NFC_NAME },
		]);
		expect(hostile.paths).toEqual([NFD_NAME]);
		expect(baseline.paths).toEqual([NFD_NAME]);
	});

	it('refuses two seeded spellings of one name, and the permissive filesystem accepts both', async () => {
		const [hostile, baseline] = await runBoth(
			NORMALIZING_FILESYSTEM,
			{ [NFC_NAME]: 'one', [NFD_NAME]: 'two' },
			async (step) => {
				await step('read the NFC name', (vault) =>
					vault.read(NFC_NAME),
				);
			},
		);
		expect(hostile.outcomes).toEqual([
			`seed -> refused: fake vault: this filesystem uses one name for ${NFC_NAME} and for ${NFD_NAME}`,
		]);
		expect(baseline.paths).toHaveLength(2);
	});
});
