/**
 * The decisions behind the QA vault script:
 *
 * - the names that the script accepts, and the names that it draws;
 * - the verdict that it reaches on a probe already installed in a vault;
 * - what it makes of a vault that it walked;
 * - what it makes of a probe build that did not end with the status 0;
 * - the wording that it prints around all of that.
 *
 * The script itself only walks a tree and copies files. Therefore the module
 * beside it holds the answers, and these tests point at that module. A run
 * can end in two ways before it builds anything: the help text, and a
 * refused name. These tests exercise both ways as a process. The interface
 * includes the exit status and the single line of complaint, and not only
 * the words in that line.
 */

import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import {
	PROBE_FOLDER,
	RESULTS_NAME,
	resultsPath,
} from '../tools/frontmatter-probe/results';
import type { NameCheck } from '../scripts/vault-core';
import {
	NAME_LIMIT,
	WINDOWS_ABORT_STATUS,
	checkName,
	classifyInstall,
	generateName,
	isWindowsAbort,
	summarizeVault,
} from '../scripts/vault-core';
import {
	HELP,
	PROBE_ID,
	formatOutcome,
	probeBuildFailure,
	vaultReadme,
	vaultUri,
} from '../scripts/vault-text';
import type { GitHost } from './harness/run-git';
import { LS_FILES_ANSWERS, runGit } from './harness/run-git';
import type { ProcessResult } from './harness/run-node';
import {
	WINDOWS_ABORT_STATUS as HARNESS_ABORT_STATUS,
	isWindowsAbort as harnessIsWindowsAbort,
	runNode,
} from './harness/run-node';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const BUNDLE = bytes('the bundle');
const MANIFEST = bytes('{"id":"davenport-frontmatter-probe"}');

/** A build of two files, as the script reads a build back off the disk. */
const FRESH = new Map([
	['main.js', BUNDLE],
	['manifest.json', MANIFEST],
]);

/** A property of a parsed value. This does not assert what the value is. */
function reach(holder: unknown, property: string): unknown {
	return typeof holder === 'object' && holder !== null
		? Reflect.get(holder, property)
		: undefined;
}

/** The reason for a refusal. This also asserts that a refusal happened. */
function refusal(check: NameCheck): string {
	if (check.ok) {
		expect.fail(`the check accepted ${check.name}`);
	}
	return check.reason;
}

/** Randomness that a test can predict, so a test can assert a drawn name. */
function fixedRandom(...draws: number[]): () => number {
	let index = 0;
	return () => draws[index++] ?? 0;
}

/** A seeded source. It asks the generator for a great many names. */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

describe('what name a vault can have', () => {
	it.each(['quiet-copper-harbor', 'a', 'vault2', '2026-08-12'])(
		'accepts %s',
		(name) => {
			expect(checkName(name)).toEqual({ ok: true, name });
		},
	);

	it('refuses a name with no characters in it', () => {
		expect(checkName('')).toEqual({
			ok: false,
			reason: 'a vault name cannot be empty',
		});
	});

	it('names the characters that it refused, and the invisible ones too', () => {
		const reason = refusal(checkName('My Vault'));
		expect(reason).toContain('"M"');
		expect(reason).toContain('a space');
		expect(reason).toContain('"V"');
	});

	it.each(['under_score', 'dots.in.it', 'slash/es', 'accénted'])(
		'refuses %s',
		(name) => {
			expect(checkName(name).ok).toBe(false);
		},
	);

	it.each(['-leading', 'trailing-'])('refuses %s for its hyphen', (name) => {
		expect(refusal(checkName(name))).toContain(
			'starts and ends with a letter or a digit',
		);
	});

	it('refuses a name that is longer than the stated limit', () => {
		expect(checkName('a'.repeat(NAME_LIMIT)).ok).toBe(true);
		expect(checkName('a'.repeat(NAME_LIMIT + 1)).ok).toBe(false);
	});

	// The alphabet is the whole of the containment. The alphabet has no dot
	// and no separator. Therefore an accepted name cannot point to a
	// directory above the one that the script joins it onto.
	it('accepts no name that can point outside the vaults directory', () => {
		fc.assert(
			fc.property(fc.string(), (raw) => {
				const checked = checkName(raw);
				if (!checked.ok) {
					return;
				}
				expect(checked.name).toMatch(/^[a-z0-9-]+$/);
				expect(checked.name).not.toContain('..');
				expect(checked.name).not.toContain('/');
				expect(checked.name).not.toContain('\\');
			}),
		);
	});
});

