/**
 * The account operations of the settings screen.
 *
 * The point of these cases is the order of the two stores and what
 * happens when one of them fails. Each operation writes the credential
 * first and the settings after it, and each operation puts the credential
 * back where the settings refuse the write. A repair that fails is a case
 * of its own: the two stores then hold different things than they held,
 * and the words of the outcome must say so.
 *
 * The cases also hold the rule that no log entry carries a password. A
 * user can type a password into the wrong field, so the log takes the
 * name of the field and the kind of the fault, and it takes no value.
 */

import { describe, expect, it } from 'vitest';
import { ControlledClock } from '../../../test/harness/clock';
import { MockCalDavServer } from '../../../test/harness/caldav-mock/server';
import {
	FakeTransport,
	refusingTransport,
} from '../../../test/harness/transport';
import type { Logger, SyncLogEntry } from '../ports/logger';
import type { SecretStore, SecretTier } from '../ports/secret-store';
import type { SettingsStore } from '../ports/settings-store';
import type { HttpTransport } from '../ports/transport';
import type { SyncedSettings } from '../model/settings';
import {
	DEFAULT_SETTINGS,
	NO_HELD_SECTIONS,
	type SettingsReading,
} from './read';
import { AccountService } from './service';

const PASSWORD = 'correct-horse-battery-staple';
/**
 * Most cases of this file make no request. The default transport of a
 * service therefore fails every request, and a case that must speak to a
 * server gives a transport of its own.
 */
const NO_REQUESTS = 'this test makes no network request';

const DRAFT = {
	serverUrl: 'https://caldav.example.com/dav/',
	username: 'ren',
};
const ID = 'caldav-example-com';

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
	refuseGet = false;
	refuseSet = false;
	refuseRemove = false;
	/** The number of the first write that the store refuses. */
	refuseSetFrom: number | null = null;
	/** The value that a refusal throws. */
	thrown: unknown = new Error('the storage is locked');
	private sets = 0;

	constructor(tier: SecretTier = 'secret-storage') {
		this.tier = tier;
	}

	get(ref: string): Promise<string | null> {
		if (this.refuseGet) {
			return refusal(this.thrown);
		}
		return Promise.resolve(this.held.get(ref) ?? null);
	}

	set(ref: string, value: string): Promise<void> {
		this.sets += 1;
		if (
			this.refuseSet ||
			(this.refuseSetFrom !== null && this.sets >= this.refuseSetFrom)
		) {
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
	problems: SettingsReading['problems'] = [];
	refuseWrite = false;
	writes = 0;

	read(): Promise<SettingsReading> {
		return Promise.resolve({
			settings: this.settings,
			problems: this.problems,
			held: NO_HELD_SECTIONS,
		});
	}

	write(settings: SyncedSettings): Promise<void> {
		if (this.refuseWrite) {
			return refusal(new Error('the file is read-only'));
		}
		this.writes += 1;
		this.settings = settings;
		return Promise.resolve();
	}
}

/** The parts of one service, with the doubles that a case reads. */
function serviceParts(
	tier: SecretTier = 'secret-storage',
	transport: HttpTransport = refusingTransport(NO_REQUESTS),
): {
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
		transport,
	});
	return { service, secrets, settings, entries };
}

/** The actions and the outcomes of the log, in order. */
function actions(entries: readonly SyncLogEntry[]): string[] {
	return entries.map((entry) => `${entry.action} ${entry.outcome}`);
}

