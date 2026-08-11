import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'coverage',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'scripts',
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
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
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
					message:
						'Network I/O goes through the transport port (requestUrl-backed).',
				},
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
							group: ['node:*'],
							message:
								'Node APIs are desktop-only; they live in src/adapters/desktop/.',
						},
					],
				},
			],
		},
	},
	// The engine core is platform-free: no Obsidian, no Electron, no Node,
	// no ambient time or timers — time flows through the clock port.
	{
		name: 'davenport/core-boundary',
		files: ['src/core/**/*.ts'],
		rules: {
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
							group: ['node:*'],
							message: 'Core is platform-free.',
						},
					],
				},
			],
			'no-restricted-globals': [
				'error',
				{
					name: 'fetch',
					message:
						'Network I/O goes through the transport port (requestUrl-backed).',
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
			],
		},
	},
	prettier,
);
