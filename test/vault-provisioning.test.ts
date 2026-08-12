/**
 * The decisions behind the QA vault script: the names it accepts and the
 * ones it draws, the verdict it reaches on a probe already installed in a
 * vault, what it makes of a vault it has walked, and the wording it prints
 * around all of that.
 *
 * The script itself only walks a tree and copies files, so the module
 * beside it is where the answers are and where these point. The two ways a
 * run can end before it builds anything — the help text and a refused name
 * — are exercised as a process instead, because the exit status and the
 * single line of complaint are as much the interface as the words in it.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { NameCheck } from '../scripts/vault-core';
import {
	NAME_LIMIT,
	checkName,
	classifyInstall,
	generateName,
	summarizeVault,
} from '../scripts/vault-core';
import {
	HELP,
	formatOutcome,
	vaultReadme,
	vaultUri,
} from '../scripts/vault-text';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const BUNDLE = bytes('the bundle');
const MANIFEST = bytes('{"id":"davenport-a11-probe"}');

/** A build of two files, as the script reads one back off disk. */
const FRESH = new Map([
	['main.js', BUNDLE],
	['manifest.json', MANIFEST],
]);

/** A property of a parsed value, without asserting what the value is. */
function reach(holder: unknown, property: string): unknown {
	return typeof holder === 'object' && holder !== null
		? Reflect.get(holder, property)
		: undefined;
}

/** The reason a name was refused, insisting that it was refused at all. */
function refusal(check: NameCheck): string {
	if (check.ok) {
		expect.fail(`${check.name} was accepted`);
	}
	return check.reason;
}

/** Randomness a test can predict, so a drawn name can be asserted. */
function fixedRandom(...draws: number[]): () => number {
	let index = 0;
	return () => draws[index++] ?? 0;
}

/** A seeded source, for asking the generator for a great many names. */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