describe('how the script draws a name for a vault', () => {
	it('draws two adjectives and a noun', () => {
		expect(generateName(fixedRandom(0, 0, 0))).toBe('amber-azure-anchor');
	});

	// The generator draws the second adjective from the words that the first
	// draw left. Therefore a source that always answers the same value still
	// cannot repeat a word.
	it('never repeats a word, whatever the draw gives', () => {
		for (const draw of [0, 0.25, 0.5, 0.999]) {
			const [first, second, noun] = generateName(() => draw).split('-');
			expect(first).not.toBe(second);
			expect(noun).toBeDefined();
		}
	});

	it('still gives words when the source answers outside the unit interval', () => {
		expect(generateName(() => 1)).toBe('winter-western-willow');
		expect(generateName(() => -1)).toBe('amber-azure-anchor');
		expect(generateName(() => Number.NaN)).toBe('amber-azure-anchor');
	});

	// Generation and validation are two halves of the same rule. If the check
	// refuses a drawn name, nobody can ask for that vault a second time.
	it('draws only the names that the check accepts', () => {
		const random = seededRandom(20260812);
		for (let draw = 0; draw < 2000; draw += 1) {
			const name = generateName(random);
			expect(checkName(name)).toEqual({ ok: true, name });
		}
	});
});

describe('whether the installed probe is the build beside it', () => {
	it('calls an empty plugin folder absent', () => {
		expect(classifyInstall(FRESH, new Map())).toEqual({
			state: 'absent',
			toWrite: ['main.js', 'manifest.json'],
		});
	});

	it('calls a matching copy current, with nothing to write', () => {
		expect(classifyInstall(FRESH, new Map(FRESH))).toEqual({
			state: 'current',
			toWrite: [],
		});
	});

	it('calls a byte that differs stale, and names only that file', () => {
		const installed = new Map(FRESH);
		installed.set('main.js', bytes('the bundle, once'));
		expect(classifyInstall(FRESH, installed)).toEqual({
			state: 'stale',
			toWrite: ['main.js'],
		});
	});

	it('sees a difference that does not change the number of bytes', () => {
		const installed = new Map(FRESH);
		installed.set('main.js', bytes('the bundlE'));
		expect(classifyInstall(FRESH, installed).state).toBe('stale');
	});

	// The script must not leave a copy that stopped halfway. Such a copy is
	// also not absent: a file is there, and it is the wrong file.
	it('calls a half-copied install stale, and not absent', () => {
		const installed = new Map([['manifest.json', MANIFEST]]);
		expect(classifyInstall(FRESH, installed)).toEqual({
			state: 'stale',
			toWrite: ['main.js'],
		});
	});
});

