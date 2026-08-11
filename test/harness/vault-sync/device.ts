/**
 * A simulated device: an in-memory vault behind the vault port, plus the
 * modification times the port has no member for, the per-path versions
 * that say which changes this device has seen, and who wrote the content
 * it holds at each path.
 *
 * The device is what an engine holds. Every mutation made through it is
 * captured as an outbound change and counts one more change against the
 * path's version, so a change originates exactly once. The channel lands
 * inbound deliveries on `vault` underneath, which emits the file events
 * subscribers expect without the arrival being mistaken for a local edit,
 * and records the version, authorship, and modification time the landing
 * leaves.
 */

import type {
	Unsubscribe,
	VaultFileEvent,
	VaultPort,
} from '../../../src/core/ports/vault';
import type { ControlledClock } from '../clock';
import { FakeVault } from '../obsidian-fake';
import type { CapturedChange, ContentStamp, DeviceId } from './types';
import { bumpVersion, INITIAL_VERSION, type PathVersion } from './version';

export type CaptureSink = (change: CapturedChange) => void;

export class SyncDevice implements VaultPort {
	/**
	 * The vault underneath the port. The channel writes here so applying a
	 * delivery originates nothing; local edits go through the device. A
	 * suite plants a file the same way when it wants one on a device
	 * without any device having made it — and a plant meant to stand
	 * against an incoming change needs `noteVersion` beside it, since a
	 * file nobody is recorded as having changed is one every delivery
	 * covers and overwrites without a conflict. `noteModified` and
	 * `noteStamp` place the plant in time as well.
	 */
	readonly vault: FakeVault;
	private readonly modificationTimes = new Map<string, number>();
	private readonly versions = new Map<string, PathVersion>();
	private readonly stamps = new Map<string, ContentStamp>();

	constructor(
		readonly id: DeviceId,
		private readonly clock: ControlledClock,
		private readonly capture: CaptureSink,
		initialFiles: Readonly<Record<string, string>> = {},
	) {
		this.vault = new FakeVault(initialFiles);
		for (const path of this.vault.paths()) {
			this.modificationTimes.set(path, clock.now());
			this.stamps.set(path, { author: id, at: clock.now() });
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
			version: this.advance(path),
			modifiedAt: this.clock.now(),
		});
	}

	async rename(path: string, newPath: string): Promise<void> {
		const content = await this.vault.read(path);
		await this.vault.rename(path, newPath);
		this.modificationTimes.delete(path);
		this.stamp(newPath);
		const version = this.advance(path);
		this.versions.set(newPath, version);
		this.capture({
			change: { kind: 'rename', path: newPath, oldPath: path, content },
			previousContent: content,
			version,
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
			version: this.advance(path),
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
			version: this.advance(path),
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

	/**
	 * The version this device holds for a path. A path this device has
	 * deleted keeps the version it had, so a deletion is distinguishable
	 * from never having held the file at all.
	 */
	versionOf(path: string): PathVersion {
		return this.versions.get(path) ?? INITIAL_VERSION;
	}

	/** Records the version a landed delivery leaves on a path. */
	noteVersion(path: string, version: PathVersion): void {
		this.versions.set(path, version);
	}

	/**
	 * Who wrote the content this device holds at a path, and when. Null
	 * for a path the device does not hold, and for one planted straight
	 * into the vault without a stamp.
	 */
	stampOf(path: string): ContentStamp | null {
		return this.holds(path) ? (this.stamps.get(path) ?? null) : null;
	}

	/** Records who wrote the content a landed delivery leaves at a path. */
	noteStamp(path: string, stamp: ContentStamp): void {
		this.stamps.set(path, stamp);
	}

	private stamp(path: string): void {
		this.modificationTimes.set(path, this.clock.now());
		this.stamps.set(path, { author: this.id, at: this.clock.now() });
	}

	/** Counts one more local change to a path and records the result. */
	private advance(path: string): PathVersion {
		const version = bumpVersion(this.versionOf(path), this.id);
		this.versions.set(path, version);
		return version;
	}

	private async contentOrNull(path: string): Promise<string | null> {
		return (await this.vault.exists(path))
			? await this.vault.read(path)
			: null;
	}
}
