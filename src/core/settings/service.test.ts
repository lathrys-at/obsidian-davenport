/**
 * The account operations of the settings screen.
 *
 * The point of these cases is the order of the two stores and what
 * happens when one of them fails. An add that cannot write the settings
 * takes the credential back out, so no credential stays in the store with
 * no account to use it. A removal that cannot take the credential away
 * keeps the account, so the user sees the account that still holds a
 * credential.
 *
 * The cases also hold the rule that no log entry carries a password.
 */

import { describe, expect, it } from 'vitest';
import { ControlledClock } from '../../../test/harness/clock';
import type { Logger, SyncLogEntry } from '../ports/logger';
import type { SecretStore, SecretTier } from '../ports/secret-store';
import type { SettingsStore } from '../ports/settings-store';
import type { SyncedSettings } from '../model/settings';
import { DEFAULT_SETTINGS, type SettingsReading } from './read';
import { AccountService } from './service';

const PASSWORD = 'correct-horse-battery-staple';
const DRAFT = {
	serverUrl: 'https://caldav.example.com/dav/',
	username: 'ren',
};

/** A promise that refuses with the value that the caller gives. */
function refusal(value: unknown): Promise<never> {
	return Promise.resolve().then((): never => {
		throw value;
	});
}

/** A secret store in memory. The store can refuse a call. */
class MemorySecrets implements SecretStore {
	readonly held = new Map<string, string>();
	readonly tier: SecretTier;
	refuseSet = false;
	refuseRemove = false;
	/** The value that a refusal throws. */
	thrown: unknown = new Error('the storage is locked');

	constructor(tier: SecretTier = 'secret-storage') {
		this.tier = tier;
	}

	get(ref: string): Promise<string | null> {
		return Promise.resolve(this.held.get(ref) ?? null);
	}

	set(ref: string, value: string): Promise<void> {
		if (this.refuseSet) {
			return refusal(this.thrown);
		}
		this.held.set(ref, value);
		return Promise.resolve();
	}

	remove(ref: string): Promise<void> {
		if (this.refuseRemove) {
			return refusal(this.thrown);
		}
		this.held.delete(ref);
		return Promise.resolve();
	}
}

/** A settings store in memory. The store can refuse a write. */
class MemorySettings implements SettingsStore {
	settings: SyncedSettings = DEFAULT_SETTINGS;
	refuseWrite = false;
	writes = 0;

	read(): Promise<SettingsReading> {
		return Promise.resolve({ settings: this.settings, problems: [] });
	}

	write(settings: SyncedSettings): Promise<void> {
		if (this.refuseWrite) {
			return Promise.reject(new Error('the file is read-only'));
		}
		this.writes += 1;
		this.settings = settings;
		return Promise.resolve();
	}
}

/** The parts of one service, with the doubles that a case reads. */
function serviceParts(tier: SecretTier = 'secret-storage'): {
	readonly service: AccountService;
	readonly secrets: MemorySecrets;
	readonly settings: MemorySettings;
	readonly entries: SyncLogEntry[];
} {
	const secrets = new MemorySecrets(tier);
	const settings = new MemorySettings();
	const entries: SyncLogEntry[] = [];
	const logger: Logger = {
		log: (entry) => {
			entries.push(entry);
		},
	};
	const service = new AccountService({
		settings,
		secrets,
		logger,
		clock: new ControlledClock(),
	});
	return { service, secrets, settings, entries };
}

