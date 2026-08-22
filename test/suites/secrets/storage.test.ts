/**
 * Where the credentials of the accounts go.
 *
 * Obsidian gives a plugin a secret storage from version 1.11.4. The plugin
 * uses that storage where the app has it. On an older version the plugin
 * writes the credentials into its own data file, and the settings screen
 * warns about that condition at all times.
 *
 * These cases drive the whole path: the settings screen asks the service,
 * the service asks the store, and the store writes into the storage of the
 * app or into the data file.
 */

import { describe, expect, it } from 'vitest';
import { ControlledClock } from '../../harness/clock';
import { FakePluginData } from '../../harness/obsidian-fake';
import { PluginDataStore } from '../../../src/adapters/plugin-data';
import { createSecretStore } from '../../../src/adapters/secret-store';
import type { SyncLogEntry } from '../../../src/core/ports/logger';
import { AccountService } from '../../../src/core/settings/service';
import { accountsView } from '../../../src/ui/view';

const PASSWORD = 'correct-horse-battery-staple';
const DRAFT = {
	serverUrl: 'https://caldav.example.com/dav/',
	username: 'ren',
};

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

/** The plugin, with the app that the case gives it. */
function plugin(app: { readonly secretStorage?: unknown }): {
	readonly service: AccountService;
	readonly data: FakePluginData;
	readonly entries: SyncLogEntry[];
} {
	const data = new FakePluginData();
	const settings = new PluginDataStore(data);
	const entries: SyncLogEntry[] = [];
	const service = new AccountService({
		settings,
		secrets: createSecretStore(app, settings),
		logger: {
			log: (entry) => {
				entries.push(entry);
			},
		},
		clock: new ControlledClock(),
	});
	return { service, data, entries };
}

describe('SC-1 the storage that holds the credentials', () => {
	it('SC-1: the plugin writes a credential into the secret storage of the app', async () => {
		const storage = new FakeSecretStorage();
		const { service, data } = plugin({ secretStorage: storage });
		await service.load();
		expect(service.tier).toBe('secret-storage');
		expect((await service.add(DRAFT, PASSWORD)).ok).toBe(true);
		expect(storage.listSecrets()).toEqual([
			'davenport-account-caldav-example-com',
		]);
		expect(data.document).not.toContain(PASSWORD);
		expect(data.writes.join('')).not.toContain(PASSWORD);
	});

	it('SC-1: the plugin writes a credential into the data file where the app has no secret storage', async () => {
		const { service, data } = plugin({});
		await service.load();
		expect(service.tier).toBe('data-json');
		expect((await service.add(DRAFT, PASSWORD)).ok).toBe(true);
		const document = data.value as Record<string, unknown>;
		expect(document.secretFallback).toEqual({
			'caldav-example-com': PASSWORD,
		});
	});

	it('SC-1: a removal takes the credential out of each storage', async () => {
		const storage = new FakeSecretStorage();
		const first = plugin({ secretStorage: storage });
		await first.service.load();
		await first.service.add(DRAFT, PASSWORD);
		await first.service.remove('caldav-example-com');
		expect(storage.getSecret('davenport-account-caldav-example-com')).toBe(
			'',
		);
		expect(await first.service.hasCredential('caldav-example-com')).toBe(
			false,
		);

		const second = plugin({});
		await second.service.load();
		await second.service.add(DRAFT, PASSWORD);
		await second.service.remove('caldav-example-com');
		expect(second.data.document).not.toContain(PASSWORD);
	});
});

describe('SC-1 the warning of the settings screen', () => {
	it('SC-1: the screen warns while the data file holds the credentials', () => {
		const view = accountsView('data-json', [], []);
		expect(view.storage.warning).toBe(true);
		expect(view.storage.text).toContain('data file');
		expect(view.storage.text).toContain('plain text');
	});

	it('SC-1: the screen shows no warning where the secret storage holds them', () => {
		const view = accountsView('secret-storage', [], []);
		expect(view.storage.warning).toBe(false);
	});

	it('SC-1: the screen states the storage each time it draws the section', async () => {
		const { service } = plugin({});
		await service.load();
		await service.add(DRAFT, PASSWORD);
		const first = accountsView(
			service.tier,
			service.accounts,
			service.problems,
		);
		const again = accountsView(
			service.tier,
			service.accounts,
			service.problems,
		);
		expect(first.storage.warning).toBe(true);
		expect(again.storage).toEqual(first.storage);
	});
});
