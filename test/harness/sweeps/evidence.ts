/**
 * The record of what one simulation run leaves behind. A surface is one
 * place that a run records something in: a mock server, the vault, the
 * sync log, and so on. This record holds every surface that the harness
 * produces, behind one type. A sweep is a check over the evidence of one
 * run. One type lets an author write a sweep one time, and then run that
 * sweep over the record of every simulation.
 *
 * Every record holds every field. When a run does not connect a surface,
 * the record holds the empty form of that surface. Two results follow.
 * First, a sweep reads the same shape, whatever the run held. Second, a
 * surface that arrives later becomes a new field with an empty default,
 * and the callers do not change. The builder function below is the only
 * way to make a record, and this is what keeps the two results true.
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
	/** Every request that the mock server handled, in order of arrival. */
	readonly requests: readonly RequestLogEntry[];
	/**
	 * The writes that would make a real server send mail to the
	 * attendees. The mock server records these writes and sends no mail.
	 */
	readonly scheduling: readonly SchedulingEntry[];
}

export interface FeedEvidence {
	readonly requests: readonly FeedRequestRecord[];
}

/**
 * One change that the vault made, with the bytes that the change left
 * behind. The harness copies the content at the moment the change lands.
 * The harness does not read the content back at the end of the run. So
 * the record still holds a note that the run wrote and then deleted or
 * overwrote. The state at the end of the run is not the only state that
 * the engine must answer for.
 */
export interface VaultChange {
	readonly kind: VaultFileEvent['kind'];
	readonly path: string;
	/**
	 * The path that a rename moved the file from. The field is null for
	 * every other kind of change.
	 */
	readonly oldPath: string | null;
	/**
	 * The content of the file immediately after the change. The field is
	 * null when the change removed the file.
	 */
	readonly content: string | null;
}

export interface VaultEvidence {
	/**
	 * Every change that the vault made, in the order that the vault
	 * reported the changes.
	 */
	readonly changes: readonly VaultChange[];
	/** The content of each file at the end of the run, keyed by path. */
	readonly files: Readonly<Record<string, string>>;
}

/**
 * What the vault-sync channel moved during the run. The record holds
 * every delivery that landed, the change that the delivery carried, and
 * the way the destination took the change.
 *
 * This is an evidence surface and not a network surface. The channel is a
 * model of a sync tool that moves files between two vaults. A delivery is
 * not a request that the engine sent to a server. If a report counts a
 * delivery as a request, the report gives the wrong name to the delivery.
 * For this reason the cursor below has no field for the channel, and the
 * table of network surfaces has no entry for the channel.
 *
 * A sweep that walks the strings reads this surface like every other
 * surface, and the secrets scan is one such sweep. A sweep that counts
 * requests must not see this surface at all.
 */
export interface VaultSyncEvidence {
	readonly deliveries: readonly LandedDelivery[];
}

export interface NetworkEvidence {
	/**
	 * True when the fetch poison held for the full run. The poison
	 * replaces the global fetch function with a function that throws.
	 */
	readonly poisoned: boolean;
	/** The calls that the fetch poison refused during the run. */
	readonly attempts: readonly FetchAttempt[];
}

/**
 * The number of requests that each network surface handled at one moment.
 * One cursor holds a count for every surface at the same time. So the
 * two ends of a stretch of a run count every surface at once, and no
 * surface stays uncounted. A network surface that arrives later is a field
 * here and an entry in the table below, and the shape that a stretch
 * carries does not change. A surface that sends nothing to a server
 * belongs in the record above and not here. The vault-sync channel is
 * such a surface.
 */
export interface NetworkCursor {
	readonly caldav: number;
	readonly feed: number;
}

/**
 * Makes a cursor. The count is zero for each surface that the caller does
 * not give.
 */
export function networkCursor(
	parts: Partial<NetworkCursor> = {},
): NetworkCursor {
	return { caldav: parts.caldav ?? 0, feed: parts.feed ?? 0 };
}

/**
 * A stretch of the run. In this stretch the engine does work that a
 * remote observation started, and not work that a user asked for. Every
 * request that a surface recorded between the two cursors comes from
 * inside this stretch. Two stretches must not run at the same time. If
 * two stretches overlap, one request belongs to more than one stretch,
 * and the report names the wrong stretch.
 */
export interface RemoteObservedWindow {
	readonly label: string;
	readonly from: NetworkCursor;
	readonly to: NetworkCursor;
}

/**
 * One request in the form that a sweep reports. The form is the same for
 * every surface that recorded the request.
 */
export interface RecordedRequest {
	readonly where: string;
	readonly detail: string;
}

/**
 * One network surface, with the name of the cursor field that counts the
 * requests of that surface. A sweep that examines requests walks the
 * table below, and does not name the surfaces itself. So one new entry
 * in the table puts the new surface under all of those sweeps at the
 * same time.
 */
export interface NetworkSurface {
	readonly key: keyof NetworkCursor;
	requests(evidence: RunEvidence): readonly RecordedRequest[];
}

/**
 * The table has one entry for each field of the cursor. The type makes
 * the compiler keep the table and the cursor together: a new cursor field
 * does not compile until this table lists the surface for that field.
 * This is what keeps every surface under the sweeps that count requests.
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

/**
 * A value that the run declares sensitive. The label names the value, so
 * a report can cite the label and not the value.
 */
export interface SensitiveValue {
	readonly label: string;
	readonly value: string;
}

export interface RunEvidence {
	/** The name of the run. A sweep failure reports this name. */
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
 * Makes a record. For each surface that the caller does not give, the
 * builder puts in the empty form of that surface. A simulation run states
 * its network evidence directly. A record that a test makes by hand to
 * exercise a sweep takes the network evidence from the poison instead:
 * the record reports whether the poison holds at the moment of the call,
 * and this is the true answer for the process that makes the record.
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

/** One piece of text from the evidence, with the position of that text. */
export interface EvidenceString {
	/**
	 * The path from the root of the record to the text, in the spelling
	 * that a reader would type.
	 */
	readonly where: string;
	readonly text: string;
}

/**
 * The walk skips the registry of sensitive values. The registry holds the
 * values that the secrets scan looks for. If the walk read the registry,
 * each value would match itself, and the scan would report a violation
 * that is not real.
 */
const UNSCANNED_KEYS: ReadonlySet<string> = new Set(['secrets']);

const PLAIN_KEY = /^[A-Za-z_$][\w$]*$/;

/**
 * Every string that the record holds, with the position of each string.
 * The walk knows nothing about the surfaces that it crosses. So the walk
 * scans a surface that arrives later, and nobody has to tell the scanners
 * that this surface exists. The walk finds the text when the surface
 * keeps the text in strings, arrays, plain objects, maps, sets, or URLs.
 * The walk does not reach text that a surface stores as numbers or as
 * bytes. A surface that stores text in one of those two forms must
 * supply its own reader.
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
 * The `open` set holds the objects on the path back to the root. The set
 * does not hold every object that the walk visited before. The set exists
 * to stop a cycle. When the walk reaches one object at two positions, the
 * walk reports the object at both positions, because each position is a
 * leak.
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
