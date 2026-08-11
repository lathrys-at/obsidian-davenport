/**
 * The note-fixture corpus: frontmatter shapes a vault has to survive —
 * comments, both key orders, every quoting style, nested mappings,
 * sequences, unicode, an empty block, no block at all, a block that is not
 * a mapping, and one that does not parse.
 *
 * The notes are data files under `notes/`; this module is the typed way
 * into them. Anything driving a real vault can read the same files from
 * disk.
 */

import bodyWithDashes from './notes/body-with-dashes.md?raw';
import comments from './notes/comments.md?raw';
import emptyFrontmatter from './notes/empty-frontmatter.md?raw';
import keyOrderAlpha from './notes/key-order-alpha.md?raw';
import keyOrderReverse from './notes/key-order-reverse.md?raw';
import lists from './notes/lists.md?raw';
import minimal from './notes/minimal.md?raw';
import nested from './notes/nested.md?raw';
import noFrontmatter from './notes/no-frontmatter.md?raw';
import nonMapping from './notes/non-mapping.md?raw';
import quoteStyles from './notes/quote-styles.md?raw';
import scalars from './notes/scalars.md?raw';
import unicode from './notes/unicode.md?raw';
import unparseable from './notes/unparseable.md?raw';

/** Where the corpus lives, relative to the repository root. */
export const NOTE_FIXTURE_DIRECTORY = 'test/harness/fixtures/notes';

export interface NoteFixture {
	/** The file name without its extension. */
	readonly id: string;
	readonly fileName: string;
	/** The file's text, as written on disk. */
	readonly content: string;
}

export const NOTE_FIXTURES: readonly NoteFixture[] = [
	fixture('body-with-dashes', bodyWithDashes),
	fixture('comments', comments),
	fixture('empty-frontmatter', emptyFrontmatter),
	fixture('key-order-alpha', keyOrderAlpha),
	fixture('key-order-reverse', keyOrderReverse),
	fixture('lists', lists),
	fixture('minimal', minimal),
	fixture('nested', nested),
	fixture('no-frontmatter', noFrontmatter),
	fixture('non-mapping', nonMapping),
	fixture('quote-styles', quoteStyles),
	fixture('scalars', scalars),
	fixture('unicode', unicode),
	fixture('unparseable', unparseable),
];

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

function fixture(id: string, content: string): NoteFixture {
	return { id, fileName: `${id}.md`, content };
}
