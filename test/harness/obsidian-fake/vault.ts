/**
 * This class is a fake of the vault, and it keeps the files in memory.
 * The files live in a map. Every operation settles without a yield to
 * the event loop. Each operation that changes a file delivers exactly
 * one file event to every subscriber, before the promise of that
 * operation settles. The events come in the order in which the
 * operations ran.
 *
 * The fake gives one guarantee: the fake is deterministic. The same
 * sequence of operations against a fresh fake always leaves the same
 * files with the same bytes, and always emits the same events. The fake
 * does not claim that a real Obsidian vault writes those bytes. Runs
 * against real installations measure that equivalence.
 *
 * A filesystem profile decides which names this vault refuses, and which
 * names this vault cannot tell apart. The default profile is
 * permissive: it refuses no name, and each path names its own file. Under
 * another profile, two paths can name one file. The vault then keeps the
 * spelling that made the file, and the events of the vault carry that
 * spelling and not the spelling that the caller passed.
 */

import type {
	Unsubscribe,
	VaultFileEvent,
	VaultPort,
} from '../../../src/core/ports/vault';
import type { FilesystemProfile } from './filesystem-profile';
import { PERMISSIVE_FILESYSTEM } from './filesystem-profile';
import { readFrontmatter, writeFrontmatter } from './frontmatter';

type FileEventHandler = (event: VaultFileEvent) => void;

interface StoredFile {
	readonly path: string;
	readonly content: string;
}

interface FoundFile {
	readonly identity: string;
	readonly file: StoredFile;
}

export class FakeVault implements VaultPort {
	private readonly files = new Map<string, StoredFile>();
	private readonly handlers = new Set<FileEventHandler>();

	/**
	 * Seeds the vault with the given files. A seed is setup and not an
	 * operation. Therefore the constructor emits no event. The filesystem
	 * profile applies to the seed too: the constructor refuses a name that
	 * the profile refuses, and the constructor refuses two seeded paths
	 * that name one file, because no disk can hold that pair.
	 */
	constructor(
		initialFiles: Readonly<Record<string, string>> = {},
		private readonly filesystem: FilesystemProfile = PERMISSIVE_FILESYSTEM,
	) {
		for (const [path, content] of Object.entries(initialFiles)) {
			const identity = this.checkPath(path);
			const held = this.files.get(identity);
			if (held !== undefined) {
				throw new Error(
					`fake vault: this filesystem gives ${held.path} and ${path} one name`,
				);
			}
			this.files.set(identity, { path, content });
		}
	}

	read(path: string): Promise<string> {
		return settle(() => this.requireFile(path).file.content);
	}

	/**
	 * Creates the file, or writes over a file that is already there. A
	 * write to a path that the vault does not hold emits `created`. A
	 * write to a path that the vault already holds emits `modified`,
	 * whether or not the bytes changed. The constructor puts the given
	 * files into the vault. Therefore the first write to a path that the
	 * constructor supplied emits `modified`. The filesystem profile
	 * decides which paths the vault already holds: a write to a name that
	 * the profile cannot tell apart from a name in the vault reaches that
	 * file, and it keeps the spelling of that file.
	 */
	write(path: string, content: string): Promise<void> {
		return settle(() => {
			const identity = this.checkPath(path);
			const held = this.files.get(identity);
			const stored = held?.path ?? path;
			this.files.set(identity, { path: stored, content });
			this.emit(
				held === undefined
					? { kind: 'created', path: stored }
					: { kind: 'modified', path: stored },
			);
		});
	}

	exists(path: string): Promise<boolean> {
		return settle(() => this.files.has(this.checkPath(path)));
	}

	/**
	 * Moves the file to the new path. The operation refuses a new path
	 * that the vault already holds, and the filesystem profile decides
	 * which paths the vault holds. A rename that changes only the
	 * spelling of the name therefore refuses on a filesystem that cannot
	 * tell the two spellings apart. To get the new spelling on such a
	 * filesystem, rename the file two times, and use a third name in
	 * between.
	 */
	rename(path: string, newPath: string): Promise<void> {
		return settle(() => {
			const { identity, file } = this.requireFile(path);
			const target = this.checkPath(newPath);
			if (newPath === file.path) {
				throw new Error(
					`fake vault: the new path is the same path as the old path: ${path}`,
				);
			}
			if (this.files.has(target)) {
				throw new Error(
					`fake vault: the rename target exists: ${newPath}`,
				);
			}
			this.files.delete(identity);
			this.files.set(target, { path: newPath, content: file.content });
			this.emit({ kind: 'renamed', path: newPath, oldPath: file.path });
		});
	}

