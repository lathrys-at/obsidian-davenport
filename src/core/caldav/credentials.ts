/**
 * The headers that sign a request to a calendar server.
 *
 * An account signs in with an app password or with OAuth. An app password
 * becomes an HTTP Basic header, which carries the username and the
 * password. An OAuth access token becomes a Bearer header, which carries
 * the token alone. The CalDAV library builds both headers, so the plugin
 * writes no encoder of its own.
 *
 * A credential passes through this module and stops at the request. It
 * never reaches a settings value, a record, a log entry, or an exported
 * file.
 *
 * An HTTP Basic header carries a limited alphabet. The settings refuse a
 * username and a password outside that alphabet at the moment the user
 * gives them. A vault can hold a credential that a user gave before the
 * settings held that rule, so this module names that condition as well,
 * and the screen states it in words.
 *
 * An OAuth account holds a client id, a client secret, and a refresh
 * token. The flow that turns those three values into an access token is
 * not part of the plugin yet. This module therefore names that condition,
 * and it signs no request for such an account.
 */

import { getBasicAuthHeaders, getBearerAuthHeaders } from 'tsdav';
import type { AccountCredential } from '../model/credential';
import { fitsBasicAuth } from '../model/credential';

/** The headers of one request, with the name of each header in lower case. */
export type RequestHeaders = Readonly<Record<string, string>>;

/** A reason that the plugin cannot sign a request for an account. */
export type SigningGap =
	/** The username or the password holds a character that the header cannot carry. */
	| 'credential-alphabet'
	/** The account signs in with OAuth, and the plugin has no token flow yet. */
	| 'no-token-flow';

/** The headers that sign each request of an account, or the reason for none. */
export type Signing =
	| { readonly ok: true; readonly headers: RequestHeaders }
	| { readonly ok: false; readonly gap: SigningGap };

/**
 * The HTTP Basic header for a username and a password. The call throws
 * where the username or the password stands outside the alphabet of the
 * header. `signRequests` below reads the alphabet first and never reaches
 * that throw.
 */
export function basicHeaders(
	username: string,
	password: string,
): RequestHeaders {
	return named(getBasicAuthHeaders({ username, password }));
}

/** The Bearer header for an OAuth access token. */
export function bearerHeaders(accessToken: string): RequestHeaders {
	return named(getBearerAuthHeaders({ accessToken }));
}

/**
 * The header map that a helper of the library made. The library states the
 * value as optional. A map with no value signs no request, and a request
 * that carries no signature must not go out.
 */
function named(made: { authorization?: string }): RequestHeaders {
	const value = made.authorization;
	if (value === undefined) {
		throw new Error('the CalDAV library made no authorization header');
	}
	return { authorization: value };
}

/**
 * The headers that sign each request of one account. The result names a
 * gap where the plugin cannot build a header for that account.
 */
export function signRequests(
	username: string,
	credential: AccountCredential,
): Signing {
	if (credential.type === 'oauth') {
		return { ok: false, gap: 'no-token-flow' };
	}
	if (!fitsBasicAuth(username) || !fitsBasicAuth(credential.password)) {
		return { ok: false, gap: 'credential-alphabet' };
	}
	return { ok: true, headers: basicHeaders(username, credential.password) };
}