describe('what a walked vault adds up to', () => {
	const scan = {
		files: [
			'README.md',
			'.obsidian/app.json',
			'.obsidian/community-plugins.json',
			'.obsidian/plugins/davenport-frontmatter-probe/main.js',
			'frontmatter-probe/simple.md',
			'frontmatter-probe/emission-samples-20260811-091233Z.json',
			'frontmatter-probe/emission-samples-20260812-134501Z.json',
		],
		installedPlugins: ['davenport-frontmatter-probe'],
		enabledPlugins: ['davenport-frontmatter-probe'],
		unreadable: [],
	};

	// The question "what shape is this vault in" asks for the number of
	// notes. The configuration is machinery, and nobody wrote it by hand. A
	// count that adds the two together answers neither question.
	it('counts the vault apart from the configuration of the vault', () => {
		const report = summarizeVault(scan);
		expect(report.markdownFiles).toBe(2);
		expect(report.otherFiles).toBe(2);
		expect(report.configFiles).toBe(3);
	});

	it('carries the directories that it could not read', () => {
		const report = summarizeVault({
			...scan,
			unreadable: ['.obsidian/plugins/other', '.obsidian/themes'],
		});
		expect(report.unreadable).toEqual([
			'.obsidian/plugins/other',
			'.obsidian/themes',
		]);
	});

	it('says which installed plugins the vault enables', () => {
		expect(summarizeVault(scan).plugins).toEqual([
			{ id: 'davenport-frontmatter-probe', enabled: true },
		]);
	});

	it('calls an installed plugin not enabled when the list omits it', () => {
		const report = summarizeVault({ ...scan, enabledPlugins: [] });
		expect(report.plugins).toEqual([
			{ id: 'davenport-frontmatter-probe', enabled: false },
		]);
	});

	// A vault with no readable list enables no plugin. A list that enables no
	// plugin gets the same answer. That answer is correct in both cases.
	it('treats an absent list as a list that enables no plugin', () => {
		const report = summarizeVault({ ...scan, enabledPlugins: null });
		expect(report.plugins).toEqual([
			{ id: 'davenport-frontmatter-probe', enabled: false },
		]);
		expect(report.enabledWithoutFolder).toEqual([]);
	});

	it('names an enabled id that no installed folder supplies', () => {
		const report = summarizeVault({
			...scan,
			enabledPlugins: ['davenport-frontmatter-probe', 'something-else'],
		});
		expect(report.enabledWithoutFolder).toEqual(['something-else']);
	});

	it('lists the probe results newest first, and times them from their names', () => {
		expect(summarizeVault(scan).results).toEqual([
			{
				name: 'emission-samples-20260812-134501Z.json',
				timestamp: '2026-08-12 13:45:01Z',
			},
			{
				name: 'emission-samples-20260811-091233Z.json',
				timestamp: '2026-08-11 09:12:33Z',
			},
		]);
	});

	it('keeps a second run that happened in the same second', () => {
		const report = summarizeVault({
			...scan,
			files: [
				'frontmatter-probe/emission-samples-20260812-134501Z-2.json',
			],
		});
		expect(report.results).toEqual([
			{
				name: 'emission-samples-20260812-134501Z-2.json',
				timestamp: '2026-08-12 13:45:01Z',
			},
		]);
	});

	it.each([
		[
			'a results file outside the folder',
			'emission-samples-20260812-134501Z.json',
		],
		[
			'one nested below it',
			'frontmatter-probe/old/emission-samples-20260812-134501Z.json',
		],
		['another json in the folder', 'frontmatter-probe/notes.json'],
		['a note named like one', 'frontmatter-probe/emission-samples.md'],
	])('does not count %s', (_what, path) => {
		expect(summarizeVault({ ...scan, files: [path] }).results).toEqual([]);
	});
});

/**
 * The script reads the results files that the probe wrote. Both halves take
 * the folder and the naming from the results module of the probe. This keeps
 * both halves honest. These tests put a name from the writer back through
 * the pattern that the reader matches on. Therefore a rename on either side
 * fails here. It does not turn into a permanent `Probe results  none yet`.
 */
