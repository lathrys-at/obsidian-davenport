/**
 * In-memory vault fake. Files live in a map, every operation settles
 * without yielding to the event loop, and each mutating operation
 * delivers exactly one file event to every subscriber before its promise
 * settles, in the order the operations ran.
 *
 * The guarantee is determinism: the same sequence of operations against a
 * fresh fake always leaves the same files holding the same bytes and emits
 * the same events. It is not a claim that a real Obsidian vault produces
 * those bytes; that equivalence is measured against real installations.
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

	/** Seeds the vault. Seeding is setup, not an operation: no events. */
	constructor(initialFiles: Readonly<Record<string, string>> = {}) {
		for (const [path, content] of Object.entries(initialFiles)) {
			this.files.set(assertPath(path), content);
		}
	}

	read(path: string): Promise<string> {
		return settle(() => this.requireFile(path));
	}

	/**
	 * Creates or overwrites. A first write emits `created` and every later
	 * write emits `modified`, whether or not the bytes changed.
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
				throw new Error(`fake vault: rename to the same path: ${path}`);
			}
			if (this.files.has(newPath)) {
				throw new Error(`fake vault: rename target exists: ${newPath}`);
			}
			this.files.delete(path);
			this.files.set(newPath, content);
			this.emit({ kind: 'renamed', path: newPath, oldPath: path });
		});
	}

	/**
	 * Removes the file from the vault and emits `deleted`. The fake models
	 * what the vault shows, not where the bytes go.
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
	 * Rewrites the block through the deterministic writer and emits
	 * `modified`, whether or not the update changed anything. A note whose
	 * block does not read as a mapping is refused and left untouched.
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
	 * Subscribes to file events. Handlers run in subscription order, and a
	 * handler that unsubscribes during delivery does not see the event it
	 * is being delivered. Registering one function twice registers it once.
	 */
	onFileEvent(handler: FileEventHandler): Unsubscribe {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}

	/** Paths currently in the vault, sorted by code unit. */
	paths(): readonly string[] {
		return [...this.files.keys()].sort(comparePaths);
	}

	/**
	 * The whole vault as one string, framed per file in path order. Two
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
			throw new Error(`fake vault: no file at ${path}`);
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
		throw new Error('fake vault: path is empty');
	}
	if (path.startsWith('/')) {
		throw new Error(`fake vault: path is not vault-relative: ${path}`);
	}
	if (path.includes('\n')) {
		throw new Error('fake vault: path holds a line break');
	}
	return path;
}

function comparePaths(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	return left > right ? 1 : 0;
}