describe('an account that arrives', () => {
	it('mints the id and the credential reference, and writes both stores', async () => {
		const { service, secrets, settings } = serviceParts();
		await service.load();
		const outcome = await service.add(DRAFT, PASSWORD);
		expect(outcome.ok).toBe(true);
		expect(service.accounts).toEqual([
			{
				id: ID,
				serverUrl: DRAFT.serverUrl,
				username: DRAFT.username,
				credentialType: 'app-password',
				credentialRef: ID,
			},
		]);
		expect(secrets.held.get(ID)).toBe(PASSWORD);
		expect(settings.settings.accounts).toHaveLength(1);
	});

	it('takes the white space off the two ends of each value', async () => {
		const { service } = serviceParts();
		await service.load();
		await service.add(
			{
				serverUrl: '  https://caldav.example.com/dav/  ',
				username: ' ren ',
			},
			PASSWORD,
		);
		expect(service.accounts[0]).toMatchObject({
			serverUrl: 'https://caldav.example.com/dav/',
			username: 'ren',
		});
	});

	it('gives the second account an id of its own', async () => {
		const { service } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		await service.add(DRAFT, PASSWORD);
		expect(service.accounts.map((held) => held.id)).toEqual([
			ID,
			`${ID}-2`,
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

	it('refuses a server address that carries a username or a password', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		const outcome = await service.add(
			{
				serverUrl: `https://ren:${PASSWORD}@caldav.example.com/`,
				username: 'ren',
			},
			PASSWORD,
		);
		expect(outcome).toEqual({
			ok: false,
			failure: null,
			faults: [{ kind: 'credentials-in-address', field: 'serverUrl' }],
		});
		expect(secrets.held.size).toBe(0);
		expect(service.accounts).toEqual([]);
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

	it('states that the credential stands where it cannot take it back', async () => {
		const { service, secrets, settings, entries } = serviceParts();
		await service.load();
		settings.refuseWrite = true;
		secrets.refuseRemove = true;
		const outcome = await service.add(DRAFT, PASSWORD);
		expect(outcome.ok).toBe(false);
		expect(outcome.ok ? '' : outcome.failure).toContain(
			'no account holds it',
		);
		expect(secrets.held.get(ID)).toBe(PASSWORD);
		expect(actions(entries)).toContain('restore app password failed');
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
			ID,
			{
				serverUrl: 'https://caldav.example.com/other/',
				username: 'other',
			},
			'',
		);
		expect(outcome.ok).toBe(true);
		expect(service.accounts[0]?.username).toBe('other');
		expect(secrets.held.get(ID)).toBe(PASSWORD);
	});

	it('writes the new credential where the user gives one', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		await service.change(ID, DRAFT, 'another-password');
		expect(secrets.held.get(ID)).toBe('another-password');
	});

	it('changes one account of two, and leaves the other one', async () => {
		const { service } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		await service.add(
			{ serverUrl: 'https://other.example.com/', username: 'sam' },
			'another-password',
		);
		const outcome = await service.change(
			ID,
			{ serverUrl: DRAFT.serverUrl, username: 'other' },
			'',
		);
		expect(outcome.ok).toBe(true);
		expect(service.accounts.map((held) => held.username)).toEqual([
			'other',
			'sam',
		]);
	});

	it('states the fault of an address that the plugin cannot reach', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		const outcome = await service.change(
			ID,
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
		expect(secrets.held.get(ID)).toBe(PASSWORD);
	});

	it('states a failure for an id that no account holds', async () => {
		const { service } = serviceParts();
		await service.load();
		const outcome = await service.change('nothing', DRAFT, '');
		expect(outcome).toEqual({
			ok: false,
			faults: [],
			failure: 'Davenport holds no account of that name.',
		});
	});

	it('keeps the account where the secret store refuses the credential', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		secrets.refuseSet = true;
		const outcome = await service.change(
			ID,
			{ serverUrl: DRAFT.serverUrl, username: 'other' },
			'another-password',
		);
		expect(outcome.ok).toBe(false);
		expect(service.accounts[0]?.username).toBe('ren');
		expect(secrets.held.get(ID)).toBe(PASSWORD);
	});

	it('keeps the account of the last write where the settings refuse the change', async () => {
		const { service, settings } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		settings.refuseWrite = true;
		const outcome = await service.change(
			ID,
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

	it('puts the old credential back where the settings refuse the change', async () => {
		const { service, secrets, settings } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		settings.refuseWrite = true;
		const outcome = await service.change(
			ID,
			{ serverUrl: DRAFT.serverUrl, username: 'other' },
			'another-password',
		);
		expect(outcome).toEqual({
			ok: false,
			faults: [],
			failure: 'the file is read-only',
		});
		expect(secrets.held.get(ID)).toBe(PASSWORD);
		expect(service.accounts[0]?.username).toBe('ren');
	});

	it('states that the new credential stands where it cannot put the old one back', async () => {
		const { service, secrets, settings, entries } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		settings.refuseWrite = true;
		secrets.refuseSetFrom = 3;
		const outcome = await service.change(
			ID,
			{ serverUrl: DRAFT.serverUrl, username: 'other' },
			'another-password',
		);
		expect(outcome.ok).toBe(false);
		expect(outcome.ok ? '' : outcome.failure).toContain(
			'now holds the new app password',
		);
		expect(secrets.held.get(ID)).toBe('another-password');
		expect(actions(entries)).toContain('restore app password failed');
	});

	it('states the failure where it cannot read the credential', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		secrets.refuseGet = true;
		const outcome = await service.change(ID, DRAFT, 'another-password');
		expect(outcome.ok).toBe(false);
		expect(secrets.held.get(ID)).toBe(PASSWORD);
	});
});

describe('an account that goes', () => {
	it('takes the credential and the account away', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		const outcome = await service.remove(ID);
		expect(outcome.ok).toBe(true);
		expect(service.accounts).toEqual([]);
		expect(secrets.held.size).toBe(0);
	});

	it('keeps the account where the secret store refuses the removal', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		secrets.refuseRemove = true;
		const outcome = await service.remove(ID);
		expect(outcome.ok).toBe(false);
		expect(service.accounts).toHaveLength(1);
		expect(secrets.held.get(ID)).toBe(PASSWORD);
	});

	it('keeps the account where it cannot read the credential', async () => {
		const { service, secrets, entries } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		secrets.refuseGet = true;
		const outcome = await service.remove(ID);
		expect(outcome.ok).toBe(false);
		expect(service.accounts).toHaveLength(1);
		expect(secrets.held.get(ID)).toBe(PASSWORD);
		expect(entries[entries.length - 1]).toMatchObject({
			action: 'remove account',
			outcome: 'failed',
			reason: 'app password read',
		});
	});

	it('states a failure for an id that no account holds', async () => {
		const { service } = serviceParts();
		await service.load();
		const outcome = await service.remove('nothing');
		expect(outcome).toEqual({
			ok: false,
			faults: [],
			failure: 'Davenport holds no account of that name.',
		});
	});

	it('puts the credential back where the settings refuse the write', async () => {
		const { service, secrets, settings } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		settings.refuseWrite = true;
		const outcome = await service.remove(ID);
		expect(outcome).toEqual({
			ok: false,
			faults: [],
			failure: 'the file is read-only',
		});
		expect(service.accounts).toHaveLength(1);
		expect(secrets.held.get(ID)).toBe(PASSWORD);
	});

	it('states that the credential is gone where it cannot put it back', async () => {
		const { service, secrets, settings, entries } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		settings.refuseWrite = true;
		secrets.refuseSetFrom = 2;
		const outcome = await service.remove(ID);
		expect(outcome.ok).toBe(false);
		expect(outcome.ok ? '' : outcome.failure).toContain(
			'Enter the app password again.',
		);
		expect(secrets.held.has(ID)).toBe(false);
		expect(service.accounts).toHaveLength(1);
		expect(actions(entries)).toContain('restore app password failed');
	});
});

describe('what the service states about itself', () => {
	it('reads the storage of the credentials from the secret store', () => {
		expect(serviceParts('data-json').service.tier).toBe('data-json');
	});

	it('names the accounts that hold a credential', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		await service.add(
			{ serverUrl: 'https://other.example.com/', username: 'sam' },
			'another-password',
		);
		expect([...(await service.accountsWithCredential())]).toEqual([
			ID,
			'other-example-com',
		]);
		secrets.held.delete(ID);
		expect([...(await service.accountsWithCredential())]).toEqual([
			'other-example-com',
		]);
	});

	it('leaves an account out where it cannot read the credential', async () => {
		const { service, secrets, entries } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		secrets.refuseGet = true;
		expect([...(await service.accountsWithCredential())]).toEqual([]);
		expect(actions(entries)).toContain('read app password failed');
	});

	it('keeps the problems that the read of the settings found', async () => {
		const { service, settings } = serviceParts();
		settings.problems = [{ kind: 'not-a-map' }];
		await service.load();
		expect(service.problems).toEqual([{ kind: 'not-a-map' }]);
	});

	it('reads the problems again after a write of the settings', async () => {
		const { service, settings } = serviceParts();
		settings.problems = [{ kind: 'not-a-map' }];
		await service.load();
		settings.problems = [];
		await service.add(DRAFT, PASSWORD);
		expect(service.problems).toEqual([]);
	});

	it('keeps the settings of the write where the read after it fails', async () => {
		const { service, settings } = serviceParts();
		await service.load();
		settings.read = () => refusal(new Error('the file went away'));
		await service.add(DRAFT, PASSWORD);
		expect(service.accounts).toHaveLength(1);
	});
});

describe('the log of the operations', () => {
	it('records the outcome of each operation, and no password', async () => {
		const { service, entries } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		await service.change(ID, DRAFT, 'another-password');
		await service.remove(ID);
		await service.add({ serverUrl: '', username: '' }, '');
		expect(actions(entries)).toEqual([
			'add account success',
			'change account success',
			'remove account success',
			'add account refused',
		]);
		const text = JSON.stringify(entries);
		expect(text).not.toContain(PASSWORD);
		expect(text).not.toContain('another-password');
	});

	it('records the field and the kind of a fault, and no value', async () => {
		const { service, entries } = serviceParts();
		await service.load();
		const outcome = await service.add(
			{ serverUrl: PASSWORD, username: 'ren' },
			PASSWORD,
		);
		expect(outcome.ok).toBe(false);
		expect(entries[0]).toMatchObject({
			action: 'add account',
			outcome: 'refused',
			reason: 'serverUrl not-a-web-address',
		});
		expect(JSON.stringify(entries)).not.toContain(PASSWORD);
	});

	it('records a word of the plugin for an id that no account holds', async () => {
		const { service, entries } = serviceParts();
		await service.load();
		await service.remove('nothing');
		expect(entries[0]?.reason).toBe('no-such-account');
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
		expect(entries[0]?.reason).toBe('app password write');
	});

	it('states a reason for a value that a store throws and that has no words', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		secrets.refuseSet = true;
		secrets.thrown = '';
		expect(await service.add(DRAFT, PASSWORD)).toEqual({
			ok: false,
			faults: [],
			failure:
				'Davenport could not save the app password, and the reason is not known.',
		});
	});

	it('states a reason for an error of a store that carries no words', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		secrets.refuseSet = true;
		secrets.thrown = new Error('   ');
		expect(await service.add(DRAFT, PASSWORD)).toMatchObject({
			ok: false,
			failure:
				'Davenport could not save the app password, and the reason is not known.',
		});
	});

	it('states a reason for a value that no reader can read as text', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		secrets.refuseSet = true;
		secrets.thrown = Object.create(null) as unknown;
		expect(await service.add(DRAFT, PASSWORD)).toMatchObject({
			ok: false,
			failure:
				'Davenport could not save the app password, and the reason is not known.',
		});
	});

	it('names the settings in the reason where the settings refuse a write', async () => {
		const { service, settings } = serviceParts();
		await service.load();
		settings.refuseWrite = true;
		settings.write = () => refusal(new Error(''));
		expect(await service.add(DRAFT, PASSWORD)).toMatchObject({
			ok: false,
			failure:
				'Davenport could not save the settings, and the reason is not known.',
		});
	});

	it('names the step that failed in the log, and no words of a store', async () => {
		const { service, entries, secrets } = serviceParts();
		await service.load();
		secrets.refuseSet = true;
		await service.add(DRAFT, PASSWORD);
		expect(entries[0]).toMatchObject({
			action: 'add account',
			outcome: 'failed',
			reason: 'app password write',
		});
		expect(JSON.stringify(entries)).not.toContain('the storage is locked');
	});
});

