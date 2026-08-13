/**
 * An ICS feed server that runs in the test process, behind the transport
 * port.
 *
 * Each feed carries a script. The script names one variant for each poll, in
 * order: poll 1 serves the first variant, poll 2 serves the second variant,
 * and so on. A test therefore states "the third fetch is truncated" as data,
 * and not as a callback.
 *
 * The fixture reads no clock and uses no random source. The caller gives the
 * fixture the reference time, and every generated stamp derives from that
 * time. A stamp that changes from poll to poll derives from the poll
 * counter. Two identical scripts therefore serve identical octets.
 */

import type {
	HttpRequest,
	HttpResponse,
	HttpTransport,
} from '../../../src/core/ports/transport';
import { encodeIcsBytes } from '../ics-octets';
import type { FeedVariant, ServedBody } from './variants';
import { renderVariant } from './variants';

/**
 * The error for a feed script that cannot serve what the caller asks for. A
 * script can carry three faults on its own:
 *
 * 1. The script has no polls.
 * 2. The script has a gap in its run.
 * 3. The caller names a poll that falls outside the run.
 *
 * The code that builds the script raises this error for these three faults.
 * For a script that sets `beyond` to `exhausted`, the fixture raises this
 * error later, when the first poll that the script cannot answer arrives.
 */
export class FeedScriptError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FeedScriptError';
	}
}

/**
 * What a feed serves after its scripted polls run out. If `beyond` is a
 * variant, the feed serves that variant for every later poll. If `beyond` is
 * `repeat-last`, the feed serves the last scripted variant again. If `beyond`
 * is `exhausted`, the feed serves nothing, and raises a script error instead.
 */
export type BeyondScript = FeedVariant | 'repeat-last' | 'exhausted';

export interface FeedScript {
	/**
	 * One variant for each poll, in order: the first entry serves poll 1.
	 * The run must be complete. A gap in the run is a fault, and the fixture
	 * refuses to build the script. The fixture does not serve a gap from the
	 * `beyond` answer.
	 */
	readonly polls: readonly FeedVariant[];
	readonly beyond?: BeyondScript;
}

export interface FeedFixtureOptions {
	/**
	 * The reference time, in epoch milliseconds. Every generated stamp
	 * derives from this time.
	 */
	readonly referenceTime: number;
	/**
	 * The script for each feed, keyed by feed URL. The fixture matches the
	 * URL exactly.
	 */
	readonly feeds: Readonly<Record<string, FeedScript>>;
	/**
	 * How much DTSTAMP advances from one poll to the next, on a feed that
	 * changes DTSTAMP.
	 */
	readonly churnStepMs?: number;
}

export interface FeedRequestRecord {
	readonly url: string;
	readonly method: string;
	readonly status: number;
	/**
	 * The number of the poll that this request served. Zero when the request
	 * served no poll.
	 */
	readonly poll: number;
}

/**
 * The transport that a test holds. The fixture resolves every scripted
 * answer, whatever status the answer carries. The fixture models no transport
 * failure of its own. Therefore the only rejection that the fixture produces
 * is a `FeedScriptError` from a script that ran out.
 *
 * A modelled failure is a rejection that a transport produces to stand for a
 * fault in the network. This fixture produces no modelled failure, but a
 * transport that wraps this one can. A test therefore uses the type of the
 * error to tell a script error apart from a modelled failure:
 * `error instanceof FeedScriptError`. The test does not use the channel that
 * the error arrived on. The type test still works through a transport that
 * wraps this one.
 *
 * A script error leaves the poll counter and the request log unchanged. The
 * next request therefore asks for the same poll again.
 */
export interface FeedFixture extends HttpTransport {
	/** Every request that the fixture answered, in order. */
	readonly log: readonly FeedRequestRecord[];
	/** Returns the number of polls that the named feed served. */
	pollsServed(url: string): number;
	/** Sets every feed back to its first poll, and empties the log. */
	reset(): void;
}

export interface ScriptedPollsOptions {
	readonly base: FeedVariant;
	readonly count: number;
	/**
	 * The polls that serve a variant other than the base variant, keyed by
	 * poll number.
	 */
	readonly at?: Readonly<Record<number, FeedVariant>>;
}

/**
 * Builds a run of polls. A poll that `at` does not name serves the base
 * variant. A poll that `at` names serves the variant that `at` gives for
 * that poll.
 */
export function scriptedPolls(options: ScriptedPollsOptions): FeedVariant[] {
	const { base, count, at = {} } = options;
	if (count < 1) {
		throw new FeedScriptError(
			'a feed script needs at least one poll: give a count of 1 or more',
		);
	}
	for (const key of Object.keys(at)) {
		const poll = Number(key);
		if (!Number.isInteger(poll) || poll < 1 || poll > count) {
			throw new FeedScriptError(
				`poll ${key} falls outside the scripted run 1..${String(count)}: name a poll in that range`,
			);
		}
	}
	return Array.from(
		{ length: count },
		(_entry, index) => at[index + 1] ?? base,
	);
}