describe('the naming that the script and the probe share', () => {
	it('matches a name that the probe writes', () => {
		const written = resultsPath(
			PROBE_FOLDER,
			new Date('2026-08-12T13:45:01.000Z'),
			() => false,
		);
		expect(written.startsWith(`${PROBE_FOLDER}/`)).toBe(true);
		expect(RESULTS_NAME.test(basename(written))).toBe(true);
	});

	it('matches the name that a second run in the same second takes', () => {
		const taken = new Set<string>();
		const now = new Date('2026-08-12T13:45:01.000Z');
		const first = resultsPath(PROBE_FOLDER, now, (path) => taken.has(path));
		taken.add(first);
		const second = resultsPath(PROBE_FOLDER, now, (path) =>
			taken.has(path),
		);
		expect(second).not.toBe(first);
		expect(RESULTS_NAME.test(basename(second))).toBe(true);
	});

	// The reader also reaches the same file through the report that it builds.
	it('finds a written name when the report walks over it', () => {
		const written = resultsPath(
			PROBE_FOLDER,
			new Date('2026-08-12T13:45:01.000Z'),
			() => false,
		);
		const report = summarizeVault({
			files: [written],
			installedPlugins: [],
			enabledPlugins: [],
			unreadable: [],
		});
		expect(report.results).toEqual([
			{ name: basename(written), timestamp: '2026-08-12 13:45:01Z' },
		]);
	});
});

describe('the link that opens a vault again', () => {
	// The code must encode every value in the link, and this includes the
	// separators. Obsidian finds the most specific vault that holds the path.
	it('encodes the separators and the spaces in the path', () => {
		expect(vaultUri('/Users/ren/my vaults/quiet-harbor')).toBe(
			'obsidian://open?path=%2FUsers%2Fren%2Fmy%20vaults%2Fquiet-harbor',
		);
	});
});

describe('what the script prints', () => {
	const base = {
		name: 'quiet-copper-harbor',
		path: '/repo/.vaults/quiet-copper-harbor',
		created: true,
		laidOut: [],
		install: {
			state: 'absent' as const,
			toWrite: ['main.js', 'manifest.json'],
		},
		report: summarizeVault({
			files: ['README.md'],
			installedPlugins: ['davenport-frontmatter-probe'],
			enabledPlugins: ['davenport-frontmatter-probe'],
			unreadable: [],
		}),
		cliFound: false,
	};

	it('gives a new vault the first-open step that no script can do', () => {
		const printed = formatOutcome(base);
		expect(printed).toContain(
			'The script made the vault quiet-copper-harbor',
		);
		expect(printed).toContain('/repo/.vaults/quiet-copper-harbor');
		expect(printed).toContain('open it by hand one time');
		expect(printed).toContain('restricted mode');
		expect(printed).toContain(vaultUri(base.path));
	});

	it('does not repeat the first-open step for a vault that exists', () => {
		const printed = formatOutcome({
			...base,
			created: false,
			install: { state: 'current', toWrite: [] },
		});
		expect(printed).toContain('already exists');
		expect(printed).toContain('Probe          already current');
		expect(printed).not.toContain('open it by hand one time');
		expect(printed).toContain(vaultUri(base.path));
	});

	it('says which file a refresh rewrote', () => {
		const printed = formatOutcome({
			...base,
			created: false,
			install: { state: 'stale', toWrite: ['main.js'] },
		});
		expect(printed).toContain('refreshed, and the script rewrote main.js');
	});

	it('names both files when it installs the probe', () => {
		expect(formatOutcome(base)).toContain(
			'installed, and the script wrote main.js and manifest.json',
		);
	});

	// The command line of Obsidian takes a vault by name, and it knows
	// nothing of a vault that it has no record of. Therefore the script never
	// offers the command line as the way in. The link is the way in, and the
	// script offers the command line for the checks that come after.
	it('offers the command line only when a command line is there', () => {
		expect(formatOutcome(base)).not.toContain('obsidian vault=');
		const withCli = formatOutcome({ ...base, cliFound: true });
		expect(withCli).toContain('obsidian vault=quiet-copper-harbor plugins');
	});

	it('never offers the command line as the way to open a vault', () => {
		for (const created of [true, false]) {
			const printed = formatOutcome({ ...base, created, cliFound: true });
			const opening = printed.slice(
				printed.indexOf('Open the vault in Obsidian'),
			);
			expect(opening).toContain(`open '${vaultUri(base.path)}'`);
			expect(opening).not.toContain(
				'obsidian vault=quiet-copper-harbor\n',
			);
		}
	});

	it('reports the results files, and says so when there are none', () => {
		expect(formatOutcome(base)).toContain('Probe results  none yet');
		const withResults = formatOutcome({
			...base,
			report: summarizeVault({
				files: [
					'frontmatter-probe/emission-samples-20260812-134501Z.json',
					'frontmatter-probe/emission-samples-20260811-091233Z.json',
				],
				installedPlugins: [],
				enabledPlugins: [],
				unreadable: [],
			}),
		});
		expect(withResults).toContain(
			'emission-samples-20260812-134501Z.json (2026-08-12 13:45:01Z)',
		);
		expect(withResults).toContain(
			'emission-samples-20260811-091233Z.json (2026-08-11 09:12:33Z)',
		);
	});

	// The results files hang under their own label. Therefore a row that
	// comes after them cannot land in the middle of the list.
	it('keeps the results together when it could not read a directory', () => {
		const printed = formatOutcome({
			...base,
			report: summarizeVault({
				files: [
					'frontmatter-probe/emission-samples-20260812-134501Z.json',
					'frontmatter-probe/emission-samples-20260811-091233Z.json',
				],
				installedPlugins: [],
				enabledPlugins: [],
				unreadable: ['.obsidian/plugins/other'],
			}),
		});
		const lines = printed.split('\n');
		const at = lines.findIndex((line) => line.includes('Probe results'));
		expect(lines[at]).toContain('emission-samples-20260812-134501Z.json');
		expect(lines[at + 1]).toContain(
			'emission-samples-20260811-091233Z.json',
		);
		expect(lines[at + 2]).toContain('Could not read');
		expect(lines[at + 2]).toContain('.obsidian/plugins/other');
	});

	it('says what a repair added to a vault that already existed', () => {
		const printed = formatOutcome({
			...base,
			created: false,
			laidOut: ['.obsidian/app.json', '.obsidian/community-plugins.json'],
		});
		expect(printed).toContain(
			'Added          .obsidian/app.json and .obsidian/community-plugins.json',
		);
		// This run wrote the plugin list into the vault. Therefore nobody
		// opened that vault with the probe in it before, and the vault gets
		// the steps that a new vault gets.
		expect(printed).toContain('open it by hand one time');
	});

	it('says nothing about a repair when there was nothing to repair', () => {
		expect(formatOutcome({ ...base, created: false })).not.toContain(
			'Added',
		);
	});

	it('tells the person who opens the vault which command to run', () => {
		const note = vaultReadme('quiet-copper-harbor');
		expect(note).toContain('quiet-copper-harbor');
		expect(note).toContain('Run frontmatter probe');
		expect(note).toContain('frontmatter-probe/');
		expect(note).toContain('Settings → Community plugins');
	});
});

