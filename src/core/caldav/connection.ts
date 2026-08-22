/**
 * The connection test of one account.
 *
 * The test signs the requests with the credential of the account and runs
 * the discovery of the principal against the server. That step is the
 * first step of every later operation, so a test that passes states that
 * the address, the username, and the password work together.
 *
 * The test states one result of a short list. Three of the results state
 * what happened at the server. The other results state that the test never
 * started, because the plugin holds no credential that it can send.
 *
 * The plugin cannot read the reason out of the library, because the
 * library states each failure of the discovery in words of its own and in
 * one shape. The test therefore watches the transport. Where the server
 * answered a request with 401 or with 403, the server refused the
 * credential. Where no answer of that kind arrived, the plugin did not
 * reach a calendar server at that address.
 */

import type { AccountCredential } from '../model/credential';
import type {
	HttpRequest,
	HttpResponse,
	HttpTransport,
} from '../ports/transport';
import { signRequests } from './credentials';
import { CalDavSession } from './session';

/**
 * What one connection test states.
 *
 * `signed-in` says that the server answered and took the credential.
 * `refused` says that the server answered and did not take the credential.
 * `not-reached` says that the plugin reached no calendar server at that
 * address. `no-credential` says that the store holds no credential for the
 * account. `credential-unreadable` says that the store holds a value that
 * states no credential of the type of the account. `credential-alphabet`
 * says that the username or the password holds a character that the
 * sign-in header cannot carry. `no-token-flow` says that the account signs
 * in with OAuth, and the plugin has no OAuth flow yet. `no-account` says
 * that the settings hold no account of that name; the settings screen can
 * change between the moment it draws a row and the moment a user selects
 * the button of that row.
 */
export type ConnectionResult =
	| 'signed-in'
	| 'refused'
	| 'not-reached'
	| 'no-credential'
	| 'credential-unreadable'
	| 'credential-alphabet'
	| 'no-token-flow'
	| 'no-account';

/** The statuses that state a refusal of the credential. */
const REFUSAL_STATUSES: ReadonlySet<number> = new Set([401, 403]);

export interface ConnectionTestParts {
	readonly transport: HttpTransport;
	readonly serverUrl: string;
	readonly username: string;
	readonly credential: AccountCredential;
}

/** Runs the connection test and states the result. */
export async function checkConnection(
	parts: ConnectionTestParts,
): Promise<ConnectionResult> {
	const signing = signRequests(parts.username, parts.credential);
	if (!signing.ok) {
		return signing.gap === 'no-token-flow'
			? 'no-token-flow'
			: 'credential-alphabet';
	}
	const watched = new WatchedTransport(parts.transport);
	const session = new CalDavSession({
		transport: watched,
		serverUrl: parts.serverUrl,
		headers: signing.headers,
	});
	try {
		await session.discover();
		return 'signed-in';
	} catch {
		return watched.refused ? 'refused' : 'not-reached';
	}
}

/**
 * A transport that remembers whether a server refused the credential. The
 * class changes no request and no answer.
 */
class WatchedTransport implements HttpTransport {
	private readonly inner: HttpTransport;
	private seenRefusal = false;

	constructor(inner: HttpTransport) {
		this.inner = inner;
	}

	/** True where one answer or more stated a refusal of the credential. */
	get refused(): boolean {
		return this.seenRefusal;
	}

	async request(req: HttpRequest): Promise<HttpResponse> {
		const answer = await this.inner.request(req);
		if (REFUSAL_STATUSES.has(answer.status)) {
			this.seenRefusal = true;
		}
		return answer;
	}
}
