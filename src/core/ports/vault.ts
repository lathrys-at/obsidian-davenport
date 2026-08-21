/**
 * The vault port gives the engine its only view of note files and of the
 * metadata of those files. The fake that the tests use implements this
 * port. The adapter for Obsidian implements this port too. The fake is
 * deterministic, which means that the same operations always give the same
 * result. Code in the core never imports a platform API.
 */

/**
 * A file event tells the engine what happened to one file. The event for a
 * new file is separate from the event for a changed file. The arrival of a
 * file is important on its own, for two reasons. Some sync tools do a
 * rename as a delete and then a create. A note can also arrive before the
 * record of that note arrives.
 */
export type VaultFileEvent =
	| { readonly kind: 'created'; readonly path: string }
	| { readonly kind: 'modified'; readonly path: string }
	| {
			readonly kind: 'renamed';
			readonly path: string;
			readonly oldPath: string;
	  }
	| { readonly kind: 'deleted'; readonly path: string };

export type Unsubscribe = () => void;

export interface VaultPort {
	read(path: string): Promise<string>;
	/**
	 * Creates the file, or replaces the content of a file that exists. The
	 * method always writes. A caller that wants to write only after a
	 * change must compare the content first.
	 */
	write(path: string, content: string): Promise<void>;
	/**
	 * Writes the file where no file stands at the path. The method answers
	 * true where it wrote the file, and false where a file already stands
	 * there. A false answer leaves that file as it is.
	 *
	 * The look and the write are one operation. A caller that asks
	 * {@link exists} and then writes leaves a window open between the two
	 * questions, and a file that arrives in that window loses its content.
	 * A caller that must not write over a file therefore calls this method
	 * and reads the answer.
	 */
	create(path: string, content: string): Promise<boolean>;
	exists(path: string): Promise<boolean>;
	rename(path: string, newPath: string): Promise<void>;
	/**
	 * Moves the file to the trash. The method obeys the setting that the
	 * user chose for deleted files. The method never deletes a file
	 * permanently.
	 */
	trash(path: string): Promise<void>;
	/**
	 * Reads the frontmatter of the note and returns the fields. The method
	 * returns null when the note has no frontmatter, and also when the
	 * frontmatter does not parse.
	 */
	frontmatter(
		path: string,
	): Promise<Readonly<Record<string, unknown>> | null>;
	/**
	 * Changes the frontmatter of the note through the writer of the
	 * platform. A test measures whether the real writer makes the same
	 * bytes on each device. The fake does not assume that the real writer
	 * makes the same bytes.
	 */
	updateFrontmatter(
		path: string,
		update: (frontmatter: Record<string, unknown>) => void,
	): Promise<void>;
	onFileEvent(handler: (event: VaultFileEvent) => void): Unsubscribe;
}
