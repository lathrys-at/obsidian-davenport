/**
 * An in-process ICS feed server sitting behind the transport port.
 *
 * A feed is a script: poll N serves the variant declared for it, so a suite
 * states "the third fetch is truncated" as data rather than as a callback.
 * The fixture reads no ambient clock and no random source — the caller hands
 * it the reference time every generated stamp derives from, and per-fetch
 * churn derives from the poll counter — so identical scripts serve identical
 * octets.
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
 * A script that cannot answer the poll it was asked for: it ran out, it
 * carries a hole where that poll's variant belongs, or it declares nothing to
 * repeat. The fixture throws this out of `request` rather than rejecting the
 * promise it returns, because the transport port reserves rejection for
 * transport failure and a script that cannot answer is a defect in the suite.
 */
export class FeedScriptError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FeedScriptError';
	}
}

/**
 * What a feed serves once its scripted polls run out. `exhausted` serves
 * nothing and raises a script error instead.
 */
export type BeyondScript = FeedVariant | 'repeat-last' | 'exhausted';

export interface FeedScript {
	/**
	 * Variants for polls one upward, in order. A gap in the run is a hole in
	 * the script rather than the end of it, and raises a script error when the
	 * poll it belongs to comes round.
	 */
	readonly polls: readonly FeedVariant[];
	readonly beyond?: BeyondScript;
}

export interface FeedFixtureOptions {
	/** Epoch milliseconds every generated stamp derives from. */
	readonly referenceTime: number;
	/** Scripts by feed URL; the URL is matched exactly. */
	readonly feeds: Readonly<Record<string, FeedScript>>;
	/** How far DTSTAMP advances per poll on a churning feed. */
	readonly churnStepMs?: number;
}

export interface FeedRequestRecord {
	readonly url: string;
	readonly method: string;
	readonly status: number;
	/** Which poll of that feed this was; zero when no poll was served. */
	readonly poll: number;
}

export interface FeedFixture extends HttpTransport {
	/** Every request the fixture has answered, in order. */
	readonly log: readonly FeedRequestRecord[];
	/** How many polls the named feed has served. */
	pollsServed(url: string): number;
	/** Returns every feed to its first poll and empties the log. */
	reset(): void;
}

export interface ScriptedPollsOptions {
	readonly base: FeedVariant;
	readonly count: number;
	/** Polls serving something other than the base, keyed by poll number. */
	readonly at?: Readonly<Record<number, FeedVariant>>;
}

/** A run of polls serving one variant, with named polls serving another. */
export function scriptedPolls(options: ScriptedPollsOptions): FeedVariant[] {
	const { base, count, at = {} } = options;
	if (count < 1) {
		throw new FeedScriptError('a feed script needs at least one poll');
	}
	for (const key of Object.keys(at)) {
		const poll = Number(key);
		if (!Number.isInteger(poll) || poll < 1 || poll > count) {
			throw new FeedScriptError(
				`poll ${key} falls outside the scripted 1..${String(count)}`,
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

function variantForPoll(
	script: FeedScript,
	poll: number,
	url: string,
): FeedVariant {
	const scripted = script.polls[poll - 1];
	if (scripted !== undefined) return scripted;
	if (poll <= script.polls.length) {
		throw new FeedScriptError(
			`feed ${url} scripted ${String(script.polls.length)} polls and declares no variant for poll ${String(poll)}`,
		);
	}
	const beyond = script.beyond ?? 'repeat-last';
	if (beyond === 'exhausted') {
		throw new FeedScriptError(
			`feed ${url} scripted ${String(script.polls.length)} polls and poll ${String(poll)} has nothing to serve`,
		);
	}
	if (beyond !== 'repeat-last') return beyond;
	const last = script.polls[script.polls.length - 1];
	if (last === undefined) {
		throw new FeedScriptError(`feed ${url} declares no poll to repeat`);
	}
	return last;
}

class ScriptedFeedFixture implements FeedFixture {
	private readonly scripts: Map<string, FeedScript>;
	private readonly polls = new Map<string, number>();
	private readonly entries: FeedRequestRecord[] = [];
	private readonly referenceTime: number;
	private readonly churnStepMs: number;

	constructor(options: FeedFixtureOptions) {
		this.referenceTime = options.referenceTime;
		this.churnStepMs = options.churnStepMs ?? DEFAULT_CHURN_STEP_MS;
		this.scripts = new Map(Object.entries(options.feeds));
		for (const [url, script] of this.scripts) {
			const repeats =
				script.beyond === undefined ||
				typeof script.beyond === 'string';
			if (script.polls.length === 0 && repeats) {
				throw new FeedScriptError(`feed ${url} declares no polls`);
			}
		}
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

	/**
	 * Every scripted answer resolves, whatever status it carries. A script
	 * that cannot answer throws synchronously, so the rejection channel keeps
	 * the one meaning the port gives it.
	 */
	request(req: HttpRequest): Promise<HttpResponse> {
		return Promise.resolve(this.serve(req));
	}

	private serve(req: HttpRequest): HttpResponse {
		const method = (req.method ?? 'GET').toUpperCase();
		const script = this.scripts.get(req.url);
		if (script === undefined) {
			return this.record(
				req.url,
				method,
				0,
				textBody(404, `no feed is scripted at ${req.url}`),
			);
		}
		if (method !== 'GET') {
			return this.record(
				req.url,
				method,
				0,
				textBody(405, `a feed serves GET, not ${method}`),
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

/** Builds a feed fixture serving the given scripts through the transport. */
export function createFeedFixture(options: FeedFixtureOptions): FeedFixture {
	return new ScriptedFeedFixture(options);
}
