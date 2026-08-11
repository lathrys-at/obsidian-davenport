/**
 * Credentials for live verification runs against real CalDAV servers.
 *
 * Each provider is described by three environment variables —
 * `DAVENPORT_TEST_<PROVIDER>_URL`, `_USERNAME` and `_SECRET`. A provider
 * whose three variables are not all set is unavailable rather than an
 * error: a run covers whichever providers the environment supplies, and an
 * environment supplying none is a valid environment. Nothing here reads
 * the environment at import time, and nothing throws at import time.
 *
 * An unavailable provider reports the names of the variables it wants and
 * never their contents; no function here writes to a log or puts a value
 * in an error message. Resolved credentials are a plain object holding the
 * secret as a plain string, so keeping it out of logs, errors and
 * artifacts is the caller's obligation from that point on.
 *
 * A variable holding only whitespace counts as unset — a secret mapped
 * from a store that does not have it arrives as the empty string. The
 * resolved `url` and `username` are trimmed, since surrounding whitespace
 * in either is an artifact of how the value was written down; the secret
 * is taken verbatim, because whitespace can be part of it. A lookup reads
 * own properties only, so nothing an environment record inherits can
 * supply a credential.
 */

import process from 'node:process';

export const LIVE_PROVIDERS = [
	'icloud',
	'fastmail',
	'nextcloud',
	'radicale',
	'baikal',
	'google',
] as const;

export type LiveProvider = (typeof LIVE_PROVIDERS)[number];

/** The variables a lookup reads, injected so lookups stay pure. */
export type CredentialEnvironment = Readonly<
	Record<string, string | undefined>
>;

/** The environment variable names one provider is described by. */
export interface ProviderVariableNames {
	readonly url: string;
	readonly username: string;
	readonly secret: string;
}

export interface LiveCredentials {
	readonly provider: LiveProvider;
	readonly url: string;
	readonly username: string;
	readonly secret: string;
}

export type CredentialLookup =
	| { readonly available: true; readonly credentials: LiveCredentials }
	/** The names of the variables that were unset, never their contents. */
	| { readonly available: false; readonly missing: readonly string[] };

/** The variable names for a provider, whether or not any of them are set. */
export function variableNames(provider: LiveProvider): ProviderVariableNames {
	const prefix = `DAVENPORT_TEST_${provider.toUpperCase()}`;
	return {
		url: `${prefix}_URL`,
		username: `${prefix}_USERNAME`,
		secret: `${prefix}_SECRET`,
	};
}

function isSet(value: string | undefined): value is string {
	return value !== undefined && value.trim() !== '';
}

function read(
	environment: CredentialEnvironment,
	name: string,
): string | undefined {
	return Object.prototype.hasOwnProperty.call(environment, name)
		? environment[name]
		: undefined;
}

/** Credentials for one provider, or the names of what it is missing. */
export function lookupCredentials(
	provider: LiveProvider,
	environment: CredentialEnvironment,
): CredentialLookup {
	const names = variableNames(provider);
	const url = read(environment, names.url);
	const username = read(environment, names.username);
	const secret = read(environment, names.secret);

	if (!isSet(url) || !isSet(username) || !isSet(secret)) {
		const missing: string[] = [];
		if (!isSet(url)) missing.push(names.url);
		if (!isSet(username)) missing.push(names.username);
		if (!isSet(secret)) missing.push(names.secret);
		return { available: false, missing };
	}

	return {
		available: true,
		credentials: {
			provider,
			url: url.trim(),
			username: username.trim(),
			secret,
		},
	};
}

/** The providers this environment can reach, in declaration order. */
export function availableProviders(
	environment: CredentialEnvironment,
): readonly LiveProvider[] {
	return LIVE_PROVIDERS.filter(
		(provider) => lookupCredentials(provider, environment).available,
	);
}

/**
 * Credentials for a provider the caller has established it needs. The
 * error names the unset variables so the caller can set them.
 */
export function requireCredentials(
	provider: LiveProvider,
	environment: CredentialEnvironment,
): LiveCredentials {
	const lookup = lookupCredentials(provider, environment);
	if (!lookup.available) {
		throw new Error(
			`No live credentials for ${provider}; unset: ${lookup.missing.join(', ')}`,
		);
	}
	return lookup.credentials;
}

/** The process environment, as the record the lookups take. */
export function processEnvironment(): CredentialEnvironment {
	return process.env;
}
