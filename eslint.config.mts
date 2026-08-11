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
const memberTimers = [
	`MemberExpression[computed=false][object.name=${globalObjects}][property.name=/^(setTimeout|setInterval|setImmediate)$/]`,
	`MemberExpression[computed=true][object.name=${globalObjects}][property.value=/^(setTimeout|setInterval|setImmediate)$/]`,
];
const fetchMessage =
	'Network I/O goes through the transport port (requestUrl-backed).';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'coverage',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
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
					],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['src/**/*.ts', 'test/**/*.ts', 'vitest.config.ts'],
		extends: [
			tseslint.configs.strictTypeChecked,
			tseslint.configs.stylisticTypeChecked,
		],
	},
	// Build tooling and this config run under node by design; the
	// obsidianmd rules police plugin code, not tooling.
	{
		name: 'davenport/tooling',
		files: ['scripts/**/*.mjs', 'eslint.config.mts'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
		},
	},
	{
		name: 'davenport/tooling-console',
		files: ['scripts/**/*.mjs'],
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
	// All network I/O flows through the transport port; the Obsidian
	// adapter backs it with requestUrl. A direct fetch breaks on mobile.
	{
		name: 'davenport/no-global-fetch',
		files: ['src/**/*.ts', 'test/**/*.ts'],
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
				...memberFetch.map((selector) => ({
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