describe('what the script says about a build that did not pass', () => {
	it('names the status of a build that failed', () => {
		const said = probeBuildFailure(1, 'linux');
		expect(said).toContain('the probe build failed with the status 1');
		expect(said).toContain('the output of the build is above');
	});

	// A signal that stops the build takes the status away, and the build
	// then wrote no status. A message that names a status here would state a
	// mechanism that did not happen. The word null would also reach a reader
	// who runs a command and does not read this code.
	it('names the signal that stopped a build before it wrote a status', () => {
		const said = probeBuildFailure(null, 'linux');
		expect(said).toContain('a signal stopped the probe build');
		expect(said).toContain('before the build wrote a status');
		expect(said).not.toContain('null');
		expect(said).not.toContain('the probe build failed');
	});

	// The build did not write the abort status. A build that ends with that
	// status did not fail. A message that calls this a failure of the build
	// sends the reader to the build for a fault that is not there.
	it('names the abort of a host that stopped the build', () => {
		const said = probeBuildFailure(WINDOWS_ABORT_STATUS, 'win32');
		expect(said).toContain('the host aborted the probe build');
		expect(said).toContain(String(WINDOWS_ABORT_STATUS));
		expect(said).toContain('0xC0000409');
		expect(said).toContain('the build did not fail');
		expect(said).toContain('Run the command one more time');
		expect(said).not.toContain('the probe build failed');
	});

	it('reads the abort status as a plain failure on another host', () => {
		expect(probeBuildFailure(WINDOWS_ABORT_STATUS, 'darwin')).toContain(
			`the probe build failed with the status ${String(WINDOWS_ABORT_STATUS)}`,
		);
	});

	// The script must not depend on a module of the test harness. Therefore
	// the abort status stands in the script and in the harness, and this case
	// holds the two numbers together.
	it('holds the abort status that the harness holds', () => {
		expect(WINDOWS_ABORT_STATUS).toBe(HARNESS_ABORT_STATUS);
	});

	// The number is only what the decision reads. Each module carries a
	// decision of its own, and the two take different arguments. A decision
	// that grew on one side would leave the two numbers equal and the two
	// answers different, and the script would stop naming an abort that the
	// harness names. This case drives both decisions over the same statuses.
	it('reaches the verdict of the harness on every status', () => {
		const statuses = [
			WINDOWS_ABORT_STATUS,
			// The same number as a signed 32-bit value.
			-1073740791,
			WINDOWS_ABORT_STATUS - 1,
			WINDOWS_ABORT_STATUS + 1,
			0,
			1,
			255,
			null,
		];
		for (const platform of ['win32', 'darwin', 'linux']) {
			for (const status of statuses) {
				const script = isWindowsAbort(status, platform);
				const harness = harnessIsWindowsAbort(
					{ status, stdout: '', stderr: '' },
					platform,
				);
				expect({ platform, status, said: script }).toStrictEqual({
					platform,
					status,
					said: harness,
				});
			}
		}
	});
});

