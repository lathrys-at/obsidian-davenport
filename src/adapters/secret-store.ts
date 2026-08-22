/**
 * The secret store, over the secret storage of Obsidian or over the data
 * file of the plugin.
 *
 * Obsidian gives a plugin a secret storage from version 1.11.4. This
 * module asks the app object for that storage at the moment it builds the
 * store. It asks for the methods themselves, and it compares no version
 * number. A version test would state one fact about the app and then
 * assume a second fact from it.
 *
 * Where the app has the storage, each credential goes into it under an id
 * that starts with `davenport-account-`. The storage is one set of names
 * for the whole app, and every plugin writes into it. The prefix therefore
 * keeps the names of this plugin apart from the names of the other
 * plugins.
 *
 * Where the app does not have the storage, each credential goes into the
 * data file of the plugin. The file holds the credential as plain text,
 * and the settings screen states that condition to the user.
 *
 * The secret storage of Obsidian has three methods: it writes a secret, it
 * reads a secret, and it lists the ids of the secrets. It has no method
 * that removes a secret. A removal therefore writes a value with no
 * characters over the credential, and the id of that credential stays in
 * the storage. A read of such a value gives null back, so a credential
 * that a user removed is gone for every reader. In the data file a removal
 * takes the key away.
 *
 * A vault can carry a data file that an older version of Obsidian wrote,
 * and that file can hold a credential as plain text. The store over the
 * secret storage therefore takes the credential of a reference out of the
 * data file each time it writes that reference, and each time it removes
 * that reference. A credential that the storage now holds stands in one
 * place, and not in two.
 */

import type { SecretStore } from '../core/ports/secret-store';

/**
 * The part of the secret storage of Obsidian that this module uses. The
 * `SecretStorage` class of the API satisfies this interface.
 */
export interface SecretStorageApi {
	setSecret(id: string, secret: string): void;
	getSecret(id: string): string | null;
}

/**
 * The part of the app object that this module reads. The type of the
 * member is unknown, because the member arrives with a version of
 * Obsidian that is newer than the version that the manifest states.
 */
export interface SecretStorageHost {
	readonly secretStorage?: unknown;
}

/** The part of the data file that holds the credentials of the fallback. */
export interface SecretFallback {
	readSecret(ref: string): Promise<string | null>;
	writeSecret(ref: string, value: string): Promise<void>;
	removeSecret(ref: string): Promise<void>;
}

/** The first characters of the id of every secret of this plugin. */
export const SECRET_ID_PREFIX = 'davenport-account-';

/**
 * The secret storage of the app, or null where the app has none. The test
 * asks for the two methods that this module calls.
 */
export function secretStorageOf(
	host: SecretStorageHost,
): SecretStorageApi | null {
	const held: unknown = host.secretStorage;
	if (typeof held !== 'object' || held === null) {
		return null;
	}
	const api = held as Partial<SecretStorageApi>;
	if (typeof api.setSecret !== 'function') {
		return null;
	}
	if (typeof api.getSecret !== 'function') {
		return null;
	}
	return api as SecretStorageApi;
}

/**
 * The store that holds the credentials. The store takes the secret
 * storage of the app where the app has one, and the data file of the
 * plugin where the app has none.
 */
export function createSecretStore(
	host: SecretStorageHost,
	fallback: SecretFallback,
): SecretStore {
	const storage = secretStorageOf(host);
	return storage === null
		? fallbackStore(fallback)
		: storageStore(storage, fallback);
}

/** The store over the secret storage of the app. */
function storageStore(
	storage: SecretStorageApi,
	fallback: SecretFallback,
): SecretStore {
	return {
		tier: 'secret-storage',
		get(ref: string): Promise<string | null> {
			return Promise.resolve(held(storage.getSecret(idOf(ref))));
		},
		set(ref: string, value: string): Promise<void> {
			storage.setSecret(idOf(ref), value);
			return fallback.removeSecret(ref);
		},
		remove(ref: string): Promise<void> {
			storage.setSecret(idOf(ref), '');
			return fallback.removeSecret(ref);
		},
	};
}

/** The store over the data file of the plugin. */
function fallbackStore(fallback: SecretFallback): SecretStore {
	return {
		tier: 'data-json',
		async get(ref: string): Promise<string | null> {
			return held(await fallback.readSecret(ref));
		},
		set(ref: string, value: string): Promise<void> {
			return fallback.writeSecret(ref, value);
		},
		remove(ref: string): Promise<void> {
			return fallback.removeSecret(ref);
		},
	};
}

/** The id of the secret that holds the credential of one reference. */
function idOf(ref: string): string {
	return `${SECRET_ID_PREFIX}${ref}`;
}

/** A value with no characters states no credential. */
function held(value: string | null): string | null {
	return value === null || value === '' ? null : value;
}
