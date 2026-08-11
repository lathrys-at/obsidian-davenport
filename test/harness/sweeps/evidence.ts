/**
 * What one simulation run leaves behind: every assertion surface the
 * harness produces, gathered behind one type so a standing assertion is
 * written once and evaluated against every run.
 *
 * Every field is present on every record. A surface a run did not wire in
 * contributes its empty form, so a sweep reads the same shape whatever the
 * run held, and a surface that arrives later becomes a new field with an
 * empty default rather than a change every caller has to absorb. The
 * builder below is the only way to make a record, which is what keeps that
 * true.
 */

import type { SyncLogEntry } from '../../../src/core/ports/logger';
import type { VaultFileEvent } from '../../../src/core/ports/vault';
import type {
	RequestLogEntry,
	SchedulingEntry,
} from '../caldav-mock/observation';
import type { FeedRequestRecord } from '../feed-fixture/server';
import type { LandedDelivery } from '../vault-sync/types';
import { fetchPoisonHolds, type FetchAttempt } from './fetch-poison';

export interface CalDavEvidence {
	/** Every request the mock server handled, in arrival order. */
	readonly requests: readonly RequestLogEntry[];
	/** The writes a scheduling-capable server would have mailed on. */
	readonly scheduling: readonly SchedulingEntry[];
}

export interface FeedEvidence {
	readonly requests: readonly FeedRequestRecord[];
}

/**
 * One change the vault made, with the bytes it left behind. Content is
 * captured as the change lands rather than read back later, so a note
 * written and then trashed or overwritten is still in the record: the end
 * of the run is not the only state the engine is answerable for.
 */
export interface VaultChange {
	readonly kind: VaultFileEvent['kind'];
	readonly path: string;
	/** Where a rename moved from; null for every other kind. */
	readonly oldPath: string | null;
	/** What the file held just after the change; null once it is gone. */
	readonly content: string | null;
}

export interface VaultEvidence {
	/** Every change the vault made, in the order it emitted them. */
	readonly changes: readonly VaultChange[];
	/** Contents at the end of the run, by path. */
	readonly files: Readonly<Record<string, string>>;
}

/**
 * What the vault-sync channel moved during the run: every delivery that
 * landed, with the change it carried and how the destination took it.
 *
 * This is an evidence surface and not a network one. The channel models a
 * sync tool moving files between two vaults, so a delivery is not a
 * request the engine issued to a server and counting it as one would put
 * the wrong name in a report — which is why there is no cursor field for
 * it below and no entry in the surface table. A sweep that walks strings,
 * the secrets scan among them, reads it like every other surface; a sweep
 * that counts requests must not see it at all.
 */
export interface VaultSyncEvidence {
	readonly deliveries: readonly LandedDelivery[];
}

export interface NetworkEvidence {
	/** Whether global fetch was a thrower for the whole run. */
	readonly poisoned: boolean;
	/** Calls the poison refused during the run. */
	readonly attempts: readonly FetchAttempt[];
}

/**
 * How many requests each network surface had handled at one moment. A
 * stretch of a run is bounded on all of them at once, so no surface can be
 * the one nobody thought to count; a network surface that arrives later is
 * a field here and an entry in the table below, not a change to the shape
 * a stretch carries. A surface that talks to no server — the vault-sync
 * channel is one — belongs in the record above and not here.
 */
export interface NetworkCursor {
	readonly caldav: number;
	readonly feed: number;
}

/** A cursor with every surface the caller left out set to zero. */
export function networkCursor(
	parts: Partial<NetworkCursor> = {},
): NetworkCursor {
	return { caldav: parts.caldav ?? 0, feed: parts.feed ?? 0 };
}

/**
 * A stretch of the run spent on work the engine observed remotely rather
 * than work a user asked for. Every request a surface recorded between the
 * two cursors was issued inside it. Stretches must not run concurrently:
 * overlapping windows attribute one request to several stretches and the
 * report names the wrong one.
 */
export interface RemoteObservedWindow {
	readonly label: string;
	readonly from: NetworkCursor;
	readonly to: NetworkCursor;
}

/** A request as a sweep reports it, whichever surface recorded it. */
export interface RecordedRequest {
	readonly where: string;
	readonly detail: string;
}

/**
 * A network surface, paired with the cursor field that counts it. A sweep
 * that cares about requests walks this table rather than naming surfaces,
 * so adding one here is what puts it under every such sweep at once.
 */
export interface NetworkSurface {
	readonly key: keyof NetworkCursor;
	requests(evidence: RunEvidence): readonly RecordedRequest[];
}

/**
 * Keyed by cursor field so the compiler holds the table and the cursor in
 * lockstep: a new cursor field fails to compile here until its surface is
 * listed, which is what keeps every surface under the request sweeps.
 */
