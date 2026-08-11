/**
 * The two surfaces tests assert against: an ordered log of every request
 * the server handled, and the scheduling record — the ledger of writes a
 * scheduling-capable server would have turned into mail to attendees.
 *
 * Both are append-only within a run and ordered by arrival. Entries are
 * added by the request path only: state seeded or changed out of band
 * stands for another client's work, which neither this engine issued nor
 * would be blamed for.
 */

export type ReportKind =
	'sync-collection' | 'calendar-query' | 'calendar-multiget';

/**
 * How much of a request body an entry keeps: 4096 characters, after which
 * the body is cut and the entry says it was. A calendar object is far
 * smaller than that, so a run asserting on what it sent sees all of it,
 * while a run that uploads something large does not hold a second copy of
 * it for as long as the log lives. Anything scanning bodies for credential
 * material reads what is kept, so a value hidden past the cut is a value
 * the scan cannot report.
 */
export const REQUEST_BODY_CAP = 4096;

export interface RequestLogEntry {
	/** Arrival order, from zero. */
	readonly index: number;
	readonly method: string;
	readonly url: string;
	readonly path: string;
	readonly depth: string | null;
	readonly ifMatch: string | null;
	readonly ifNoneMatch: string | null;
	/** The REPORT this request carried, or null for other methods. */
	readonly report: ReportKind | null;
	/** The token a sync-collection presented; empty text for initial sync. */
	readonly syncToken: string | null;
	/** Every header the request carried, keyed by its lowercased name. */
	readonly headers: Readonly<Record<string, string>>;
	/** The body as sent, cut at the cap; empty text where none was sent. */
	readonly body: string;
	/** Whether the cap cut the body short. */
	readonly bodyTruncated: boolean;
	readonly status: number;
}

export interface RequestLogDraft {
	readonly method: string;
	readonly url: string;
	readonly path: string;
	readonly depth: string | null;
	readonly ifMatch: string | null;
	readonly ifNoneMatch: string | null;
	readonly report: ReportKind | null;
	readonly syncToken: string | null;
	readonly headers: Readonly<Record<string, string>>;
	/** The whole body; the log keeps as much of it as the cap allows. */
	readonly body: string;
}

interface MutableLogEntry extends RequestLogEntry {
	status: number;
}

/**
 * Status is unset until the response is known. Every request the server
 * begins is completed, including one whose handling failed, so no entry is
 * ever read carrying this.
 */
const PENDING_STATUS = 0;

export class RequestLog {
	private readonly items: MutableLogEntry[] = [];

	/**
	 * Reserves this request's place in the order before it is handled, so
	 * the log records arrival rather than completion.
	 */
	begin(draft: RequestLogDraft): number {
		const index = this.items.length;
		this.items.push({
			...draft,
			index,
			body: draft.body.slice(0, REQUEST_BODY_CAP),
			bodyTruncated: draft.body.length > REQUEST_BODY_CAP,
			status: PENDING_STATUS,
		});
		return index;
	}

	complete(index: number, status: number): void {
		const entry = this.items[index];
		if (entry) {
			entry.status = status;
		}
	}

	get entries(): readonly RequestLogEntry[] {
		return this.items;
	}

	get methods(): readonly string[] {
		return this.items.map((entry) => entry.method);
	}

	get paths(): readonly string[] {
		return this.items.map((entry) => entry.path);
	}

	where(
		predicate: (entry: RequestLogEntry) => boolean,
	): readonly RequestLogEntry[] {
		return this.items.filter(predicate);
	}

	forPath(path: string): readonly RequestLogEntry[] {
		return this.where((entry) => entry.path === path);
	}

	count(method: string): number {
		return this.where((entry) => entry.method === method).length;
	}

	clear(): void {
		this.items.length = 0;
	}
}

/**
 * How a write moved the resource's attendee set. `retains` is a write to a
 * resource that had attendees before and after, which servers propagate as
 * an update; `loses` covers both removing the last attendee and deleting
 * an attendee-bearing resource, which servers propagate as a cancellation.
 */
export type AttendeeTransition = 'gains' | 'loses' | 'retains';

export interface SchedulingFact {
	readonly method: 'PUT' | 'DELETE' | 'POST';
	readonly href: string;
	readonly attendeesBefore: readonly string[];
	readonly attendeesAfter: readonly string[];
}

export interface SchedulingEntry extends SchedulingFact {
	readonly index: number;
	/** Position of the write in the request log. */
	readonly requestIndex: number;
	readonly transition: AttendeeTransition;
}

export class SchedulingRecord {
	private readonly items: SchedulingEntry[] = [];

	/**
	 * Records a write that would notify. Writes touching no attendees on
	 * either side are not scheduling events and are dropped here rather
	 * than at the call sites, so no write path can forget the check.
	 */
	record(requestIndex: number, fact: SchedulingFact): void {
		const before = fact.attendeesBefore.length > 0;
		const after = fact.attendeesAfter.length > 0;
		if (!before && !after) {
			return;
		}
		this.items.push({
			...fact,
			index: this.items.length,
			requestIndex,
			transition: !before ? 'gains' : after ? 'retains' : 'loses',
		});
	}

	get entries(): readonly SchedulingEntry[] {
		return this.items;
	}

	forHref(href: string): readonly SchedulingEntry[] {
		return this.items.filter((entry) => entry.href === href);
	}

	clear(): void {
		this.items.length = 0;
	}
}