describe('the password against the alphabet of the sign-in header', () => {
	const OUTSIDE = '\u043f\u0430\u0440\u043e\u043b\u044c';

	it('refuses an add whose password the header cannot carry', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		expect(await service.add(DRAFT, OUTSIDE)).toEqual({
			ok: false,
			faults: [{ kind: 'sign-in-alphabet', field: 'password' }],
			failure: null,
		});
		expect(secrets.held.size).toBe(0);
	});

	it('refuses a change whose new password the header cannot carry', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		expect(await service.change(ID, DRAFT, OUTSIDE)).toEqual({
			ok: false,
			faults: [{ kind: 'sign-in-alphabet', field: 'password' }],
			failure: null,
		});
		expect(secrets.held.get(ID)).toBe(PASSWORD);
	});

	it('keeps the password of the store where the field is empty', async () => {
		const { service, secrets } = serviceParts();
		await service.load();
		await service.add(DRAFT, PASSWORD);
		expect((await service.change(ID, DRAFT, '')).ok).toBe(true);
		expect(secrets.held.get(ID)).toBe(PASSWORD);
	});

	it('names the field and the kind in the log, and no value', async () => {
		const { service, entries } = serviceParts();
		await service.load();
		await service.add(DRAFT, OUTSIDE);
		expect(entries[0]).toMatchObject({
			action: 'add account',
			outcome: 'refused',
			reason: 'password sign-in-alphabet',
		});
		expect(JSON.stringify(entries)).not.toContain(OUTSIDE);
	});
});

