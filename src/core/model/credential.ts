import type { CredentialType } from './settings';

/**
 * What the secret storage holds for one account. An account uses one of
 * two credential types, and each type has its own shape.
 *
 * An app-password credential is one password. The plugin sends that
 * password with the username in an HTTP Basic header.
 *
 * An OAuth credential is three values that belong together. The plugin
 * sends the client id and the client secret to the token endpoint of the
 * provider, together with the refresh token. The provider gives an access
 * token back. This file states the shape of that credential and the place
 * that holds it. The flow that fills these three values is not part of the
 * plugin yet.
 *
 * A value of this type is the credential itself. Such a value never goes
 * into the settings, into a record, into a log entry, or into an exported
 * file.
 */
export interface OAuthTokens {
	readonly clientId: string;
	readonly clientSecret: string;
	readonly refreshToken: string;
}

export type AccountCredential =
	| { readonly type: 'app-password'; readonly password: string }
	| { readonly type: 'oauth'; readonly tokens: OAuthTokens };

/** The two credential types, in the order that the settings screen shows. */
export const CREDENTIAL_TYPES: readonly CredentialType[] = [
	'app-password',
	'oauth',
];
