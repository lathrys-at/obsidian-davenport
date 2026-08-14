/**
 * The helper that builds a simulation. A test calls `runSimulation` with a
 * body to run and with the surfaces that the run uses. A surface is a part
 * of the world outside the engine that records what the run did: a mock
 * server, the fake vault, or the sync channel. When the run ends, the
 * helper collects what the surfaces recorded. The helper then evaluates
 * every registered sweep over that evidence. A sweep that objects fails the
 * test that owns the run, and the failure names the sweep and shows the
 * evidence that the sweep objected to.
 *
 * When the body throws, the error goes up unchanged and no sweep runs. The
 * error from the body is the failure that the test is about, and a sweep
 * report on top of that error would hide the error.
 */

import type { Logger, SyncLogEntry } from '../../../src/core/ports/logger';
import type {
	Unsubscribe,
	VaultFileEvent,
} from '../../../src/core/ports/vault';
import type { MockCalDavServer } from '../caldav-mock/server';
import type { FeedFixture } from '../feed-fixture/server';
import type { FakeVault } from '../obsidian-fake/vault';
import type { VaultSyncChannel } from '../vault-sync/channel';
import {
	evidence,
	type NetworkCursor,
	type RemoteObservedWindow,
	type RunEvidence,
	type SensitiveValue,
	type VaultChange,
} from './evidence';
import { fetchPoisonHolds, recordedFetchAttempts } from './fetch-poison';
import { sweeps, type SweepRegistry } from './registry';
import { SweepFailure } from './sweep';

/**
 * A vault change whose content the run captured, but did not read back yet.
 * The content arrives as a promise.
 */
interface PendingChange extends Omit<VaultChange, 'content'> {
	readonly content: Promise<string | null>;
}

export interface SimulationOptions {
	/** The name of the run. A sweep failure shows this name. */
	readonly name?: string;
	readonly caldav?: MockCalDavServer;
	readonly feed?: FeedFixture;
	readonly vault?: FakeVault;
	/**
	 * The sync channel. The run answers for each delivery that landed on
	 * this channel.
	 */
	readonly vaultSync?: VaultSyncChannel;
	/** The values that the run treats as secret from the start. */
	readonly secrets?: readonly SensitiveValue[];
	/**
	 * The sweep registry that the run evaluates. Defaults to the module
	 * registry that the setup file resets before each test.
	 */
	readonly registry?: SweepRegistry;
}

export interface SimulationRun {
	/** The sync log that the engine writes to. The entries are evidence. */
	readonly logger: Logger;
	/**
	 * Declares that a value is secret. A call after the start of the run is
	 * correct: the sweep that scans for secrets reads the evidence at the
	 * end of the run, and not while the run produces the evidence. Code that
	 * makes a token during the run therefore declares the token at the
	 * moment the token exists.
	 */
	registerSecret(secret: SensitiveValue): void;
	/**
	 * Marks `body` as work that the engine started from a remote
	 * observation, and not from a signal of the user. The run records a
	 * window with `label`, and each request that `body` issues belongs to
	 * that window.
	 */
	remoteObserved<T>(label: string, body: () => T | Promise<T>): Promise<T>;
	/** Returns the evidence that the run produced up to this moment. */
	evidence(): Promise<RunEvidence>;
}

/**
 * Runs `body` as one simulation. Then evaluates the sweeps over the
 * evidence that the run produced. Returns the value that `body` returned.
 */
export async function runSimulation<T>(
	options: SimulationOptions,
	body: (run: SimulationRun) => T | Promise<T>,
): Promise<T> {
	const run = new Simulation(options);
	try {
		const result = await body(run);
		await run.finish();
		return result;
	} finally {
		run.release();
	}
}

class Simulation implements SimulationRun {
	readonly logger: Logger;

	private readonly options: SimulationOptions;
	private readonly registry: SweepRegistry;
	private readonly name: string;
	private readonly syncLog: SyncLogEntry[] = [];
	private readonly vaultChanges: PendingChange[] = [];
	private readonly secrets: SensitiveValue[];
	private readonly windows: RemoteObservedWindow[] = [];
	private readonly attemptsBefore: number;
	private readonly poisonedAtStart: boolean;
	private unsubscribe: Unsubscribe | null = null;