describe('the script as a process', () => {
	const script = fileURLToPath(
		new URL('../scripts/vault.mjs', import.meta.url),
	);

	function run(argv: readonly string[]): {
		status: number | null;
		out: string;
		err: string;
	} {
		const result = runNode([script, ...argv]);
		return {
			status: result.status,
			out: result.stdout,
			err: result.stderr,
		};
	}

	it('prints the usage text and then stops', () => {
		const result = run(['--help']);
		expect(result.status).toBe(0);
		expect(result.out).toContain('npm run vault');
		expect(result.err).toBe('');
	});

	it('says the same text as the help constant', () => {
		expect(run(['-h']).out.trim()).toBe(HELP.trim());
	});

	// Each row goes through as it stands. To split a row on its spaces
	// would turn the row that carries a space into two arguments. Then the
	// arity check would answer that row before the check read the name.
	it.each([
		['a name with a space', ['My Vault']],
		['a name that is not a name', ['--nonsense']],
		['two names at once', ['one', 'two']],
		['a name with a separator in it', ['../escape']],
	])('refuses %s in one line', (_what, argv) => {
		const result = run(argv);
		expect(result.status).toBe(1);
		expect(result.err.trimEnd().split('\n')).toHaveLength(1);
		expect(result.err).toMatch(/^vault: /);
		expect(result.err).not.toContain('    at ');
		expect(result.out).toBe('');
	});

	// The property test pins what `checkName` accepts. This test pins that
	// the script calls it. Without this test, somebody could remove the check
	// from the one place that calls it, and every other test would still
	// pass, while a name with separators made a directory outside the
	// checkout.
	it('puts the name that it received through the name check', () => {
		expect(run(['My Vault']).err).toContain(
			'a vault name uses lowercase letters, digits and hyphens only',
		);
		expect(run(['../escape']).err).toContain(
			'a vault name uses lowercase letters, digits and hyphens only',
		);
	});

	it('builds nothing on the way to refusing a name', () => {
		expect(run(['My Vault']).out).toBe('');
	});
});

/**
 * The copying is thin. The copying is also the whole of what the script can
 * destroy, and a pure test cannot see it. These tests run the real script
 * against real vaults under `.vaults/`. Git ignores that directory. These
 * tests take the vaults down afterwards.
 */
