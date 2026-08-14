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
 */

import type {
	Unsubscribe,
	VaultFileEvent,
	VaultPort,
} from '../../../src/core/ports/vault';
import { readFrontmatter, writeFrontmatter } from './frontmatter';

type FileEventHandler = (event: VaultFileEvent) => void;

export class FakeVault implements VaultPort {
	private readonly files = new Map<string, string>();
	private readonly handlers = new Set<FileEventHandler>();

	/**
	 * Seeds the vault with the given files. A seed is setup and not an
	 * operation. Therefore the constructor emits no event.
	 */
	constructor(initialFiles: Readonly<Record<string, string>> = {}) {
		for (const [path, content] of Object.entries(initialFiles)) {
			this.files.set(assertPath(path), content);
		}
	}

	read(path: string): Promise<string> {
		return settle(() => this.requireFile(path));
	}

	/**
	 * Creates the file, or writes over a file that is already there. A
	 * write to a path that the vault does not hold emits `created`. A
	 * write to a path that the vault already holds emits `modified`,
	 * whether or not the bytes changed. The constructor puts the given
	 * files into the vault. Therefore the first write to a path that the
	 * constructor supplied emits `modified`.
	 */
	write(path: string, content: string): Promise<void> {
		return settle(() => {
			assertPath(path);
			const existed = this.files.has(path);
			this.files.set(path, content);
			this.emit(
				existed
					? { kind: 'modified', path }
					: { kind: 'created', path },
			);
		});
	}

	exists(path: string): Promise<boolean> {
		return settle(() => this.files.has(assertPath(path)));
	}

	rename(path: string, newPath: string): Promise<void> {
		return settle(() => {
			const content = this.requireFile(path);
			assertPath(newPath);
			if (newPath === path) {
				throw new Error(
					`fake vault: the new path is the same path as the old path: ${path}`,
				);
			}
			if (this.files.has(newPath)) {
				throw new Error(
					`fake vault: the rename target exists: ${newPath}`,
				);
			}
			this.files.delete(path);
			this.files.set(newPath, content);
			this.emit({ kind: 'renamed', path: newPath, oldPath: path });
		});
	}

	/**
	 * Removes the file from the vault. The operation emits `deleted`. The
	 * fake models what the vault shows. The fake does not model where the
	 * bytes go.
	 */
	trash(path: string): Promise<void> {
		return settle(() => {
			this.requireFile(path);
			this.files.delete(path);
			this.emit({ kind: 'deleted', path });
		});
	}

	frontmatter(
		path: string,
	): Promise<Readonly<Record<string, unknown>> | null> {
		return settle(() => {
			const read = readFrontmatter(this.requireFile(path));
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
			const content = this.requireFile(path);
			this.files.set(path, writeFrontmatter(content, update));
			this.emit({ kind: 'modified', path });
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
		return [...this.files.keys()].sort(comparePaths);
	}

	/**
	 * The whole vault as one string. The string holds the files in path
	 * order, and a header line comes before the content of each file. Two
	 * vaults hold the same bytes exactly when their snapshots are equal.
	 */
	snapshot(): string {
		return [...this.files.entries()]
			.sort(([left], [right]) => comparePaths(left, right))
			.map(
				([path, content]) =>
					`=== ${path} (${String(content.length)} chars) ===\n${content}`,
			)
			.join('\n');
	}

	private requireFile(path: string): string {
		const content = this.files.get(assertPath(path));
		if (content === undefined) {
			throw new Error(`fake vault: this vault holds no file at ${path}`);
		}
		return content;
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

function assertPath(path: string): string {
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
	return path;
}

function comparePaths(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	return left > right ? 1 : 0;
}
