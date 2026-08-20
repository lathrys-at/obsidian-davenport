/**
 * A vault that counts what a caller wrote through it.
 *
 * Several claims of the plan are claims about writes that did not happen.
 * A device that holds the same state as the file writes nothing, and a
 * device that the skew rule holds back writes nothing. A test of such a
 * claim needs the count, and the vault port has no member for it.
 *
 * This class stands in front of another vault and counts. It changes
 * nothing else: every call goes on to the vault below, and the answer
 * comes back as it stands. The vault below can be the fake of the
 * Obsidian API, or one device of the sync simulator.
 */

import type {
	Unsubscribe,
	VaultFileEvent,
	VaultPort,
} from '../../src/core/ports/vault';

/** One write that a caller made through this vault. */
export interface RecordedWrite {
	readonly path: string;
	readonly content: string;
}

export class RecordingVault implements VaultPort {
	private readonly writes: RecordedWrite[] = [];
	private readonly trashed: string[] = [];

	constructor(private readonly below: VaultPort) {}

	/** Every write that a caller made, in the order in which they ran. */
	get written(): readonly RecordedWrite[] {
		return this.writes;
	}

	/** The paths that a caller wrote, in the order in which they ran. */
	get writtenPaths(): readonly string[] {
		return this.writes.map((write) => write.path);
	}

	/** Every path that a caller moved to the trash. */
	get trashedPaths(): readonly string[] {
		return this.trashed;
	}

	/** Forgets every write and every move to the trash. */
	forget(): void {
		this.writes.length = 0;
		this.trashed.length = 0;
	}

	read(path: string): Promise<string> {
		return this.below.read(path);
	}

	async write(path: string, content: string): Promise<void> {
		await this.below.write(path, content);
		this.writes.push({ path, content });
	}

	exists(path: string): Promise<boolean> {
		return this.below.exists(path);
	}

	rename(path: string, newPath: string): Promise<void> {
		return this.below.rename(path, newPath);
	}

	async trash(path: string): Promise<void> {
		await this.below.trash(path);
		this.trashed.push(path);
	}

	frontmatter(
		path: string,
	): Promise<Readonly<Record<string, unknown>> | null> {
		return this.below.frontmatter(path);
	}

	updateFrontmatter(
		path: string,
		update: (frontmatter: Record<string, unknown>) => void,
	): Promise<void> {
		return this.below.updateFrontmatter(path, update);
	}

	onFileEvent(handler: (event: VaultFileEvent) => void): Unsubscribe {
		return this.below.onFileEvent(handler);
	}
}