	/**
	 * Removes the file from the vault. The operation emits `deleted`. The
	 * fake models what the vault shows. The fake does not model where the
	 * bytes go.
	 */
	trash(path: string): Promise<void> {
		return settle(() => {
			const { identity, file } = this.requireFile(path);
			this.files.delete(identity);
			this.emit({ kind: 'deleted', path: file.path });
		});
	}

	frontmatter(
		path: string,
	): Promise<Readonly<Record<string, unknown>> | null> {
		return settle(() => {
			const read = readFrontmatter(this.requireFile(path).file.content);
			return read.kind === 'mapping' ? read.data : null;
		});
	}

	/**
	 * Rewrites the frontmatter block of the note through the
	 * deterministic writer. The operation emits `modified`, whether or
	 * not the update changed anything. If the frontmatter block does not
	 * read as a mapping, the operation refuses the note and changes
	 * nothing in that note.
	 */
	updateFrontmatter(
		path: string,
		update: (frontmatter: Record<string, unknown>) => void,
	): Promise<void> {
		return settle(() => {
			const { identity, file } = this.requireFile(path);
			this.files.set(identity, {
				path: file.path,
				content: writeFrontmatter(file.content, update),
			});
			this.emit({ kind: 'modified', path: file.path });
		});
	}

	/**
	 * Subscribes the handler to the file events. The handlers run in the
	 * order of subscription. If a handler unsubscribes a later handler
	 * during the same delivery, the vault does not call that later
	 * handler. A handler that unsubscribes itself still receives the
	 * event that the vault delivers at that moment. If a handler throws,
	 * the promise of the operation rejects, and the vault does not call
	 * the handlers after the handler that threw. The change stays: the
	 * vault does not undo the change. If you subscribe one function two
	 * times, the vault holds that function one time.
	 */
	onFileEvent(handler: FileEventHandler): Unsubscribe {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}

	/** The paths in the vault now, in the order of their code units. */
	paths(): readonly string[] {
		return [...this.files.values()]
			.map((file) => file.path)
			.sort(comparePaths);
	}

	/**
	 * The whole vault as one string. The string holds the files in path
	 * order, and a header line comes before the content of each file. Two
	 * vaults hold the same bytes exactly when their snapshots are equal.
	 */
	snapshot(): string {
		return [...this.files.values()]
			.sort((left, right) => comparePaths(left.path, right.path))
			.map(
				(file) =>
					`=== ${file.path} (${String(file.content.length)} chars) ===\n${file.content}`,
			)
			.join('\n');
	}

	/**
	 * Checks the path against the rules of the vault and against the
	 * filesystem profile, and gives back the identity of the path. Every
	 * operation starts here.
	 */
	private checkPath(path: string): string {
		assertPath(path);
		const refusal = this.filesystem.refusal(path);
		if (refusal !== null) {
			throw new Error(`fake vault: ${refusal}: ${path}`);
		}
		return this.filesystem.identity(path);
	}

	private requireFile(path: string): FoundFile {
		const identity = this.checkPath(path);
		const file = this.files.get(identity);
		if (file === undefined) {
			throw new Error(`fake vault: this vault holds no file at ${path}`);
		}
		return { identity, file };
	}

	private emit(event: VaultFileEvent): void {
		for (const handler of [...this.handlers]) {
			if (this.handlers.has(handler)) {
				handler(event);
			}
		}
	}
}

function settle<T>(operation: () => T): Promise<T> {
	try {
		return Promise.resolve(operation());
	} catch (error) {
		return Promise.reject(
			error instanceof Error ? error : new Error(String(error)),
		);
	}
}

function assertPath(path: string): void {
	if (path === '') {
		throw new Error('fake vault: the path is empty');
	}
	if (path.startsWith('/')) {
		throw new Error(
			`fake vault: the path is not relative to the vault root: ${path}`,
		);
	}
	if (path.includes('\n')) {
		throw new Error('fake vault: the path holds a line break');
	}
}

function comparePaths(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	return left > right ? 1 : 0;
}