const DEFAULT_CHURN_STEP_MS = 60_000;
const decoder = new TextDecoder();

function textBody(status: number, text: string): ServedBody {
	return {
		status,
		headers: { 'content-type': 'text/plain; charset=utf-8' },
		bytes: encodeIcsBytes(text),
	};
}

function toResponse(body: ServedBody): HttpResponse {
	const bytes = new Uint8Array(body.bytes);
	return {
		status: body.status,
		headers: body.headers,
		text: decoder.decode(bytes),
		arrayBuffer: bytes.buffer,
	};
}

/**
 * A script with a complete run, and with a settled answer for the polls that
 * come after the last scripted poll.
 */
interface PreparedScript {
	readonly polls: readonly FeedVariant[];
	readonly beyond:
		| { readonly kind: 'variant'; readonly variant: FeedVariant }
		| { readonly kind: 'exhausted' };
}

/**
 * Checks a declared script, and settles what the script serves after its last
 * poll. Each poll that the fixture serves later therefore reads data that is
 * already complete.
 */
function prepareScript(url: string, script: FeedScript): PreparedScript {
	const polls: FeedVariant[] = [];
	for (let index = 0; index < script.polls.length; index++) {
		const variant = script.polls[index];
		if (variant === undefined) {
			throw new FeedScriptError(
				`feed ${url} declares no variant for poll ${String(index + 1)} of ${String(script.polls.length)}: declare a variant for every poll in the run`,
			);
		}
		polls.push(variant);
	}
	const beyond = script.beyond ?? 'repeat-last';
	if (typeof beyond !== 'string') {
		return { polls, beyond: { kind: 'variant', variant: beyond } };
	}
	const last = polls[polls.length - 1];
	if (last === undefined) {
		throw new FeedScriptError(
			`feed ${url} declares no polls: put one variant or more in polls`,
		);
	}
	return {
		polls,
		beyond:
			beyond === 'exhausted'
				? { kind: 'exhausted' }
				: { kind: 'variant', variant: last },
	};
}

function variantForPoll(
	script: PreparedScript,
	poll: number,
	url: string,
): FeedVariant {
	const scripted = script.polls[poll - 1];
	if (scripted !== undefined) return scripted;
	if (script.beyond.kind === 'exhausted') {
		throw new FeedScriptError(
			`the script for feed ${url} ends at poll ${String(script.polls.length)}, and poll ${String(poll)} has nothing to serve: declare more polls, or set beyond to a variant or to repeat-last`,
		);
	}
	return script.beyond.variant;
}

class ScriptedFeedFixture implements FeedFixture {
	private readonly scripts: Map<string, PreparedScript>;
	private readonly polls = new Map<string, number>();
	private readonly entries: FeedRequestRecord[] = [];
	private readonly referenceTime: number;
	private readonly churnStepMs: number;

	constructor(options: FeedFixtureOptions) {
		this.referenceTime = options.referenceTime;
		this.churnStepMs = options.churnStepMs ?? DEFAULT_CHURN_STEP_MS;
		this.scripts = new Map(
			Object.entries(options.feeds).map(([url, script]) => [
				url,
				prepareScript(url, script),
			]),
		);
	}

	get log(): readonly FeedRequestRecord[] {
		return [...this.entries];
	}

	pollsServed(url: string): number {
		return this.polls.get(url) ?? 0;
	}

	reset(): void {
		this.polls.clear();
		this.entries.length = 0;
	}

	request(req: HttpRequest): Promise<HttpResponse> {
		try {
			return Promise.resolve(this.serve(req));
		} catch (error) {
			return Promise.reject(
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	private serve(req: HttpRequest): HttpResponse {
		const method = (req.method ?? 'GET').toUpperCase();
		const script = this.scripts.get(req.url);
		if (script === undefined) {
			return this.record(
				req.url,
				method,
				0,
				textBody(
					404,
					`no feed script matches ${req.url}: add the URL to the feeds option`,
				),
			);
		}
		if (method !== 'GET') {
			return this.record(
				req.url,
				method,
				0,
				textBody(405, `a feed serves GET only: use GET, not ${method}`),
			);
		}
		const poll = this.pollsServed(req.url) + 1;
		const variant = variantForPoll(script, poll, req.url);
		const body = renderVariant(variant, {
			poll,
			referenceTime: this.referenceTime,
			churnStepMs: this.churnStepMs,
		});
		this.polls.set(req.url, poll);
		return this.record(req.url, method, poll, body);
	}

	private record(
		url: string,
		method: string,
		poll: number,
		body: ServedBody,
	): HttpResponse {
		this.entries.push({ url, method, status: body.status, poll });
		return toResponse(body);
	}
}

/**
 * Builds a feed fixture that serves the given scripts through the transport
 * port.
 */
export function createFeedFixture(options: FeedFixtureOptions): FeedFixture {
	return new ScriptedFeedFixture(options);
}
