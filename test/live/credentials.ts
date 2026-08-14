/**
 * Credentials for live verification runs against real CalDAV servers.
 *
 * Three environment variables describe one provider:
 * `DAVENPORT_TEST_<PROVIDER>_URL`, `DAVENPORT_TEST_<PROVIDER>_USERNAME`
 * and `DAVENPORT_TEST_<PROVIDER>_SECRET`. A provider is unavailable when
 * the environment does not set all three of these variables. A lookup
 * reports an unavailable provider as a normal result, and does not throw.
 * A run covers the providers that the environment supplies. An
 * environment that supplies no provider is still a valid environment. No
 * function in this module reads the environment at import, and no
 * function in this module throws at import.
 *
 * When a provider is unavailable, a lookup returns the names of the
 * variables that the provider wants. A lookup never returns the contents
 * of those variables. No function in this module writes to a log, and no
 * function in this module puts the value of a variable in an error
 * message. Resolved credentials are a plain object that holds the secret
 * as a plain string. After this module returns that object, the caller
 * must keep the secret out of logs, out of errors and out of artifacts.
 *
 * A variable that holds only whitespace counts as unset. The reason is
 * that a secret mapped from a store that does not hold the secret arrives
 * as the empty string. A lookup trims the `url` and the `username` that
 * it returns. Whitespace around either of these two values comes from how
 * somebody wrote the value down, and is not part of the value. A lookup
 * keeps the secret exactly as the environment gives it, because
 * whitespace can be part of the secret.
 *
 * A lookup reads only the properties that an environment record holds
 * itself. Therefore nothing that such a record inherits can supply a
 * credential.
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

/**
 * The environment variables that a lookup reads. The caller injects this
 * record, so that a lookup stays a pure function.
 */
export type CredentialEnvironment = Readonly<
	Record<string, string | undefined>
>;

/** The names of the three environment variables of one provider. */
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
	/**
	 * The names of the variables that are not set. This member never
	 * holds the value of a variable.
	 */
	| { readonly available: false; readonly missing: readonly string[] };

/**
 * The names of the three variables of a provider. This function returns
 * the names whether the environment sets the variables or not.
 */
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

/**
 * The credentials of one provider, or the names of the variables that the
 * environment does not set.
 */
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

/**
 * The providers that a run with this environment can reach. The order is
 * the order of `LIVE_PROVIDERS`.
 */
export function availableProviders(
	environment: CredentialEnvironment,
): readonly LiveProvider[] {
	return LIVE_PROVIDERS.filter(
		(provider) => lookupCredentials(provider, environment).available,
	);
}

/**
 * The credentials of one provider, for a caller that must have them. This
 * function throws when the environment does not set all three variables.
 * The error names the variables that are not set, so that the caller can
 * set them.
 */
export function requireCredentials(
	provider: LiveProvider,
	environment: CredentialEnvironment,
): LiveCredentials {
	const lookup = lookupCredentials(provider, environment);
	if (!lookup.available) {
		throw new Error(
			`The environment has no live credentials for ${provider}. Set these variables: ${lookup.missing.join(', ')}`,
		);
	}
	return lookup.credentials;
}

/** The process environment, in the record shape that a lookup takes. */
export function processEnvironment(): CredentialEnvironment {
	return process.env;
}