describe('an account that arrives', () => {
	it('mints the id and the credential reference, and writes both stores', async () => {
		const { service, secrets, settings } = serviceParts();
		await service.load();
		const outcome = await service.add(DRAFT, PASSWORD);
		expect(outcome.ok).toBe(true);
		expect(service.accounts).toEqual([
			{
				id: 'caldav-example-com',
				serverUrl: DRAFT.serverUrl,
				username: DRAFT.username,
				credentialType: 'app-password',
				credentialRef: 'caldav-example-com',
			},
		]);
		expect(secrets.held.get('caldav-example-com')).toBe(PASSWORD);
		expect(settings.settings.accounts).toHaveLength(1);
	});

	it('gives the second account an id of its own', async () => {
		const { service } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		await service.add(DRAFT, PASSWORD);
		expect(service.accounts.map((held) => held.id)).toEqual([
			'caldav-example-com',
			'caldav-example-com-2',
		]);
	});

	it('states the field of each value that it refuses', async () => {
		const { service, secrets, settings } = serviceParts();
		await service.load();
		const outcome = await service.add(
			{ serverUrl: 'caldav.example.com', username: '' },
			'',
		);
		expect(outcome).toEqual({
			ok: false,
			failure: null,
			faults: [
				{
					kind: 'not-a-web-address',
					field: 'serverUrl',
					value: 'caldav.example.com',
				},
				{ kind: 'empty', field: 'username' },
				{ kind: 'empty', field: 'password' },
			],
		});
		expect(secrets.held.size).toBe(0);
		expect(settings.writes).toBe(0);
	});

	it('takes the credential back where the settings do not take the account', async () => {
		const { service, secrets, settings } = serviceParts();
		await service.load();
		settings.refuseWrite = true;
		const outcome = await service.add(DRAFT, PASSWORD);
		expect(outcome).toEqual({
			ok: false,
			faults: [],
			failure: 'the file is read-only',
		});
		expect(secrets.held.size).toBe(0);
		expect(service.accounts).toEqual([]);
	});

	it('writes no account where the secret store refuses the credential', async () => {
		const { service, secrets, settings } = serviceParts();
		await service.load();
		secrets.refuseSet = true;
		const outcome = await service.add(DRAFT, PASSWORD);
		expect(outcome.ok).toBe(false);
		expect(settings.writes).toBe(0);
		expect(secrets.held.size).toBe(0);
	});
});

describe('an account that changes', () => {
	it('writes the new address and keeps the credential', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		const outcome = await service.change(
			'caldav-example-com',
			{
				serverUrl: 'https://caldav.example.com/other/',
				username: 'other',
			},
			'',
		);
		expect(outcome.ok).toBe(true);
		expect(service.accounts[0]?.username).toBe('other');
		expect(secrets.held.get('caldav-example-com')).toBe(PASSWORD);
	});

	it('writes the new credential where the user gives one', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		await service.change('caldav-example-com', DRAFT, 'another-password');
		expect(secrets.held.get('caldav-example-com')).toBe('another-password');
	});

	it('states the fault of an address that the plugin cannot reach', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		const outcome = await service.change(
			'caldav-example-com',
			{ serverUrl: 'ftp://caldav.example.com/', username: 'ren' },
			'',
		);
		expect(outcome).toMatchObject({
			ok: false,
			faults: [
				{
					kind: 'not-a-web-address',
					field: 'serverUrl',
					value: 'ftp://caldav.example.com/',
				},
			],
		});
		expect(secrets.held.get('caldav-example-com')).toBe(PASSWORD);
	});

	it('states a failure for an id that no account holds', async () => {
		const { service } = serviceParts();
		await service.load();
		const outcome = await service.change('nothing', DRAFT, '');
		expect(outcome).toEqual({
			ok: false,
			faults: [],
			failure: 'The settings hold no account with that id.',
		});
	});

	it('keeps the account where the secret store refuses the credential', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		secrets.refuseSet = true;
		const outcome = await service.change(
			'caldav-example-com',
			{ serverUrl: DRAFT.serverUrl, username: 'other' },
			'another-password',
		);
		expect(outcome.ok).toBe(false);
		expect(service.accounts[0]?.username).toBe('ren');
		expect(secrets.held.get('caldav-example-com')).toBe(PASSWORD);
	});

	it('keeps the account of the last write where the settings refuse the change', async () => {
		const { service, settings } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		settings.refuseWrite = true;
		const outcome = await service.change(
			'caldav-example-com',
			{ serverUrl: DRAFT.serverUrl, username: 'other' },
			'',
		);
		expect(outcome).toEqual({
			ok: false,
			faults: [],
			failure: 'the file is read-only',
		});
		expect(service.accounts[0]?.username).toBe('ren');
	});
});

