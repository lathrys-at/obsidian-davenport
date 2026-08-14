/**
 * The note corpus. A vault can contain frontmatter in many shapes. This
 * corpus holds notes with the shapes that the code must read correctly.
 * Frontmatter is the block of YAML at the start of a note.
 *
 * The corpus holds these shapes:
 * - a block with comments;
 * - a block with the keys in alphabetical order;
 * - a block with the keys in reverse order;
 * - a block with each quoting style;
 * - a block with nested mappings;
 * - a block with sequences;
 * - a block with unicode characters;
 * - an empty block;
 * - a note with no block;
 * - a block that is not a mapping;
 * - a block that does not parse.
 *
 * The notes are data files in the `notes` directory. This module reads the
 * files when the module loads, and gives each file a type. Code that drives
 * a real vault can read the same files directly from disk.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface NoteFixture {
	/** The name of the file, without the extension. */
	readonly id: string;
	readonly fileName: string;
	/** The text of the file. The text is the same as the text on disk. */
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

/**
 * The names of the `.md` files in the notes directory, without the
 * extension and in alphabetical order. The function reads the directory,
 * and does not use the `IDS` list.
 */
export function noteFixtureNamesOnDisk(): readonly string[] {
	return readdirSync(FIXTURE_DIR)
		.filter((file) => file.endsWith(FIXTURE_EXTENSION))
		.map((file) => file.slice(0, -FIXTURE_EXTENSION.length))
		.sort();
}

/**
 * The fixture that has this id. If the corpus has no fixture with this id,
 * the function throws an error. The error names each id in the corpus.
 */
export function noteFixture(id: string): NoteFixture {
	const found = NOTE_FIXTURES.find((candidate) => candidate.id === id);
	if (found === undefined) {
		const known = NOTE_FIXTURES.map((candidate) => candidate.id).join(', ');
		throw new Error(
			`note corpus: no fixture with the id ${id}; use one of these ids: ${known}`,
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
			}; put the file back, or remove the id from the IDS list`,
		);
	}
	return { id, fileName, content };
}
