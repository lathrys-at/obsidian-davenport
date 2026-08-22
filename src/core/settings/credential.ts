/**
 * The text that the secret store holds for one account.
 *
 * The store holds text. An app-password credential is the password
 * itself, because a password of one line needs no other form. An OAuth
 * credential is three values, so that credential goes into the store as
 * one JSON document.
 *
 * This module writes that text. The reader of it arrives with the code
 * that signs in to a server, because that code is the one reader of a
 * credential.
 */

import type { AccountCredential } from '../model/credential';

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