describe('an account that goes', () => {
	it('takes the credential and the account away', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		const outcome = await service.remove('caldav-example-com');
		expect(outcome.ok).toBe(true);
		expect(service.accounts).toEqual([]);
		expect(secrets.held.size).toBe(0);
	});

	it('keeps the account where the secret store refuses the removal', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		secrets.refuseRemove = true;
		const outcome = await service.remove('caldav-example-com');
		expect(outcome.ok).toBe(false);
		expect(service.accounts).toHaveLength(1);
	});

	it('states a failure for an id that no account holds', async () => {
		const { service } = serviceParts();
		await service.load();
		const outcome = await service.remove('nothing');
		expect(outcome.ok).toBe(false);
	});

	it('states the failure where the settings refuse the write', async () => {
		const { service, settings } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		settings.refuseWrite = true;
		const outcome = await service.remove('caldav-example-com');
		expect(outcome).toEqual({
			ok: false,
			faults: [],
			failure: 'the file is read-only',
		});
	});
});

describe('what the service states about itself', () => {
	it('reads the storage of the credentials from the secret store', () => {
		expect(serviceParts('data-json').service.tier).toBe('data-json');
	});

	it('states whether the store holds a credential for an account', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		expect(await service.hasCredential('caldav-example-com')).toBe(true);
		secrets.held.clear();
		expect(await service.hasCredential('caldav-example-com')).toBe(false);
		expect(await service.hasCredential('nothing')).toBe(false);
	});

	it('keeps the problems that the read of the settings found', async () => {
		const { service, settings } = serviceParts();
		settings.read = () =>
			Promise.resolve({
				settings: DEFAULT_SETTINGS,
				problems: [{ kind: 'not-a-map' }],
			});
		await service.load();
		expect(service.problems).toEqual([{ kind: 'not-a-map' }]);
	});
});

describe('the log of the operations', () => {
	it('records the outcome of each operation, and no password', async () => {
		const { service, entries } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		await service.change('caldav-example-com', DRAFT, 'another-password');
		await service.remove('caldav-example-com');
		await service.add({ serverUrl: '', username: '' }, '');
		expect(
			entries.map((entry) => `${entry.action} ${entry.outcome}`),
		).toEqual([
			'add account success',
			'change account success',
			'remove account success',
			'add account refused',
		]);
		const text = JSON.stringify(entries);
		expect(text).not.toContain(PASSWORD);
		expect(text).not.toContain('another-password');
	});

	it('reads the words of a value that a store throws and is no error', async () => {
		const { service, entries, secrets } = serviceParts();
		await service.load();
		secrets.refuseSet = true;
		secrets.thrown = 'the storage is locked';
		const outcome = await service.add(DRAFT, PASSWORD);
		expect(outcome).toEqual({
			ok: false,
			faults: [],
			failure: 'the storage is locked',
		});
		expect(entries[0]?.reason).toBe('the storage is locked');
	});

	it('states a reason for a value that a store throws and that has no words', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		secrets.refuseSet = true;
		secrets.thrown = '';
		expect(await service.add(DRAFT, PASSWORD)).toEqual({
			ok: false,
			faults: [],
			failure: 'The store refused the write and stated no reason.',
		});
	});

	it('states a reason for an error of a store that carries no words', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		secrets.refuseSet = true;
		secrets.thrown = new Error('   ');
		expect(await service.add(DRAFT, PASSWORD)).toMatchObject({
			ok: false,
			failure: 'The store refused the write and stated no reason.',
		});
	});

	it('states a reason for a value that no reader can read as text', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		secrets.refuseSet = true;
		secrets.thrown = Object.create(null) as unknown;
		expect(await service.add(DRAFT, PASSWORD)).toMatchObject({
			ok: false,
			failure: 'The store refused the write and stated no reason.',
		});
	});

	it('states why an operation failed', async () => {
		const { service, entries, secrets } = serviceParts();
		await service.load();
		secrets.refuseSet = true;
		await service.add(DRAFT, PASSWORD);
		expect(entries[0]).toMatchObject({
			action: 'add account',
			outcome: 'failed',
			reason: 'the storage is locked',
		});
	});

	it('records a credential that it could not take back', async () => {
		const { service, entries, secrets, settings } = serviceParts();
		await service.load();
		settings.refuseWrite = true;
		secrets.refuseRemove = true;
		await service.add(DRAFT, PASSWORD);
		expect(
			entries.map((entry) => `${entry.action} ${entry.outcome}`),
		).toContain('remove credential failed');
	});
});
