/**
 * A double of the frontmatter writer of Obsidian.
 *
 * The real method reads the block of a note, gives the keys to a function,
 * and writes the block again from what that function leaves. This double
 * does the same, and it writes the block with the deterministic writer of
 * this harness. The double therefore states what one call changes in a
 * note, and it counts the calls.
 *
 * The double is not a claim about the bytes that real Obsidian writes. The
 * verification protocol measures those bytes.
 */

import { writeFrontmatter } from './frontmatter';

/** One call that the double took. */
export interface FrontmatterCall {
	readonly path: string;
	/** The text of the note before the call. */
	readonly before: string;
	/** The text of the note after the call. */
	readonly after: string;
}

export class FakeFileManager {
	private readonly notes = new Map<string, string>();
	private readonly taken: FrontmatterCall[] = [];
	private failure: Error | null = null;

	constructor(notes: Readonly<Record<string, string>> = {}) {
		for (const [path, content] of Object.entries(notes)) {
			this.notes.set(path, content);
		}
	}

	/** The calls that the double took, in the order of the calls. */
	get calls(): readonly FrontmatterCall[] {
		return this.taken;
	}

	/** The text of one note. */
	note(path: string): string {
		const content = this.notes.get(path);
		if (content === undefined) {
			throw new Error(`the fake file manager holds no note at ${path}`);
		}
		return content;
	}

	/**
	 * Makes every later call throw this error. The real method throws where
	 * the block of the note does not parse, and where the file cannot be
	 * written.
	 */
	throwOnWrite(error: Error): void {
		this.failure = error;
	}

	/**
	 * The file that this double takes for a path. The real method takes the
	 * file object of the vault, and this double reads the path of it alone.
	 */
	file(path: string): { readonly path: string } {
		return { path };
	}

	processFrontMatter(
		file: { readonly path: string },
		update: (frontmatter: Record<string, unknown>) => void,
	): Promise<void> {
		if (this.failure !== null) {
			return Promise.reject(this.failure);
		}
		const before = this.notes.get(file.path) ?? '';
		const after = writeFrontmatter(before, update);
		this.notes.set(file.path, after);
		this.taken.push({ path: file.path, before, after });
		return Promise.resolve();
	}
}
