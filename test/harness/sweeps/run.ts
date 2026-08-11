/**
 * The helper a simulation is built through. It holds the surfaces the run
 * uses, gathers what they recorded when the run ends, evaluates every
 * registered sweep over the result, and fails the owning test with the
 * sweep's name and the evidence it objected to.
 *
 * A body that throws propagates untouched and no sweep runs: the thrown
 * error is the failure the test is about, and a sweep result on top of it
 * would bury it.
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

/** A change whose bytes are captured but not yet read back out. */
interface PendingChange extends Omit<VaultChange, 'content'> {
	readonly content: Promise<string | null>;
}

export interface SimulationOptions {
	/** Names the run in a sweep failure. */
	readonly name?: string;
	readonly caldav?: MockCalDavServer;
	readonly feed?: FeedFixture;
	readonly vault?: FakeVault;
	/** The sync channel whose landed deliveries the run answers for. */
	readonly vaultSync?: VaultSyncChannel;
	/** Values the run treats as credential material from the start. */
	readonly secrets?: readonly SensitiveValue[];
	/** Defaults to the module registry the setup file resets. */
	readonly registry?: SweepRegistry;
}

export interface SimulationRun {
	/** The sync log the engine writes through; its entries are evidence. */
	readonly logger: Logger;
	/**
	 * Declares a value credential material. Registering it later than the
	 * run start is fine — the scan reads the evidence at the end, not as it
	 * is produced — so a token minted mid-run is registered when it exists.
	 */
	registerSecret(secret: SensitiveValue): void;
	/**
	 * Marks `body` as work the engine took on from a remote observation
	 * rather than a user's signal. Requests issued inside it are attributed
	 * to it.
	 */
	remoteObserved<T>(label: string, body: () => T | Promise<T>): Promise<T>;
	/** What the run has produced so far. */
	evidence(): Promise<RunEvidence>;
}

/**
 * Runs `body` as one simulation and evaluates the sweeps over what it
 * produced. Returns whatever the body returned.
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
				`simulation ${this.name}: the empty string cannot be registered as a secret, it appears everywhere`,
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
	 * Closes the run's listeners and evaluates every registered sweep over
	 * what it produced, raising one failure carrying all of them.
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
	 * Stated surface by surface rather than through the cursor builder, so a
	 * surface added to the cursor stops compiling here until this counts it.
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
 * The bytes a change left. The read is issued as the change lands and the
 * fake vault performs it there rather than on the microtask queue, so
 * awaiting the result later still yields what the file held at the time
 * rather than its state at the end of the run.
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