describe('running against a vault that already holds work', () => {
	const script = fileURLToPath(
		new URL('../scripts/vault.mjs', import.meta.url),
	);
	const root = fileURLToPath(new URL('../', import.meta.url));
	const made: string[] = [];

	afterAll(() => {
		for (const path of made) {
			rmSync(path, { recursive: true, force: true });
		}
	});

	/** A vault path that nothing else in the suite uses. */
	function reserve(what: string): string {
		const name = `test-${what}-${String(process.pid)}`;
		const path = join(root, '.vaults', name);
		made.push(path);
		rmSync(path, { recursive: true, force: true });
		return path;
	}

	function vault(path: string, ...argv: string[]): string {
		const result = runNode([script, basename(path), ...argv]);
		if (result.status !== 0) {
			expect.fail(`the script failed: ${result.stderr}`);
		}
		return result.stdout;
	}

	/** Every file in the vault, against the digest of its contents. */
	function digests(path: string): Map<string, string> {
		const found = new Map<string, string>();
		const walk = (directory: string, prefix: string): void => {
			for (const entry of readdirSync(directory, {
				withFileTypes: true,
			})) {
				const here =
					prefix === '' ? entry.name : `${prefix}/${entry.name}`;
				if (entry.isDirectory()) {
					walk(join(directory, entry.name), here);
				} else if (entry.isFile()) {
					const bytes = readFileSync(join(directory, entry.name));
					found.set(
						here,
						createHash('sha256').update(bytes).digest('hex'),
					);
				}
			}
		};
		walk(path, '');
		return found;
	}

	// A second run can rewrite the two files of the probe and nothing else.
	// Both halves of that rule matter. A write over the settings would throw
	// away the edits of the owner. To clear the plugin folder before the
	// copy would take the data.json of the probe with it.
	it('rewrites nothing that the owner put there', () => {
		const path = reserve('holds-work');
		vault(path);

		const probeFolder = join(path, '.obsidian', 'plugins', PROBE_ID);
		mkdirSync(join(path, 'notes'), { recursive: true });
		mkdirSync(join(path, '.obsidian', 'plugins', 'other-plugin'), {
			recursive: true,
		});
		writeFileSync(join(path, 'notes', 'kept.md'), '# kept\n');
		writeFileSync(join(path, 'README.md'), 'my own words\n');
		writeFileSync(
			join(path, '.obsidian', 'app.json'),
			'{"theme":"mine"}\n',
		);
		writeFileSync(
			join(path, '.obsidian', 'community-plugins.json'),
			'["davenport-frontmatter-probe","other-plugin"]\n',
		);
		writeFileSync(join(probeFolder, 'data.json'), '{"runs":3}\n');
		writeFileSync(
			join(path, '.obsidian', 'plugins', 'other-plugin', 'main.js'),
			'someone else\n',
		);

		const before = digests(path);
		vault(path);
		expect(digests(path)).toEqual(before);
	});

	// The files of the probe are the exception, and only when they differ.
	it('rewrites the probe alone when the installed copy is stale', () => {
		const path = reserve('stale-probe');
		vault(path);

		const probeFolder = join(path, '.obsidian', 'plugins', PROBE_ID);
		writeFileSync(join(probeFolder, 'data.json'), '{"runs":1}\n');
		writeFileSync(join(probeFolder, 'main.js'), 'stale\n');
		const before = digests(path);

		const printed = vault(path);
		expect(printed).toContain('refreshed, and the script rewrote main.js');

		const after = digests(path);
		const changed = [...after]
			.filter(([file, digest]) => before.get(file) !== digest)
			.map(([file]) => file);
		expect(changed).toEqual([
			'.obsidian/plugins/davenport-frontmatter-probe/main.js',
		]);
		expect(
			after.has(
				'.obsidian/plugins/davenport-frontmatter-probe/data.json',
			),
		).toBe(true);
	});

	// A vault that comes from another device arrives as a directory that
	// nobody laid out. A folder that a person makes by hand starts the same
	// way. The script provisions such a directory and does not leave it
	// half-made.
	it('lays out a directory that was never a vault', () => {
		const path = reserve('bare-directory');
		mkdirSync(join(path, 'notes'), { recursive: true });
		writeFileSync(join(path, 'notes', 'carried.md'), '# carried\n');

		const printed = vault(path);
		expect(existsSync(join(path, '.obsidian', 'app.json'))).toBe(true);
		expect(existsSync(join(path, 'README.md'))).toBe(true);
		expect(
			readFileSync(
				join(path, '.obsidian', 'community-plugins.json'),
				'utf8',
			),
		).toContain(PROBE_ID);
		expect(printed).toContain('davenport-frontmatter-probe (enabled)');
		expect(readFileSync(join(path, 'notes', 'carried.md'), 'utf8')).toBe(
			'# carried\n',
		);
	});

	// This run wrote the plugin list into the vault. Therefore nobody opened
	// that vault with the probe in it before, and the vault needs the steps
	// that a new vault needs.
	it('gives a vault that it has just laid out the first-open steps', () => {
		const path = reserve('needs-first-open');
		mkdirSync(path, { recursive: true });

		expect(vault(path)).toContain('open it by hand one time');
		// The script drops the steps after the vault has everything.
		expect(vault(path)).not.toContain('open it by hand one time');
	});
});

