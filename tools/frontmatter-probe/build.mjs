/**
 * This script builds the probe into `dist/`, together with the note
 * corpus.
 *
 *     npm run probe:build
 *
 * A plugin bundle runs in a vault, and there it cannot read the
 * repository. Therefore this script reads the note fixtures at build
 * time, and generates them into a module. The plugin imports that module
 * as `probe-corpus`.
 *
 * The fixtures come through the harness loader. That loader is the one
 * place that lists the corpus. A fixture that is on disk, and that the
 * loader does not list, stops the build. Without this check, that fixture
 * is absent from every run and nothing reports the absence.
 *
 * The build writes `dist/main.js` and `dist/manifest.json`. The plugin
 * folder of a vault needs these two files.
 */

import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import esbuild from 'esbuild';
import {
	NOTE_FIXTURES,
	noteFixtureNamesOnDisk,
} from '../../test/harness/fixtures/note-corpus.ts';

const CORPUS_MODULE = 'probe-corpus';

const here = new URL('./', import.meta.url);
const distribution = new URL('./dist/', here);
const banner = `/*
esbuild made this file from tools/frontmatter-probe/ in the davenport repository.
The note corpus is in this file. The source of the corpus is under
test/harness/fixtures/notes/.
*/
`;

const embedded = NOTE_FIXTURES.map((fixture) => fixture.id).sort();
const onDisk = noteFixtureNamesOnDisk();
if (embedded.join(',') !== onDisk.join(',')) {
	console.error(
		`probe build: the loader lists ${embedded.join(', ')}, and the fixture directory holds ${onDisk.join(', ')}; make the two lists the same, then build again`,
	);
	process.exit(1);
}

mkdirSync(fileURLToPath(distribution), { recursive: true });

await esbuild.build({
	banner: { js: banner },
	entryPoints: [fileURLToPath(new URL('./main.ts', here))],
	outfile: fileURLToPath(new URL('./main.js', distribution)),
	bundle: true,
	platform: 'browser',
	format: 'cjs',
	target: 'es2021',
	external: ['obsidian', 'electron'],
	treeShaking: true,
	sourcemap: false,
	minify: false,
	logLevel: 'info',
	plugins: [corpusPlugin(NOTE_FIXTURES)],
});

copyFileSync(
	fileURLToPath(new URL('./manifest.json', here)),
	fileURLToPath(new URL('./manifest.json', distribution)),
);

const bytes = NOTE_FIXTURES.reduce(
	(total, fixture) => total + Buffer.byteLength(fixture.content, 'utf8'),
	0,
);
console.log(
	`probe build: the bundle holds ${NOTE_FIXTURES.length} fixtures and ${bytes} bytes of note text`,
);
console.log(
	'probe build: wrote tools/frontmatter-probe/dist/main.js and tools/frontmatter-probe/dist/manifest.json',
);
console.log(
	'probe build: copy the dist folder into a vault as the plugin folder davenport-frontmatter-probe; tools/frontmatter-probe/README.md gives the full path',
);

/**
 * An esbuild plugin that gives the corpus to the bundle as a module. No
 * file holds the corpus, so this plugin makes the contents of the module
 * here.
 */
function corpusPlugin(fixtures) {
	const contents = `export const PROBE_CORPUS = ${JSON.stringify(
		fixtures.map(({ id, fileName, content }) => ({
			id,
			fileName,
			content,
		})),
		null,
		'\t',
	)};\n`;
	return {
		name: CORPUS_MODULE,
		setup(build) {
			build.onResolve({ filter: /^probe-corpus$/ }, () => ({
				path: CORPUS_MODULE,
				namespace: CORPUS_MODULE,
			}));
			build.onLoad({ filter: /.*/, namespace: CORPUS_MODULE }, () => ({
				contents,
				loader: 'js',
			}));
		},
	};
}
