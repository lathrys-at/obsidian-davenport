/**
 * Doubles of the transport port.
 *
 * The mock CalDAV server answers a test that drives the protocol. These
 * doubles answer the other two kinds of test. The first kind drives one
 * request and reads what the port carried, in both directions. The second
 * kind builds a part of the plugin that must make no request at all, and
 * a request from such a part must fail the test that made it.
 */

import type {
	HttpRequest,
	HttpResponse,
	HttpTransport,
} from '../../src/core/ports/transport';

const encoder = new TextEncoder();

/** The answer that a fake transport gives to one request. */
export interface AnswerSpec {
	/** The status. The default is 200. */
	readonly status?: number;
	/** The headers of the answer. The default is no header. */
	readonly headers?: Readonly<Record<string, string>>;
	/** The body of the answer, as text. The default is no body. */
	readonly text?: string;
}

/** A failure of the transport, in the place of an answer. */
export interface FailureSpec {
	readonly fails: string;
}

export type Reply = AnswerSpec | FailureSpec;

function isFailure(reply: Reply): reply is FailureSpec {
	return 'fails' in reply;
}

/** The answer of the port that one specification states. */
export function answerOf(spec: AnswerSpec): HttpResponse {
	const text = spec.text ?? '';
	const octets = encoder.encode(text);
	const buffer = new ArrayBuffer(octets.byteLength);
	new Uint8Array(buffer).set(octets);
	return {
		status: spec.status ?? 200,
		headers: { ...spec.headers },
		text,
		arrayBuffer: buffer,
	};
}

/**
 * A transport that answers from a rule and records each request. The rule
 * is one answer for every request, or a function of the request.
 */
export class FakeTransport implements HttpTransport {
	readonly requests: HttpRequest[] = [];

	private readonly rule: (req: HttpRequest) => Reply;

	constructor(rule: Reply | ((req: HttpRequest) => Reply)) {
		this.rule = typeof rule === 'function' ? rule : () => rule;
	}

	request(req: HttpRequest): Promise<HttpResponse> {
		this.requests.push(req);
		const reply = this.rule(req);
		return isFailure(reply)
			? Promise.reject(new Error(reply.fails))
			: Promise.resolve(answerOf(reply));
	}
}

/**
 * A transport that fails every request. A part of the plugin that must
 * speak to no server takes this transport, and a request from that part
 * then fails the test that made it.
 */
export function refusingTransport(reason: string): HttpTransport {
	return new FakeTransport({ fails: reason });
}