const NETWORK_SURFACE_TABLE: {
	readonly [K in keyof NetworkCursor]: NetworkSurface & { readonly key: K };
} = {
	caldav: {
		key: 'caldav',
		requests: (record) =>
			record.caldav.requests.map((entry, index) => ({
				where: `caldav.requests[${String(index)}]`,
				detail: `${entry.method} ${entry.path}`,
			})),
	},
	feed: {
		key: 'feed',
		requests: (record) =>
			record.feed.requests.map((entry, index) => ({
				where: `feed.requests[${String(index)}]`,
				detail: `${entry.method} ${entry.url}`,
			})),
	},
};

export const NETWORK_SURFACES: readonly NetworkSurface[] = Object.values(
	NETWORK_SURFACE_TABLE,
);

/** A value the run declared sensitive, named so a report can cite it. */
export interface SensitiveValue {
	readonly label: string;
	readonly value: string;
}

export interface RunEvidence {
	/** Names the run in a sweep failure. */
	readonly name: string;
	readonly caldav: CalDavEvidence;
	readonly feed: FeedEvidence;
	readonly vault: VaultEvidence;
	readonly vaultSync: VaultSyncEvidence;
	readonly syncLog: readonly SyncLogEntry[];
	readonly network: NetworkEvidence;
	readonly remoteObserved: readonly RemoteObservedWindow[];
	readonly secrets: readonly SensitiveValue[];
}

const NO_CALDAV: CalDavEvidence = { requests: [], scheduling: [] };
const NO_FEED: FeedEvidence = { requests: [] };
const NO_VAULT: VaultEvidence = { changes: [], files: {} };
const NO_VAULT_SYNC: VaultSyncEvidence = { deliveries: [] };

/**
 * Builds a record, filling every surface the caller left out. A run states
 * its network evidence outright; a record built by hand to exercise a
 * sweep reports whether the poison holds at the moment it is built, which
 * is the true answer for the process it is built in.
 */
export function evidence(parts: Partial<RunEvidence> = {}): RunEvidence {
	return {
		name: parts.name ?? 'unnamed run',
		caldav: parts.caldav ?? NO_CALDAV,
		feed: parts.feed ?? NO_FEED,
		vault: parts.vault ?? NO_VAULT,
		vaultSync: parts.vaultSync ?? NO_VAULT_SYNC,
		syncLog: parts.syncLog ?? [],
		network: parts.network ?? {
			poisoned: fetchPoisonHolds(),
			attempts: [],
		},
		remoteObserved: parts.remoteObserved ?? [],
		secrets: parts.secrets ?? [],
	};
}

/** Text found in the evidence, with the position it sits at. */
export interface EvidenceString {
	/** A path from the record root, in the spelling a reader would type. */
	readonly where: string;
	readonly text: string;
}

/**
 * The registry of sensitive values is skipped: it holds the needles, and
 * every one of them would otherwise match itself.
 */
const UNSCANNED_KEYS: ReadonlySet<string> = new Set(['secrets']);

const PLAIN_KEY = /^[A-Za-z_$][\w$]*$/;

/**
 * Every string the evidence carries, with where it sits. The walk knows
 * nothing about the surfaces it crosses, so a surface added later is
 * scanned without the scanners being told it exists — as long as it holds
 * its text in strings, arrays, plain objects, maps, sets, or URLs. Text
 * encoded as numbers or octets is not reached, and a surface that carries
 * either owes its own reader.
 */
export function evidenceStrings(
	record: RunEvidence,
): readonly EvidenceString[] {
	const found: EvidenceString[] = [];
	for (const [key, value] of Object.entries(record)) {
		if (!UNSCANNED_KEYS.has(key)) {
			walk(key, value, found, new Set());
		}
	}
	return found;
}

/**
 * `open` holds the objects on the path back to the root, not every object
 * already visited: it exists to stop a cycle, and an object reachable at
 * two positions is reported at both, because either one is a leak.
 */
function walk(
	where: string,
	value: unknown,
	found: EvidenceString[],
	open: Set<object>,
): void {
	if (typeof value === 'string') {
		found.push({ where, text: value });
		return;
	}
	if (typeof value !== 'object' || value === null || open.has(value)) {
		return;
	}
	if (value instanceof URL) {
		found.push({ where, text: value.href });
		return;
	}
	open.add(value);
	if (Array.isArray(value)) {
		const items: readonly unknown[] = value;
		items.forEach((item, index) => {
			walk(`${where}[${String(index)}]`, item, found, open);
		});
	} else if (value instanceof Map) {
		const entries: readonly [unknown, unknown][] = [...value];
		for (const [key, item] of entries) {
			walk(join(where, String(key)), item, found, open);
		}
	} else if (value instanceof Set) {
		const items: readonly unknown[] = [...value];
		items.forEach((item, index) => {
			walk(`${where}[${String(index)}]`, item, found, open);
		});
	} else {
		for (const [key, child] of Object.entries(value)) {
			walk(join(where, key), child, found, open);
		}
	}
	open.delete(value);
}

function join(where: string, key: string): string {
	return PLAIN_KEY.test(key)
		? `${where}.${key}`
		: `${where}[${JSON.stringify(key)}]`;
}
