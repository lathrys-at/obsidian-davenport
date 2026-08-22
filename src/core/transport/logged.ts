/**
 * The transport that writes one log entry for each request.
 *
 * The decorator stands between the engine and the transport port. It
 * passes each request through and keeps the contract of the port: every
 * status resolves, and only a failure of the transport rejects. The entry
 * goes to the log in both conditions.
 *
 * An entry holds five facts: the method, the address, the status, the time
 * that the request took, and the outcome. The entry holds nothing else. It
 * holds no header, no body, and no words of the server. The rule is that
 * the log holds only words that the plugin wrote, and a number that the
 * plugin measured. A header carries the credential of the user. A body
 * carries the calendar of the user. A message of a server carries whatever
 * that server wrote.
 *
 * The address in the entry is the origin and the path alone. The query
 * text stays out, because a server can put a token in a query. The
 * username and the password of an address stay out for the same reason: a
 * redirect can name an address of that form, and the plugin follows the
 * redirect of the platform.
 *
 * The time comes from the clock port. The engine reads no clock of the
 * system.
 */

import type { Clock } from '../ports/clock';
import type { Logger, LogOutcome } from '../ports/logger';
import type {
	HttpRequest,
	HttpResponse,
	HttpTransport,
} from '../ports/transport';

export interface LoggedTransportParts {
	readonly transport: HttpTransport;
	readonly logger: Logger;
	readonly clock: Clock;
}

/** The words of an entry that states a request with no answer. */
const NO_ANSWER = 'no answer';

/** Builds the transport that logs each request of one transport. */
export function loggedTransport(parts: LoggedTransportParts): HttpTransport {
	const { transport, logger, clock } = parts;
	return {
		async request(req: HttpRequest): Promise<HttpResponse> {
			const started = clock.now();
			const method = (req.method ?? 'GET').toUpperCase();
			const item = loggedAddress(req.url);
			// The clock answers one time for one entry. The time of the
			// entry and the time that the request took then state the same
			// instant.
			const write = (ended: number, status: number | null): void => {
				logger.log({
					time: ended,
					action: method,
					item,
					outcome: status === null ? 'failed' : outcomeOf(status),
					reason: `${
						status === null ? NO_ANSWER : `status ${String(status)}`
					}, ${took(ended, started)}`,
				});
			};
			try {
				const answer = await transport.request(req);
				write(clock.now(), answer.status);
				return answer;
			} catch (error) {
				write(clock.now(), null);
				throw error;
			}
		},
	};
}

/**
 * The address that an entry states. The result holds the origin and the
 * path of the address. An address that states no origin loses its query
 * text and keeps the rest, because such an address names no host and
 * carries no username.
 */
export function loggedAddress(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.origin}${parsed.pathname}`;
	} catch {
		return url.split(/[?#]/u)[0] ?? '';
	}
}

/**
 * The outcome of one status. A status of 300 to 399 states that the server
 * answered and named another address, so the request itself succeeded. A
 * status of 400 to 499 states that the server refused the request. Every
 * other status states a failure.
 */
export function outcomeOf(status: number): LogOutcome {
	if (status >= 200 && status < 400) {
		return 'success';
	}
	return status >= 400 && status < 500 ? 'refused' : 'failed';
}

/** The time that the request took, in whole milliseconds. */
function took(ended: number, started: number): string {
	return `${String(Math.max(0, Math.round(ended - started)))} ms`;
}
