/**
 * The mock CalDAV server keeps two records, and the tests assert against
 * them. The first record is the request log. It holds every request that
 * the server handled.
 *
 * The second record is the scheduling record. Some writes touch a
 * resource that has attendees before the write or after the write. For a
 * write of this kind, a CalDAV server that supports scheduling sends
 * mail to the attendees of that resource. The scheduling record lists
 * the writes that would have caused such mail.
 *
 * Within one run, each record only takes new entries, and each new entry
 * goes at the end. Both records therefore keep the order of arrival. Only
 * the request path adds an entry. A test can also put state into the
 * server, or change that state, without a request. A change of that kind
 * stands for the work of a different client: the engine under test did
 * not send it, and neither record counts it against the engine.
 */

export type ReportKind =
	'sync-collection' | 'calendar-query' | 'calendar-multiget';

/**
 * The largest number of characters of a request body that one entry
 * keeps. The limit is 4096 characters. When the body is longer than the
 * limit, the entry keeps the first 4096 characters, and the entry also
 * says that the cut occurred.
 *
 * A calendar object is much smaller than this limit. A run that asserts
 * on the body that it sent therefore sees the whole body. A run can also
 * upload a body that is larger than the limit. The log then holds no
 * second copy of the whole body for as long as the log lives.
 *
 * A check that searches request bodies for credentials reads only the
 * characters that the entry keeps. A credential that sits after the cut
 * is a credential that such a check cannot report.
 */
export const REQUEST_BODY_CAP = 4096;

export interface RequestLogEntry {
	/** The place of the request in the arrival order. The first is zero. */
	readonly index: number;
	readonly method: string;
	readonly url: string;
	readonly path: string;
	readonly depth: string | null;
	readonly ifMatch: string | null;
	readonly ifNoneMatch: string | null;
	/**
	 * The kind of REPORT that the request carried. The value is null for a
	 * request that carried no REPORT of these kinds.
	 */
	readonly report: ReportKind | null;
	/**
	 * The sync token that a sync-collection REPORT presented. The value is
	 * empty text for an initial sync, which presents no token. The value is
	 * null for a request that is not a sync-collection REPORT.
	 */
	readonly syncToken: string | null;
	/**
	 * Every header that the request carried. The key of each entry is the
	 * name of the header in lower case.
	 */
	readonly headers: Readonly<Record<string, string>>;
	/**
	 * The body as the request sent it, cut at the limit. The value is empty
	 * text for a request that sent no body.
	 */
	readonly body: string;
	/** True when the limit cut the body short. */
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
	/**
	 * The whole body. The entry keeps the first part of this body, up to
	 * the limit.
	 */
	readonly body: string;
}

interface MutableLogEntry extends RequestLogEntry {
	status: number;
}

/**
 * The status of an entry before the server knows the response. The server
 * completes every request that it begins, and this includes a request
 * whose handling failed. Therefore no read of an entry finds this status.
 */
const PENDING_STATUS = 0;

export class RequestLog {
	private readonly items: MutableLogEntry[] = [];

	/**
	 * Adds an entry at the end of the log, and returns the index of that
	 * entry. The caller calls this method before the server handles the
	 * request. The log therefore holds the order of arrival, and not the
	 * order of completion.
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
 * How a write changed the set of attendees on a resource:
 *
 * - `gains`: the resource had no attendees before the write, and it has
 *   attendees after the write.
 * - `retains`: the resource had attendees before the write, and it has
 *   attendees after the write. A server that supports scheduling sends
 *   this write to the attendees as an update.
 * - `loses`: the resource had attendees before the write, and it has none
 *   after the write. This value covers two cases. In the first case, the
 *   write removed the last attendee. In the second case, the write
 *   deleted a resource that had attendees. A server that supports
 *   scheduling sends this write to the attendees as a cancellation.
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
	/**
	 * The index in the request log of the request that made this write.
	 */
	readonly requestIndex: number;
	readonly transition: AttendeeTransition;
}

export class SchedulingRecord {
	private readonly items: SchedulingEntry[] = [];

	/**
	 * Adds an entry for a write that would cause mail to attendees. A
	 * server that supports scheduling sends this mail. A write to a
	 * resource that has no attendees before the write and no attendees
	 * after the write causes no mail. This method drops such a write. The
	 * call sites do not make this check. Therefore no write path can
	 * forget the check.
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
