/**
 * The markdown documents of this repository carry the design, the process,
 * and the recorded facts. Prettier formats none of these documents, because
 * `.prettierignore` holds `*.md`. Three reasons keep that line, and the
 * comment beside it gives them. This check is the formatting gate of these
 * documents instead. The check reports two defects that a hand edit leaves
 * behind.
 *
 * The first defect is a line that ends with white space. Nobody sees this
 * white space in a review, because the end of a line shows nothing. In
 * markdown, two spaces at the end of a line make a line break. The
 * documents of this repository use no such break. They use a paragraph
 * instead.
 *
 * The second defect is a reflow orphan. A person removes words from the
 * middle of a wrapped paragraph, and the person does not join the lines
 * again. The paragraph then holds a line that is much shorter than the
 * lines around it. The start of the next line also fits on that short line.
 * No wrap makes a line of that shape.
 *
 * The check reads the markdown documents, and it does not read a markdown
 * file that holds data. The note corpus holds such files, and the list
 * below names the folder of that corpus.
 *
 * The check fails when it finds no document at all. A check that matches no
 * file reports success on every repository, and that report shows nothing.
 * This check therefore never becomes an empty claim.
 *
 * The check reads the markdown files of this repository. If you give one
 * path or more as arguments, the check reads the markdown files under those
 * paths instead. Then the same rules can run over a tree in any location.
 *
 *     node scripts/markdown-shape.mjs
 *     node scripts/markdown-shape.mjs <directory>
 *
 * This file finds the files, reads them, and sets the exit status.
 * `markdown-shape-core.ts` holds the rules that decide what a defect is.
 * `markdown-shape-text.ts` holds the wording that the check prints.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { survey, surveyFails } from './markdown-shape-core.ts';
import { failureLines, reportLines, say } from './markdown-shape-text.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXTENSION = '.md';

/**
 * The directories that hold no document of this repository. Each of these
 * holds installed code, generated output, or a vault that a test made. A
 * directory whose name starts with a dot also holds no document, except the
 * directory of the GitHub templates.
 */
const SKIPPED = new Set([
	'node_modules',
	'coverage',
	'reports',
	'dist',
	'.stryker-tmp',
	'.vaults',
]);

/**
 * The directories of this repository that hold data, and not documents.
 * The note corpus holds a set of frontmatter shapes, and a test reads those
 * files byte for byte. The rules of this check describe prose, and prose
 * rules do not apply to a file of data. This is the same reason that keeps
 * Prettier away from the corpus.
 *
 * Each entry reads from the top of the repository, with one separator. A
 * caller that gives a path outside the repository gets no match here, and
 * the walk then enters every directory under that path.
 */
const DATA = new Set(['test/harness/fixtures']);

/** True for a directory that the walk does not enter. */
function skipped(name) {
	return SKIPPED.has(name) || (name.startsWith('.') && name !== '.github');
}

/**
 * True for a path that holds data. The test holds for a directory that the
 * list above names, and it holds for every path below such a directory.
 * Therefore an argument reaches no file of data, whichever path of the
 * corpus that argument gives.
 */
function data(path) {
	const name = shown(path);
	for (const entry of DATA) {
		if (name === entry || name.startsWith(`${entry}/`)) {
			return true;
		}
	}
	return false;
}

/**
 * The markdown files under one path, at any depth. A path that names a file
 * gives that one file. A path of data gives no file: the rule holds for the
 * folder of the corpus, for a folder below it, and for one file of it, and
 * the rule holds for a path that an argument gives as well. Git carries no
 * empty directory, so a directory that does not exist gives an empty list.
 *
 * The walk passes over a symbolic link. `CLAUDE.md` is a link to
 * `AGENTS.md`, and the walk finds `AGENTS.md` itself. A link that the walk
 * takes would give the same text to the check two times, and the check would
 * then report one defect as two places.
 */
function documentsUnder(path) {
	let entry;
	try {
		entry = statSync(path);
	} catch {
		return [];
	}
	if (data(path)) {
		return [];
	}
	if (!entry.isDirectory()) {
		return path.endsWith(EXTENSION) ? [path] : [];
	}
	const found = [];
	for (const child of readdirSync(path, { withFileTypes: true })) {
		if (child.isSymbolicLink()) {
			continue;
		}
		if (child.isDirectory()) {
			if (!skipped(child.name)) {
				found.push(...documentsUnder(join(path, child.name)));
			}
		} else if (child.name.endsWith(EXTENSION)) {
			found.push(join(path, child.name));
		}
	}
	return found;
}

/**
 * The path as the report says it. A path inside the repository reads from
 * the top of the repository, with one separator on every platform. A path
 * outside the repository reads whole.
 */
function shown(path) {
	const inside = relative(ROOT, path);
	return inside.startsWith('..') ? path : inside.split(sep).join('/');
}

/** The reason that an error carries. */
function said(error) {
	return error instanceof Error ? error.message : String(error);
}

const roots = process.argv.length > 2 ? process.argv.slice(2) : [ROOT];
const paths = [...new Set(roots.flatMap(documentsUnder))].sort();

const documents = [];
for (const path of paths) {
	try {
		documents.push({ path: shown(path), text: readFileSync(path, 'utf8') });
	} catch (error) {
		console.error(say(`the check cannot read ${path}: ${said(error)}`));
		process.exit(1);
	}
}

const result = survey(documents);
for (const line of reportLines(result)) {
	console.log(line);
}
if (surveyFails(result)) {
	for (const line of failureLines(result)) {
		console.error(line);
	}
	process.exit(1);
}