describe('the wiring between the repository and the script', () => {
	const root = new URL('../', import.meta.url);
	const read = (name: string): string =>
		readFileSync(fileURLToPath(new URL(name, root)), 'utf8');

	it('runs as npm run vault', () => {
		const packaged: unknown = JSON.parse(read('package.json'));
		const scripts: unknown = reach(packaged, 'scripts');
		expect(reach(scripts, 'vault')).toBe('node scripts/vault.mjs');
	});

	// The script names the plugin folder after this constant, and the script
	// writes this constant into the list of enabled plugins. Obsidian matches
	// that list against the identifier in the manifest. Therefore the three
	// must be the same string, and this test holds them together.
	it('names the plugin folder after the identifier in the manifest', () => {
		const manifest: unknown = JSON.parse(
			read('tools/frontmatter-probe/manifest.json'),
		);
		expect(reach(manifest, 'id')).toBe(PROBE_ID);
	});

	// The vaults hold a built plugin and the files that a probe run wrote.
	// None of these files belongs in the history of the repository that
	// builds them.
	it('keeps the vaults out of git', () => {
		expect(read('.gitignore')).toContain('.vaults/');
	});

	it('keeps the vaults out of the lint and format sweeps too', () => {
		expect(read('eslint.config.mts')).toContain("'.vaults'");
		expect(read('.prettierignore')).toContain('.vaults');
	});

	/**
	 * Asks git which files it tracks under the vaults folder. git ls-files
	 * gives 0 for a list and 0 for an empty list. The harness refuses every
	 * other status. Therefore a command that a host aborted fails its case,
	 * and the empty output of that command reaches no assertion.
	 */
	const tracked = (host?: GitHost): ProcessResult =>
		runGit(
			{
				args: ['ls-files', '.vaults'],
				answers: LS_FILES_ANSWERS,
				cwd: fileURLToPath(root),
			},
			host,
		);

	// The ignore rule is worth having only while it works. This test asks git
	// itself what it tracks. Therefore a vault that got into the index fails
	// here, and not in a review of a pull request.
	it('tracks no file under .vaults', () => {
		expect(tracked().stdout).toBe('');
	});

	// The case above passes when the output is empty. A host that aborts git
	// also leaves the output empty. This case runs the same command against
	// a host that aborts git. The command fails, and the failure names the
	// status.
	it('fails and names the status when a host aborts git', () => {
		const aborted: GitHost = {
			platform: 'win32',
			run: () => ({
				status: HARNESS_ABORT_STATUS,
				stdout: '',
				stderr: '',
			}),
		};
		expect(() => tracked(aborted)).toThrow(/3221226505/u);
	});
});