describe('what a vault may be called', () => {
	it.each(['quiet-copper-harbor', 'a', 'vault2', '2026-08-12'])(
		'accepts %s',
		(name) => {
			expect(checkName(name)).toEqual({ ok: true, name });
		},
	);

	it('refuses a name with nothing in it', () => {
		expect(checkName('')).toEqual({
			ok: false,
			reason: 'a vault name cannot be empty',
		});
	});

	it('names the characters it refused, including the invisible ones', () => {
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

	it('refuses a name longer than it says it takes', () => {
		expect(checkName('a'.repeat(NAME_LIMIT)).ok).toBe(true);
		expect(checkName('a'.repeat(NAME_LIMIT + 1)).ok).toBe(false);
	});

	// The alphabet is the whole of the containment: with no dot and no
	// separator in it, an accepted name cannot name a directory above the
	// one it is joined onto.
	it('accepts nothing that could climb out of the vaults directory', () => {
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

describe('drawing a name for a vault', () => {
	it('draws two adjectives and a noun', () => {
		expect(generateName(fixedRandom(0, 0, 0))).toBe('amber-azure-anchor');
	});

	// The second adjective is drawn from the words the first one left, so a
	// source that keeps answering the same way still cannot repeat a word.
	it('never repeats a word, however the draw falls', () => {
		for (const draw of [0, 0.25, 0.5, 0.999]) {
			const [first, second, noun] = generateName(() => draw).split('-');
			expect(first).not.toBe(second);
			expect(noun).toBeDefined();
		}
	});

	it('still names words when the source answers outside the unit interval', () => {
		expect(generateName(() => 1)).toBe('winter-western-willow');
		expect(generateName(() => -1)).toBe('amber-azure-anchor');
		expect(generateName(() => Number.NaN)).toBe('amber-azure-anchor');
	});

	// Generation and validation are two halves of the same rule, and a drawn
	// name that the check would refuse is a vault nobody can ask for twice.
	it('draws only names the check accepts', () => {
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

	it('calls a differing byte stale and names only that file', () => {
		const installed = new Map(FRESH);
		installed.set('main.js', bytes('the bundle, once'));
		expect(classifyInstall(FRESH, installed)).toEqual({
			state: 'stale',
			toWrite: ['main.js'],
		});
	});

	it('sees a difference that does not change the length', () => {
		const installed = new Map(FRESH);
		installed.set('main.js', bytes('the bundlE'));
		expect(classifyInstall(FRESH, installed).state).toBe('stale');
	});

	// A copy interrupted halfway is not a copy to leave in place, and it is
	// not absent either: something is there and it is the wrong something.
	it('calls a half-copied install stale rather than absent', () => {
		const installed = new Map([['manifest.json', MANIFEST]]);
		expect(classifyInstall(FRESH, installed)).toEqual({
			state: 'stale',
			toWrite: ['main.js'],
		});
	});
});

describe('what a walked vault amounts to', () => {
	const scan = {
		files: [
			'README.md',
			'.obsidian/app.json',
			'.obsidian/community-plugins.json',
			'.obsidian/plugins/davenport-a11-probe/main.js',
			'frontmatter-probe/simple.md',
			'frontmatter-probe/emission-samples-20260811-091233Z.json',
			'frontmatter-probe/emission-samples-20260812-134501Z.json',
		],
		installedPlugins: ['davenport-a11-probe'],
		enabledPlugins: ['davenport-a11-probe'],
	};

	it('counts every file and the markdown among them', () => {
		const report = summarizeVault(scan);
		expect(report.totalFiles).toBe(7);
		expect(report.markdownFiles).toBe(2);
	});

	it('says which installed plugins the vault enables', () => {
		expect(summarizeVault(scan).plugins).toEqual([
			{ id: 'davenport-a11-probe', enabled: true },
		]);
	});

	it('calls an installed plugin the list leaves out not enabled', () => {
		const report = summarizeVault({ ...scan, enabledPlugins: [] });
		expect(report.plugins).toEqual([
			{ id: 'davenport-a11-probe', enabled: false },
		]);
	});

	// A vault with no readable list enables nothing, which is the same
	// answer a list enabling nothing gets, and the right one either way.
	it('treats a missing list as enabling nothing', () => {
		const report = summarizeVault({ ...scan, enabledPlugins: null });
		expect(report.plugins).toEqual([
			{ id: 'davenport-a11-probe', enabled: false },
		]);
		expect(report.enabledWithoutFolder).toEqual([]);
	});

	it('calls out an enabled id that no folder answers for', () => {
		const report = summarizeVault({
			...scan,
			enabledPlugins: ['davenport-a11-probe', 'something-else'],
		});
		expect(report.enabledWithoutFolder).toEqual(['something-else']);
	});

	it('lists the probe results newest first, timed from their own names', () => {
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

	it('keeps a second run in the same second', () => {
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

describe('the link that reopens a vault', () => {
	// Obsidian asks for every value in the link to be encoded, separators
	// and all, and resolves the most specific vault holding the path.
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
		install: {
			state: 'absent' as const,
			toWrite: ['main.js', 'manifest.json'],
		},
		report: summarizeVault({
			files: ['README.md'],
			installedPlugins: ['davenport-a11-probe'],
			enabledPlugins: ['davenport-a11-probe'],
		}),
		cliFound: false,
	};

	it('gives a new vault the first-open step it cannot do for itself', () => {
		const printed = formatOutcome(base);
		expect(printed).toContain('Created the vault quiet-copper-harbor');
		expect(printed).toContain('/repo/.vaults/quiet-copper-harbor');
		expect(printed).toContain('the first open is by hand');
		expect(printed).toContain('restricted mode');
		expect(printed).toContain(vaultUri(base.path));
	});

	it('does not repeat the first-open step for a vault already there', () => {
		const printed = formatOutcome({
			...base,
			created: false,
			install: { state: 'current', toWrite: [] },
		});
		expect(printed).toContain('is already there');
		expect(printed).toContain('Probe          already current');
		expect(printed).not.toContain('the first open is by hand');
		expect(printed).toContain(vaultUri(base.path));
	});

	it('says which file a refresh rewrote', () => {
		const printed = formatOutcome({
			...base,
			created: false,
			install: { state: 'stale', toWrite: ['main.js'] },
		});
		expect(printed).toContain('refreshed, main.js rewritten');
	});

	it('names both files when it installs the probe', () => {
		expect(formatOutcome(base)).toContain(
			'installed, main.js and manifest.json',
		);
	});

	// Obsidian's command line takes a vault by name and knows nothing of one
	// it has no record of, so it is never offered as the way in. The link is
	// the way in, and the command line is offered for the checking after.
	it('offers the command line only where there is one', () => {
		expect(formatOutcome(base)).not.toContain('obsidian vault=');
		const withCli = formatOutcome({ ...base, cliFound: true });
		expect(withCli).toContain('obsidian vault=quiet-copper-harbor plugins');
	});

	it('never offers the command line as the way to open a vault', () => {
		for (const created of [true, false]) {
			const printed = formatOutcome({ ...base, created, cliFound: true });
			const opening = printed.slice(
				printed.indexOf('Open it in Obsidian'),
			);
			expect(opening).toContain(`open "${vaultUri(base.path)}"`);
			expect(opening).not.toContain(
				'obsidian vault=quiet-copper-harbor\n',
			);
		}
	});

	it('reports the results files and says so when there are none', () => {
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
			}),
		});
		expect(withResults).toContain(
			'emission-samples-20260812-134501Z.json (2026-08-12 13:45:01Z)',
		);
		expect(withResults).toContain(
			'emission-samples-20260811-091233Z.json (2026-08-11 09:12:33Z)',
		);
	});

	it('tells whoever opens the vault the one command to run', () => {
		const note = vaultReadme('quiet-copper-harbor');
		expect(note).toContain('quiet-copper-harbor');
		expect(note).toContain('Run frontmatter probe');
		expect(note).toContain('frontmatter-probe/');
		expect(note).toContain('Settings → Community plugins');
	});
});

describe('the script as a process', () => {
	const script = fileURLToPath(
		new URL('../scripts/vault.mjs', import.meta.url),
	);

	function run(...argv: string[]): {
		status: number | null;
		out: string;
		err: string;
	} {
		const result = spawnSync(process.execPath, [script, ...argv], {
			encoding: 'utf8',
		});
		return {
			status: result.status,
			out: result.stdout,
			err: result.stderr,
		};
	}

	it('prints how to use it and stops', () => {
		const result = run('--help');
		expect(result.status).toBe(0);
		expect(result.out).toContain('npm run vault');
		expect(result.err).toBe('');
	});

	it('says the same thing the help constant does', () => {
		expect(run('-h').out.trim()).toBe(HELP.trim());
	});

	// A name the script will not take is answered with the reason and
	// nothing else: no stack, and no vault built on the way to finding out.
	it.each([
		['a name with a space', 'My Vault'],
		['a name that is not a name', '--nonsense'],
		['two names at once', 'one two'],
	])('refuses %s in one line', (_what, argument) => {
		const result = run(...argument.split(' '));
		expect(result.status).toBe(1);
		expect(result.err.trimEnd().split('\n')).toHaveLength(1);
		expect(result.err).toMatch(/^vault: /);
		expect(result.err).not.toContain('    at ');
		expect(result.out).toBe('');
	});
});

describe('how the repository is wired for it', () => {
	const root = new URL('../', import.meta.url);
	const read = (name: string): string =>
		readFileSync(fileURLToPath(new URL(name, root)), 'utf8');

	it('runs as npm run vault', () => {
		const packaged: unknown = JSON.parse(read('package.json'));
		const scripts: unknown = reach(packaged, 'scripts');
		expect(reach(scripts, 'vault')).toBe('node scripts/vault.mjs');
	});

	// The vaults hold a built plugin and whatever a probe run wrote, none of
	// which belongs in the history of the repository that builds them.
	it('keeps the vaults out of git', () => {
		expect(read('.gitignore')).toContain('.vaults/');
	});

	it('keeps them out of the lint and format sweeps too', () => {
		expect(read('eslint.config.mts')).toContain("'.vaults'");
		expect(read('.prettierignore')).toContain('.vaults');
	});

	// The ignore rule is worth having only if it is working: this asks git
	// itself what it is tracking, so a vault that slipped into the index
	// fails here rather than in a review of someone's pull request.
	it('tracks no file under .vaults', () => {
		const tracked = spawnSync('git', ['ls-files', '.vaults'], {
			cwd: fileURLToPath(root),
			encoding: 'utf8',
		});
		expect(tracked.stdout).toBe('');
	});
});
