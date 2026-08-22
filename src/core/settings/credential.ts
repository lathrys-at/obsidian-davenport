/**
 * The text that the secret store holds for one account.
 *
 * The store holds text. An app-password credential is the password
 * itself, because a password of one line needs no other form. An OAuth
 * credential is three values, so that credential goes into the store as
 * one JSON document.
 *
 * This module writes that text, and it reads that text back. The code that
 * signs in to a server is the one reader of a credential.
 *
 * The account states which of the two types it uses, and the reader takes
 * that type. A text of the wrong shape gives null back. The store holds
 * text that another version of the plugin wrote, and a user can also write
 * that text by hand into the data file.
 */

import type { AccountCredential, OAuthTokens } from '../model/credential';
import type { CredentialType } from '../model/settings';

/** The text that the store holds for this credential. */
export function encodeCredential(credential: AccountCredential): string {
	if (credential.type === 'app-password') {
		return credential.password;
	}
	return JSON.stringify({
		clientId: credential.tokens.clientId,
		clientSecret: credential.tokens.clientSecret,
		refreshToken: credential.tokens.refreshToken,
	});
}

/**
 * The credential that a text states, or null where the text does not state
 * one of that type.
 */
export function decodeCredential(
	type: CredentialType,
	text: string,
): AccountCredential | null {
	if (type === 'app-password') {
		return text === '' ? null : { type, password: text };
	}
	const tokens = readTokens(text);
	return tokens === null ? null : { type, tokens };
}

/** The three OAuth values that a text states, or null. */
function readTokens(text: string): OAuthTokens | null {
	let held: unknown;
	try {
		held = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof held !== 'object' || held === null) {
		return null;
	}
	const clientId = field(held, 'clientId');
	const clientSecret = field(held, 'clientSecret');
	const refreshToken = field(held, 'refreshToken');
	if (clientId === null || clientSecret === null || refreshToken === null) {
		return null;
	}
	return { clientId, clientSecret, refreshToken };
}

/** The text of one field, or null where the field holds no text. */
function field(held: object, name: string): string | null {
	const value: unknown = Reflect.get(held, name);
	return typeof value === 'string' ? value : null;
}
