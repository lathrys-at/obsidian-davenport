/**
 * A simulated device: an in-memory vault behind the vault port, plus the
 * modification times the port has no member for.
 *
 * The device is what an engine holds. Every mutation made through it is
 * captured as an outbound change, so a change originates exactly once. The
 * channel lands inbound deliveries on `vault` underneath, which emits the
 * file events subscribers expect without the arrival being mistaken for a
 * local edit.
 */

import type {
	Unsubscribe,
	VaultFileEvent,
	VaultPort,
} from '../../../src/core/ports/vault';
import type { ControlledClock } from '../clock';
import { FakeVault } from '../obsidian-fake';
import type { CapturedChange, DeviceId } from './types';

export type CaptureSink = (change: CapturedChange) => void;

export class SyncDevice implements VaultPort {
	/**
	 * The vault underneath the port. The channel writes here so applying a
	 * delivery originates nothing; local edits go through the device.
	 */
	readonly vault: FakeVault;
	private readonly modificationTimes = new Map<string, number>();

	constructor(
		readonly id: DeviceId,
		private readonly clock: ControlledClock,
		private readonly capture: CaptureSink,
		initialFiles: Readonly<Record<string, string>> = {},
	) {
		this.vault = new FakeVault(initialFiles);
		for (const path of this.vault.paths()) {
			this.modificationTimes.set(path, clock.now());
		}
	}

	read(path: string): Promise<string> {
		return this.vault.read(path);
	}

	exists(path: string): Promise<boolean> {
		return this.vault.exists(path);
	}

	frontmatter(
		path: string,
	): Promise<Readonly<Record<string, unknown>> | null> {
		return this.vault.frontmatter(path);
	}

	onFileEvent(handler: (event: VaultFileEvent) => void): Unsubscribe {
		return this.vault.onFileEvent(handler);
	}

	async write(path: string, content: string): Promise<void> {
		const previousContent = await this.contentOrNull(path);
		await this.vault.write(path, content);
		this.stamp(path);
		this.capture({
			change: { kind: 'upsert', path, content },
			previousContent,
			modifiedAt: this.clock.now(),
		});
	}

	async rename(path: string, newPath: string): Promise<void> {
		const content = await this.vault.read(path);
		await this.vault.rename(path, newPath);
		this.modificationTimes.delete(path);
		this.stamp(newPath);
		this.capture({
			change: { kind: 'rename', path: newPath, oldPath: path, content },
			previousContent: content,
			modifiedAt: this.clock.now(),
		});
	}

	async trash(path: string): Promise<void> {
		const previousContent = await this.vault.read(path);
		await this.vault.trash(path);
		this.modificationTimes.delete(path);
		this.capture({
			change: { kind: 'delete', path },
			previousContent,
			modifiedAt: this.clock.now(),
		});
	}

	async updateFrontmatter(
		path: string,
		update: (frontmatter: Record<string, unknown>) => void,
	): Promise<void> {
		const previousContent = await this.vault.read(path);
		await this.vault.updateFrontmatter(path, update);
		const content = await this.vault.read(path);
		this.stamp(path);
		this.capture({
			change: { kind: 'upsert', path, content },
			previousContent,
			modifiedAt: this.clock.now(),
		});
	}

	/** Paths currently in the vault, sorted by code unit. */
	paths(): readonly string[] {
		return this.vault.paths();
	}

	/** The whole vault as one string, framed per file in path order. */
	snapshot(): string {
		return this.vault.snapshot();
	}

	/** Whether the path is in the vault, answered without awaiting. */
	holds(path: string): boolean {
		return this.vault.paths().includes(path);
	}

	/** The modification time this device holds, or null for no such file. */
	modifiedAt(path: string): number | null {
		return this.modificationTimes.get(path) ?? null;
	}

	/** Records the time a landed delivery leaves on a path. */
	noteModified(path: string, at: number): void {
		this.modificationTimes.set(path, at);
	}

	/** Forgets a path's modification time; the file is gone. */
	forgetModified(path: string): void {
		this.modificationTimes.delete(path);
	}

	private stamp(path: string): void {
		this.modificationTimes.set(path, this.clock.now());
	}

	private async contentOrNull(path: string): Promise<string | null> {
		return (await this.vault.exists(path))
			? await this.vault.read(path)
			: null;
	}
}
