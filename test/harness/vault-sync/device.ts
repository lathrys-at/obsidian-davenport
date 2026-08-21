/**
 * One simulated device. The device holds an in-memory vault behind the
 * vault port. The device also holds three facts that the vault port has
 * no member for:
 *
 * - the modification time of each file;
 * - the version of each path, which says which changes this device saw;
 * - who wrote the content that the device holds at each path.
 *
 * An engine holds the device, and not the vault below the device. The
 * device captures each change that a caller makes through the device as
 * an outbound change, and counts one more change against the version of
 * the path. Thus a change starts on exactly one device.
 *
 * The channel lands an inbound delivery on `vault` below instead. The
 * vault emits the file events that a subscriber expects, and no
 * subscriber reads the arrival as a local edit. The channel then records
 * the version, the author, and the modification time that the landing
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
	 * The vault below the port. The channel writes here, so a landing
	 * starts no outbound change. A local edit goes through the device
	 * instead.
	 *
	 * A suite plants a file the same way when the suite wants a file on a
	 * device, and no device made that file. A plant that must stand against
	 * an incoming change also needs a call to `noteVersion`. Without that
	 * call the plant keeps the version of a path that no device changed,
	 * and every delivery covers that version. The delivery then overwrites
	 * the plant, and makes no conflict. The calls `noteModified` and
	 * `noteStamp` put the plant in time.
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

	async create(path: string, content: string): Promise<boolean> {
		if (!(await this.vault.create(path, content))) {
			return false;
		}
		this.stamp(path);
		this.capture({
			change: { kind: 'upsert', path, content },
			previousContent: null,
			version: this.advance(path),
			modifiedAt: this.clock.now(),
		});
		return true;
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

	/** The paths that the vault holds now, sorted by code unit. */
	paths(): readonly string[] {
		return this.vault.paths();
	}

	/**
	 * The whole vault as one string. The string holds one frame for each
	 * file, and the files come in path order.
	 */
	snapshot(): string {
		return this.vault.snapshot();
	}

	/** True when the vault holds the path. The caller awaits nothing. */
	holds(path: string): boolean {
		return this.vault.paths().includes(path);
	}

	/**
	 * The modification time that this device holds for the path. Null when
	 * the device holds no such file.
	 */
	modifiedAt(path: string): number | null {
		return this.modificationTimes.get(path) ?? null;
	}

	/** Records the modification time that a landing leaves on a path. */
	noteModified(path: string, at: number): void {
		this.modificationTimes.set(path, at);
	}

	/** Forgets the modification time of a path, because the file is gone. */
	forgetModified(path: string): void {
		this.modificationTimes.delete(path);
	}

	/**
	 * The version that this device holds for a path. A path that this
	 * device deleted keeps the version that the path had. Thus a deletion
	 * looks different from a path that this device never held.
	 */
	versionOf(path: string): PathVersion {
		return this.versions.get(path) ?? INITIAL_VERSION;
	}

	/** Records the version that a landing leaves on a path. */
	noteVersion(path: string, version: PathVersion): void {
		this.versions.set(path, version);
	}

	/**
	 * Who wrote the content that this device holds at a path, and when
	 * they wrote it. Null for a path that the device does not hold. Null
	 * also for a file that a suite planted in the vault with no stamp.
	 */
	stampOf(path: string): ContentStamp | null {
		return this.holds(path) ? (this.stamps.get(path) ?? null) : null;
	}

	/** Records who wrote the content that a landing leaves at a path. */
	noteStamp(path: string, stamp: ContentStamp): void {
		this.stamps.set(path, stamp);
	}

	private stamp(path: string): void {
		this.modificationTimes.set(path, this.clock.now());
		this.stamps.set(path, { author: this.id, at: this.clock.now() });
	}

	/** Counts one more local change to a path, and keeps the new version. */
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
