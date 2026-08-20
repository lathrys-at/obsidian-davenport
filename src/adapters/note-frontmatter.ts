/**
 * The write of frontmatter into a note, through the API of Obsidian.
 *
 * Obsidian reads the block of the note, gives the keys to a function, and
 * writes the block again from what that function leaves. This module gives
 * that function the change that the engine computed. One call therefore
 * makes one write, and the note never stands between two writes with half
 * of a change in it.
 *
 * The module holds no rule of its own. The engine decides which keys the
 * write sets and which keys the write removes, and this module carries
 * that decision to the platform.
 *
 * Obsidian throws where the block of the note does not parse, and it
 * throws where the file cannot be written. This module gives the caller a
 * result in place of that error, because a note that a user broke by hand
 * is a condition that the plugin states to the user, and not a fault of
 * the plugin.
 */

import type { FrontmatterPatch } from '../core/frontmatter/write';
import { applyPatch } from '../core/frontmatter/write';

/**
 * The part of the file manager of Obsidian that this module uses. The
 * `FileManager` class of the API satisfies this interface. The interface
 * states the one method, so a test drives this module with a double of
 * that method.
 *
 * The type of the file comes from the writer. The file manager of the
 * platform takes the file object of the vault, and a caller that passes
 * that manager therefore has to pass such a file object. A double of the
 * method states the type that the double takes.
 */
export interface FrontmatterWriter<File> {
	processFrontMatter(
		file: File,
		update: (frontmatter: Record<string, unknown>) => void,
	): Promise<void>;
}

/** What one write of frontmatter gives back. */
export type NoteWriteResult =
	{ readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Writes the change into the frontmatter of one note. The write sets the
 * keys of the change and removes the keys of the change, and it leaves
 * every other key of the note as it is.
 */
export async function writeNoteFrontmatter<File>(
	writer: FrontmatterWriter<File>,
	file: File,
	patch: FrontmatterPatch,
): Promise<NoteWriteResult> {
	try {
		await writer.processFrontMatter(file, (frontmatter) => {
			applyPatch(frontmatter, patch);
		});
	} catch (error) {
		return {
			ok: false,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
	return { ok: true };
}