describe('the connection test of one account', () => {
	/** A mock calendar server with one account and one calendar. */
	function calendarServer(): MockCalDavServer {
		return new MockCalDavServer({
			accounts: [{ name: 'ren', collections: [{ name: 'home' }] }],
		});
	}

	/** Adds the account of that server and gives its id back. */
	async function withAccount(
		service: AccountService,
		serverUrl: string,
		password = PASSWORD,
	): Promise<string> {
		await service.load();
		const outcome = await service.add(
			{ serverUrl, username: 'ren' },
			password,
		);
		if (!outcome.ok) {
			throw new Error('the case could not add the account');
		}
		return outcome.account.id;
	}

	it('states a sign-in where the server answers the discovery', async () => {
		const mock = calendarServer();
		const { service } = serviceParts('secret-storage', mock);
		const id = await withAccount(service, mock.principalRootUrl);
		expect(await service.testConnection(id)).toBe('signed-in');
	});

	it('states a refusal where the server refuses the credential', async () => {
		const mock = calendarServer();
		const { service } = serviceParts('secret-storage', mock);
		const id = await withAccount(service, mock.principalRootUrl);
		mock.configure({ faults: [{ kind: 'status', status: 401 }] });
		expect(await service.testConnection(id)).toBe('refused');
	});

	it('states no server where the transport fails', async () => {
		const { service } = serviceParts(
			'secret-storage',
			new FakeTransport({ fails: 'the network is down' }),
		);
		const id = await withAccount(
			service,
			'https://caldav.example.com/dav/',
		);
		expect(await service.testConnection(id)).toBe('not-reached');
	});

	it('states no account where the settings hold none of that name', async () => {
		const { service } = serviceParts();
		await service.load();
		expect(await service.testConnection('no-such-account')).toBe(
			'no-account',
		);
	});

	it('states no credential where the store holds none', async () => {
		const { service, secrets } = serviceParts();
		const id = await withAccount(
			service,
			'https://caldav.example.com/dav/',
		);
		secrets.held.clear();
		expect(await service.testConnection(id)).toBe('no-credential');
	});

	it('states an unreadable credential where the store fails', async () => {
		const { service, secrets } = serviceParts();
		const id = await withAccount(
			service,
			'https://caldav.example.com/dav/',
		);
		secrets.refuseGet = true;
		expect(await service.testConnection(id)).toBe('credential-unreadable');
	});

	it('states an unreadable credential where the text states none of that type', async () => {
		const { service, secrets, settings } = serviceParts();
		const id = await withAccount(
			service,
			'https://caldav.example.com/dav/',
		);
		settings.settings = {
			...settings.settings,
			accounts: settings.settings.accounts.map((account) => ({
				...account,
				credentialType: 'oauth' as const,
			})),
		};
		await service.load();
		secrets.held.set(id, 'not a set of tokens');
		expect(await service.testConnection(id)).toBe('credential-unreadable');
	});

	it('names the alphabet where the password stands outside it', async () => {
		const { service, secrets } = serviceParts();
		const id = await withAccount(
			service,
			'https://caldav.example.com/dav/',
		);
		secrets.held.set(id, 'пароль');
		expect(await service.testConnection(id)).toBe('credential-alphabet');
	});

	it('writes one entry of the log, with the result and no value of the user', async () => {
		const mock = calendarServer();
		const { service, entries } = serviceParts('secret-storage', mock);
		const id = await withAccount(service, mock.principalRootUrl);
		entries.length = 0;
		await service.testConnection(id);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			action: 'test connection',
			item: id,
			outcome: 'success',
			reason: 'signed-in',
		});
		expect(JSON.stringify(entries)).not.toContain(PASSWORD);
	});

	it.each([
		['refused', 'refused'],
		['not-reached', 'failed'],
	])('writes the outcome of %s as %s', async (result, outcome) => {
		const mock = calendarServer();
		const { service, entries } = serviceParts(
			'secret-storage',
			result === 'refused'
				? mock
				: new FakeTransport({ fails: 'the network is down' }),
		);
		const id = await withAccount(service, mock.principalRootUrl);
		if (result === 'refused') {
			mock.configure({ faults: [{ kind: 'status', status: 401 }] });
		}
		entries.length = 0;
		expect(await service.testConnection(id)).toBe(result);
		expect(entries[0]?.outcome).toBe(outcome);
	});
});
