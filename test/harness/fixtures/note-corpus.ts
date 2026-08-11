/**
 * The note-fixture corpus: frontmatter shapes a vault has to survive —
 * comments, both key orders, every quoting style, nested mappings,
 * sequences, unicode, an empty block, no block at all, a block that is not
 * a mapping, and one that does not parse.
 *
 * The notes are data files under `notes/`; this module is the typed way
 * into them, read when it loads. Anything driving a real vault can read the
 * same files from disk.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface NoteFixture {
	/** The file name without its extension. */
	readonly id: string;
	readonly fileName: string;
	/** The file's text, as written on disk. */
	readonly content: string;
}

const FIXTURE_EXTENSION = '.md';
const FIXTURE_DIR = join(import.meta.dirname, 'notes');
const utf8 = new TextDecoder('utf-8', { fatal: true });

const IDS: readonly string[] = [
	'body-with-dashes',
	'comments',
	'empty-frontmatter',
	'key-order-alpha',
	'key-order-reverse',
	'lists',
	'minimal',
	'nested',
	'no-frontmatter',
	'non-mapping',
	'quote-styles',
	'scalars',
	'unicode',
	'unparseable',
];

export const NOTE_FIXTURES: readonly NoteFixture[] = IDS.map(readFixture);

/** The fixture names present on disk, whatever the list above holds. */
export function noteFixtureNamesOnDisk(): readonly string[] {
	return readdirSync(FIXTURE_DIR)
		.filter((file) => file.endsWith(FIXTURE_EXTENSION))
		.map((file) => file.slice(0, -FIXTURE_EXTENSION.length))
		.sort();
}

/** The fixture with this id, or an error naming the ids there are. */
export function noteFixture(id: string): NoteFixture {
	const found = NOTE_FIXTURES.find((candidate) => candidate.id === id);
	if (found === undefined) {
		const known = NOTE_FIXTURES.map((candidate) => candidate.id).join(', ');
		throw new Error(
			`note fixture: no fixture ${id}; corpus holds ${known}`,
		);
	}
	return found;
}

function readFixture(id: string): NoteFixture {
	const fileName = `${id}${FIXTURE_EXTENSION}`;
	const path = join(FIXTURE_DIR, fileName);
	let content: string;
	try {
		content = utf8.decode(readFileSync(path));
	} catch (error) {
		throw new Error(
			`note corpus: cannot read ${path}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	return { id, fileName, content };
}
