import { builtinModules } from 'node:module';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

// Bare and node:-prefixed specifier forms of every node builtin; the prefix
// is a convention, not a requirement, so a ban must cover both.
const nodeBuiltinPatterns = [
	'node:*',
	...builtinModules,
	...builtinModules.map((m) => `${m}/*`),
];

// no-restricted-globals only sees bare identifiers, so member spellings
// (window.fetch, globalThis.setTimeout) need selector-based guards too.
const globalObjects = '/^(window|globalThis|self|global|activeWindow)$/';
const memberFetch = [
	`MemberExpression[computed=false][object.name=${globalObjects}][property.name='fetch']`,
	`MemberExpression[computed=true][object.name=${globalObjects}][property.value='fetch']`,
];
// Reflect.get reaches a property without naming it in a member expression,
// so the guards above see nothing. The holder is left unconstrained: the
// object a caller reads fetch off is as often a variable as it is a global.
// Both literal spellings of the key are covered, quoted and templated.
//
// A key held in a variable — `const k = 'fetch'; Reflect.get(x, k)` — is
// past what a syntax rule can see, and bundling keeps it that way: esbuild
// does not inline such a constant, so the bundle scan cannot see it either.
// That is the stated division of labour rather than a gap to close. Lint
// answers for the spellings a reader can recognise on the page; the fetch
// poison answers for every spelling there is, because it replaces the
// property itself, so a call throws whatever name it was reached through.
const reflectFetch = [
	`CallExpression[callee.object.name='Reflect'][callee.property.name='get'][arguments.1.value='fetch']`,
	`CallExpression[callee.object.name='Reflect'][callee.property.name='get'][arguments.1.expressions.length=0][arguments.1.quasis.0.value.cooked='fetch']`,
];
const memberTimers = [
	`MemberExpression[computed=false][object.name=${globalObjects}][property.name=/^(setTimeout|setInterval|setImmediate)$/]`,
	`MemberExpression[computed=true][object.name=${globalObjects}][property.value=/^(setTimeout|setInterval|setImmediate)$/]`,
];
const fetchMessage =
	'Network I/O goes through the transport port (requestUrl-backed).';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'.claude',
		'.vaults',
		'dist',
		'tools/*/dist',
		'coverage',
		'reports',
		'.stryker-tmp',
		'esbuild.config.mjs',
		'stryker.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'bundle-meta.json',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mts',
						'manifest.json',
						'scripts/*.mjs',
						'tools/frontmatter-probe/manifest.json',
						'tools/frontmatter-probe/*.mjs',
					],
					// The patterns above match nine files. Each of these
					// files is outside tsconfig.json, so the linter
					// builds a program of its own for the file. The
					// default limit is eight files, and the linter stops
					// past that limit. The limit guards the run time of the
					// lint. The number below gives room for a few more tool
					// files.
					maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 12,
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: [
			'src/**/*.ts',
			'test/**/*.ts',
			'tools/**/*.ts',
			'scripts/**/*.ts',
			'vitest.config.ts',
		],
		extends: [
			tseslint.configs.strictTypeChecked,
			tseslint.configs.stylisticTypeChecked,
		],
	},
	// Build tooling and this config run under node by design; the
	// obsidianmd rules police plugin code, not tooling.
	{
		name: 'davenport/tooling',
		files: [
			'scripts/**/*.mjs',
			'scripts/**/*.ts',
			'tools/**/*.mjs',
			'eslint.config.mts',
		],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
		},
	},
	// The vault script lays out a vault from the outside, before any app has
	// opened it, so there is no Vault to ask for the name of its
	// configuration folder. What it creates is the name Obsidian defaults
	// to, which is the only answer available here, and its tests describe
	// vaults on disk in the same terms. The exemption names those files and
	// nothing else.
	{
		name: 'davenport/vault-script',
		files: [
			'scripts/vault-core.ts',
			'scripts/vault.mjs',
			'test/vault-provisioning.test.ts',
		],
		rules: {
			'obsidianmd/hardcoded-config-path': 'off',
		},
	},
	{
		name: 'davenport/tooling-console',
		files: ['scripts/**/*.mjs', 'scripts/**/*.ts', 'tools/**/*.mjs'],
		rules: {
			'obsidianmd/rule-custom-message': 'off',
		},
	},
	// The one sanctioned home for node APIs in plugin source, gated at
	// runtime to desktop. Without this exemption the warnings-as-errors
	// lint gate would reject the zone the import bans deliberately carve
	// out.
	{
		name: 'davenport/desktop-zone',
		files: ['src/adapters/desktop/**/*.ts'],
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
		},
	},
	// Tests run under vitest on node and never ship, so the harness reads
	// its fixtures from disk. The node-import ban below is scoped to plugin
	// source for the same reason; this turns off the obsidianmd rule that
	// would otherwise police the tests as if they ran on a phone.
	{
		name: 'davenport/test-harness',
		files: ['test/**/*.ts'],
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
		},
	},
	// The probe kit under tools/ is two halves. The plugin half is carried
	// to phones like any other plugin, so node APIs are out of it. The
	// comparison half runs under node on a desktop, where reading files and
	// hashing bytes is the whole of its job.
	{
		name: 'davenport/probe-plugin',
		files: ['tools/frontmatter-probe/**/*.ts'],
		ignores: [
			'tools/frontmatter-probe/compare-core.ts',
			'tools/frontmatter-probe/compare-format.ts',
		],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: nodeBuiltinPatterns,
							message:
								'The probe runs on phones too; it takes what it needs from the Obsidian API.',
						},
					],
				},
			],
			// The API-availability check reads the repository's own
			// manifest unless it is told otherwise. The probe ships its
			// own, declaring the version that introduced the frontmatter
			// writer it exists to exercise.
			'obsidianmd/no-unsupported-api': [
				'error',
				{ minAppVersion: '1.4.4' },
			],
		},
	},
	{
		name: 'davenport/probe-tooling',
		files: [
			'tools/frontmatter-probe/compare-core.ts',
			'tools/frontmatter-probe/compare-format.ts',
		],
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
		},
	},
	// The probe writes down the environment it ran in rather than branching
	// on it: the engine string is evidence about a result, not a switch.
	{
		name: 'davenport/probe-environment',
		files: ['tools/frontmatter-probe/environment.ts'],
		rules: {
			'obsidianmd/platform': 'off',
		},
	},
	// The fetch poison is the runtime half of the ban below: it replaces
	// fetch on every global spelling a caller could reach it through, and
	// its tests reach back through the same names to prove it did. The rule
	// steering plugin code toward the popout-safe window has nothing to say
	// about the two files whose subject is the global object itself.
	{
		name: 'davenport/fetch-poison',
		files: [
			'test/harness/sweeps/fetch-poison.ts',
			'test/harness/sweeps/fetch-poison.test.ts',
		],
		rules: {
			'obsidianmd/no-global-this': 'off',
		},
	},
	// The time poison is the runtime half of the ambient-time ban. The
	// poison replaces the time functions on each global spelling that a
	// caller can reach. The tests of the poison read the same names back.
	// The read proves that the poison went in. The rules that steer plugin
	// code to the popout-safe window do not apply to these two files,
	// because the subject of these two files is the global object itself.
	{
		name: 'davenport/time-poison',
		files: [
			'test/harness/sweeps/time-poison.ts',
			'test/harness/sweeps/time-poison.test.ts',
		],
		rules: {
			'obsidianmd/no-global-this': 'off',
			'obsidianmd/prefer-window-timers': 'off',
		},
	},
	// The tests of the time poison build a function whose stack frame names
	// a path that the test chooses. The Function constructor carries that
	// path in a sourceURL comment, and no other construct can name the path
	// of a frame. The one alternative is a fixture file under a directory
	// named node_modules, and git ignores every such directory. The ban on
	// the Function constructor therefore does not apply to this one file.
	{
		name: 'davenport/time-poison-frames',
		files: ['test/harness/sweeps/time-poison.test.ts'],
		rules: {
			'obsidianmd/rule-custom-message': 'off',
			'@typescript-eslint/no-implied-eval': 'off',
		},
	},
	// All network I/O flows through the transport port; the Obsidian
	// adapter backs it with requestUrl. A direct fetch breaks on mobile.
	{
		name: 'davenport/no-global-fetch',
		files: [
			'src/**/*.ts',
			'test/**/*.ts',
			'tools/**/*.ts',
			'scripts/**/*.ts',
		],
		rules: {
			'no-restricted-globals': [
				'error',
				{
					name: 'fetch',
					message: fetchMessage,
				},
			],
			'no-restricted-syntax': [
				'error',
				...[...memberFetch, ...reflectFetch].map((selector) => ({
					selector,
					message: fetchMessage,
				})),
			],
		},
	},
	// The poison and its tests read fetch off a global to install it, to put
	// it back, and to prove they did, and Reflect.get is the only spelling
	// left once the member forms are banned everywhere. The exemption is
	// that one selector in these two files: the member spellings stay banned
	// in them, so nothing but their own readers gets through. They spell the
	// key as a literal so that the one pattern neither static half can see
	// is written nowhere in the repository, not even here.
	{
		name: 'davenport/fetch-poison-reflect',
		files: [
			'test/harness/sweeps/fetch-poison.ts',
			'test/harness/sweeps/fetch-poison.test.ts',
		],
		rules: {
			'no-restricted-syntax': [
				'error',
				...memberFetch.map((selector) => ({
					selector,
					message: fetchMessage,
				})),
			],
		},
	},
	// Node builtins are banned in the plugin source; the future desktop-only
	// OAuth listener module is the one sanctioned exception.
	{
		name: 'davenport/no-node-imports',
		files: ['src/**/*.ts'],
		ignores: ['src/adapters/desktop/**'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: nodeBuiltinPatterns,
							message:
								'Node APIs are desktop-only; they live in src/adapters/desktop/.',
						},
					],
				},
			],
		},
	},
	// The engine core is platform-free: no Obsidian, no Electron, no Node,
	// no ambient time or timers — time flows through the clock port. The
	// obsidianmd rules steering code toward window.setTimeout are disabled
	// here because core may not use any spelling of ambient timers.
	{
		name: 'davenport/core-boundary',
		files: ['src/core/**/*.ts'],
		rules: {
			'obsidianmd/prefer-window-timers': 'off',
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: 'obsidian',
							message:
								'Core is platform-free; implement a port in src/adapters/ instead.',
						},
						{
							name: 'electron',
							message: 'Core is platform-free.',
						},
					],
					patterns: [
						{
							group: nodeBuiltinPatterns,
							message: 'Core is platform-free.',
						},
					],
				},
			],
			'no-restricted-globals': [
				'error',
				{
					name: 'fetch',
					message: fetchMessage,
				},
				{
					name: 'setTimeout',
					message: 'Timers come from the clock port.',
				},
				{
					name: 'setInterval',
					message: 'Timers come from the clock port.',
				},
			],
			'no-restricted-properties': [
				'error',
				{
					object: 'Date',
					property: 'now',
					message: 'Time comes from the clock port.',
				},
			],
			'no-restricted-syntax': [
				'error',
				{
					selector:
						"NewExpression[callee.name='Date'][arguments.length=0]",
					message:
						'Zero-argument new Date() reads ambient time; use the clock port.',
				},
				...[...memberFetch, ...reflectFetch].map((selector) => ({
					selector,
					message: fetchMessage,
				})),
				...memberTimers.map((selector) => ({
					selector,
					message: 'Timers come from the clock port.',
				})),
			],
		},
	},
	prettier,
);
