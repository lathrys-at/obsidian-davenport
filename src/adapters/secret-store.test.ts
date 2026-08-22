/**
 * The store that holds the credentials, over each of the two storages.
 *
 * The point of these cases is the choice of the storage and the contract
 * that both storages keep. The store finds the secret storage by the
 * methods of that storage, and not by a version number. A credential that
 * a user removed reads as absent, whichever storage held it.
 */

import { describe, expect, it } from 'vitest';
import { FakePluginData } from '../../test/harness/obsidian-fake';
import { PluginDataStore, SECRET_FALLBACK_KEY } from './plugin-data';
import {
	SECRET_ID_PREFIX,
	createSecretStore,
	secretStorageOf,
} from './secret-store';

/** A double of the secret storage of Obsidian. */
class FakeSecretStorage {
	readonly held = new Map<string, string>();

	setSecret(id: string, secret: string): void {
		this.held.set(id, secret);
	}

	getSecret(id: string): string | null {
		return this.held.get(id) ?? null;
	}

	listSecrets(): string[] {
		return [...this.held.keys()];
	}
}

function fallbackStore(): PluginDataStore {
	return new PluginDataStore(new FakePluginData());
}

describe('the choice of the storage', () => {
	it('takes the secret storage where the app has one', () => {
		const store = createSecretStore(
			{ secretStorage: new FakeSecretStorage() },
			fallbackStore(),
		);
		expect(store.tier).toBe('secret-storage');
	});

	it('takes the data file where the app has no secret storage', () => {
		expect(createSecretStore({}, fallbackStore()).tier).toBe('data-json');
	});

	it('takes the data file where the member of the app is no storage', () => {
		expect(secretStorageOf({ secretStorage: 'soon' })).toBeNull();
		expect(secretStorageOf({ secretStorage: null })).toBeNull();
		expect(secretStorageOf({})).toBeNull();
	});

	it('takes the data file where the storage states one method alone', () => {
		expect(
			secretStorageOf({ secretStorage: { setSecret: () => undefined } }),
		).toBeNull();
		expect(
			secretStorageOf({ secretStorage: { getSecret: () => null } }),
		).toBeNull();
	});
});

describe('the credentials in the secret storage', () => {
	it('writes each credential under an id of this plugin', async () => {
		const storage = new FakeSecretStorage();
		const store = createSecretStore(
			{ secretStorage: storage },
			fallbackStore(),
		);
		await store.set('caldav-example-com', 'hunter2');
		expect(storage.listSecrets()).toEqual([
			`${SECRET_ID_PREFIX}caldav-example-com`,
		]);
		expect(await store.get('caldav-example-com')).toBe('hunter2');
	});

	it('gives null back for a credential that the storage does not hold', async () => {
		const store = createSecretStore(
			{ secretStorage: new FakeSecretStorage() },
			fallbackStore(),
		);
		expect(await store.get('nothing')).toBeNull();
	});

	it('takes a credential of an older version out of the data file', async () => {
		const data = new FakePluginData();
		const settings = new PluginDataStore(data);
		await createSecretStore({}, settings).set('one', 'plain text');
		expect(data.document).toContain('plain text');
		const store = createSecretStore(
			{ secretStorage: new FakeSecretStorage() },
			settings,
		);
		await store.set('one', 'from now on');
		expect(await store.get('one')).toBe('from now on');
		expect(data.document).not.toContain('plain text');
	});

	it('takes a credential of an older version away with the account', async () => {
		const data = new FakePluginData();
		const settings = new PluginDataStore(data);
		await createSecretStore({}, settings).set('one', 'plain text');
		await createSecretStore(
			{ secretStorage: new FakeSecretStorage() },
			settings,
		).remove('one');
		expect(data.document).not.toContain('plain text');
	});

	it('writes a value with no characters over a credential that goes', async () => {
		const storage = new FakeSecretStorage();
		const store = createSecretStore(
			{ secretStorage: storage },
			fallbackStore(),
		);
		await store.set('one', 'first');
		await store.remove('one');
		expect(storage.getSecret(`${SECRET_ID_PREFIX}one`)).toBe('');
		expect(await store.get('one')).toBeNull();
	});
});

describe('the credentials in the data file', () => {
	it('writes each credential into the file, and reads it back', async () => {
		const data = new FakePluginData();
		const store = createSecretStore({}, new PluginDataStore(data));
		await store.set('one', 'first');
		expect(
			(data.value as Record<string, unknown>)[SECRET_FALLBACK_KEY],
		).toEqual({ one: 'first' });
		expect(await store.get('one')).toBe('first');
	});

	it('takes a credential that goes out of the file', async () => {
		const data = new FakePluginData();
		const store = createSecretStore({}, new PluginDataStore(data));
		await store.set('one', 'first');
		await store.remove('one');
		expect(await store.get('one')).toBeNull();
		expect(data.document).not.toContain('first');
	});

	it('gives null back for a credential with no characters', async () => {
		const store = createSecretStore(
			{},
			new PluginDataStore(new FakePluginData()),
		);
		await store.set('one', '');
		expect(await store.get('one')).toBeNull();
	});
});
