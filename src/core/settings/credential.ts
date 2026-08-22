/**
 * The text that the secret store holds for one account, and the way back
 * to the credential.
 *
 * The store holds text. An app-password credential is the password itself,
 * because a password of one line needs no other form. An OAuth credential
 * is three values, so that credential goes into the store as one JSON
 * document.
 *
 * A message of this module never quotes the text that the store held. Such
 * a text is the credential, and a credential goes into no message.
 */

import type { AccountCredential, OAuthTokens } from '../model/credential';
import type { CredentialType } from '../model/settings';

/** One fault that the reader found in the text that the store held. */
export type CredentialFault =
	/** The store held no text, or text with no characters. */
	| { readonly kind: 'empty' }
	/** The text is not a JSON document with named fields. */
	| { readonly kind: 'not-a-document' }
	/** The document has no such field, or that field holds no text. */
	| { readonly kind: 'field'; readonly field: keyof OAuthTokens };

export type CredentialReading =
	| { readonly ok: true; readonly credential: AccountCredential }
	| { readonly ok: false; readonly fault: CredentialFault };

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
 * The credential that the text states. The caller gives the credential
 * type of the account, because the text alone does not state that type.
 */
export function decodeCredential(
	type: CredentialType,
	stored: string,
): CredentialReading {
	if (stored === '') {
		return { ok: false, fault: { kind: 'empty' } };
	}
	if (type === 'app-password') {
		return { ok: true, credential: { type, password: stored } };
	}
	const document: unknown = parseJson(stored);
	if (
		typeof document !== 'object' ||
		document === null ||
		Array.isArray(document)
	) {
		return { ok: false, fault: { kind: 'not-a-document' } };
	}
	const held = document as Readonly<Record<string, unknown>>;
	const clientId = textField(held, 'clientId');
	if (clientId === null) {
		return { ok: false, fault: { kind: 'field', field: 'clientId' } };
	}
	const clientSecret = textField(held, 'clientSecret');
	if (clientSecret === null) {
		return { ok: false, fault: { kind: 'field', field: 'clientSecret' } };
	}
	const refreshToken = textField(held, 'refreshToken');
	if (refreshToken === null) {
		return { ok: false, fault: { kind: 'field', field: 'refreshToken' } };
	}
	return {
		ok: true,
		credential: { type, tokens: { clientId, clientSecret, refreshToken } },
	};
}

/** The text of one field, or null where the field holds no text. */
function textField(
	held: Readonly<Record<string, unknown>>,
	field: keyof OAuthTokens,
): string | null {
	const value = held[field];
	return typeof value === 'string' && value !== '' ? value : null;
}

/** The words that state one fault of a credential to the user. */
export function describeCredentialFault(fault: CredentialFault): string {
	switch (fault.kind) {
		case 'empty':
			return 'The secret storage holds no credential for this account. Enter the credential again.';
		case 'not-a-document':
			return 'The credential of this account is damaged. Enter the credential again.';
		case 'field':
			return `The credential of this account states no ${FIELD_LABELS[fault.field]}. Enter the credential again.`;
	}
}

const FIELD_LABELS: Readonly<Record<keyof OAuthTokens, string>> = {
	clientId: 'client id',
	clientSecret: 'client secret',
	refreshToken: 'refresh token',
};

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