	constructor(options: SimulationOptions) {
		this.options = options;
		this.registry = options.registry ?? sweeps;
		this.name = options.name ?? 'simulation';
		this.secrets = [...(options.secrets ?? [])];
		this.attemptsBefore = recordedFetchAttempts().length;
		this.poisonedAtStart = fetchPoisonHolds();
		this.logger = {
			log: (entry) => {
				this.syncLog.push(entry);
			},
		};
		const vault = options.vault;
		if (vault) {
			this.unsubscribe = vault.onFileEvent((event) => {
				this.vaultChanges.push({
					kind: event.kind,
					path: event.path,
					oldPath: event.kind === 'renamed' ? event.oldPath : null,
					content: contentAfter(vault, event),
				});
			});
		}
	}

	registerSecret(secret: SensitiveValue): void {
		if (secret.value === '') {
			throw new Error(
				`simulation ${this.name}: the empty string cannot be a secret, because every text holds the empty string. Register a value that is not empty.`,
			);
		}
		this.secrets.push(secret);
	}

	async remoteObserved<T>(
		label: string,
		body: () => T | Promise<T>,
	): Promise<T> {
		const from = this.cursor();
		try {
			return await body();
		} finally {
			this.windows.push({ label, from, to: this.cursor() });
		}
	}

	async evidence(): Promise<RunEvidence> {
		const { caldav, feed, vault, vaultSync } = this.options;
		return evidence({
			name: this.name,
			caldav: {
				requests: [...(caldav?.log.entries ?? [])],
				scheduling: [...(caldav?.scheduling.entries ?? [])],
			},
			feed: { requests: [...(feed?.log ?? [])] },
			vault: {
				changes: await Promise.all(
					this.vaultChanges.map(async (change) => ({
						kind: change.kind,
						path: change.path,
						oldPath: change.oldPath,
						content: await change.content,
					})),
				),
				files: await filesOf(vault),
			},
			vaultSync: { deliveries: [...(vaultSync?.log ?? [])] },
			syncLog: [...this.syncLog],
			network: {
				poisoned: this.poisonedAtStart && fetchPoisonHolds(),
				attempts: recordedFetchAttempts().slice(this.attemptsBefore),
			},
			remoteObserved: [...this.windows],
			secrets: [...this.secrets],
		});
	}

	/**
	 * Closes the listeners of the run. Then evaluates every registered sweep
	 * over the evidence of the run. When one sweep or more objects, throws
	 * one failure that carries every report.
	 */
	async finish(): Promise<void> {
		this.release();
		const reports = this.registry.evaluate(await this.evidence());
		if (reports.length > 0) {
			throw new SweepFailure(this.name, reports);
		}
	}

	release(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	/**
	 * Returns how many requests each network surface holds. The method names
	 * each surface here, and does not call the `networkCursor` builder. A
	 * new surface in the cursor type therefore stops this method from
	 * compiling until this method counts that surface.
	 */
	private cursor(): NetworkCursor {
		const { caldav, feed } = this.options;
		return {
			caldav: caldav?.log.entries.length ?? 0,
			feed: feed?.log.length ?? 0,
		};
	}
}

/**
 * The content that a change left in the file. The result is null when the
 * change deleted the file, and null when the read fails. The run starts the
 * read at the moment the change lands, and the fake vault does the read at
 * that moment and not later on the microtask queue. A caller that awaits
 * the result later therefore gets the content that the file held at the
 * time of the change, and not the content at the end of the run.
 */
function contentAfter(
	vault: FakeVault,
	event: VaultFileEvent,
): Promise<string | null> {
	if (event.kind === 'deleted') {
		return Promise.resolve(null);
	}
	return vault.read(event.path).catch(() => null);
}

async function filesOf(
	vault: FakeVault | undefined,
): Promise<Record<string, string>> {
	const files: Record<string, string> = {};
	if (!vault) {
		return files;
	}
	for (const path of vault.paths()) {
		files[path] = await vault.read(path);
	}
	return files;
}
