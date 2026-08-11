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

export interface VaultEvidence {
	/** File events in the order the vault emitted them. */
	readonly events: readonly VaultFileEvent[];
	/** Contents at the end of the run, by path. */
	readonly files: Readonly<Record<string, string>>;
}

export interface NetworkEvidence {
	/** Whether global fetch was a thrower for the whole run. */
	readonly poisoned: boolean;
	/** Calls the poison refused during the run. */
	readonly attempts: readonly FetchAttempt[];
}

/**
 * A stretch of the run spent on work the engine observed remotely rather
 * than work a user asked for. The bounds are positions in the CalDAV
 * request log: `from` is the number of requests handled when the stretch
 * opened and `to` the number when it closed, so every request whose index
 * falls between them was issued inside it.
 */
export interface RemoteObservedWindow {
	readonly label: string;
	readonly from: number;
	readonly to: number;
}

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
	readonly syncLog: readonly SyncLogEntry[];
	readonly network: NetworkEvidence;
	readonly remoteObserved: readonly RemoteObservedWindow[];
	readonly secrets: readonly SensitiveValue[];
}

const NO_CALDAV: CalDavEvidence = { requests: [], scheduling: [] };
const NO_FEED: FeedEvidence = { requests: [] };
const NO_VAULT: VaultEvidence = { events: [], files: {} };

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
 * scanned without the scanners being told it exists.
 */
export function evidenceStrings(
	record: RunEvidence,
): readonly EvidenceString[] {
	const found: EvidenceString[] = [];
	const seen = new Set<object>();
	for (const [key, value] of Object.entries(record)) {
		if (!UNSCANNED_KEYS.has(key)) {
			walk(key, value, found, seen);
		}
	}
	return found;
}

function walk(
	where: string,
	value: unknown,
	found: EvidenceString[],
	seen: Set<object>,
): void {
	if (typeof value === 'string') {
		found.push({ where, text: value });
		return;
	}
	if (typeof value !== 'object' || value === null || seen.has(value)) {
		return;
	}
	seen.add(value);
	if (Array.isArray(value)) {
		const items: readonly unknown[] = value;
		items.forEach((item, index) => {
			walk(`${where}[${String(index)}]`, item, found, seen);
		});
		return;
	}
	for (const [key, child] of Object.entries(value)) {
		walk(join(where, key), child, found, seen);
	}
}

function join(where: string, key: string): string {
	return PLAIN_KEY.test(key)
		? `${where}.${key}`
		: `${where}[${JSON.stringify(key)}]`;
}
