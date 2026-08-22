/**
 * The rules of one account, and the list of accounts.
 *
 * The point of these cases is the id. The id names the secret of the
 * account in a storage that the whole app shares, so the id takes a narrow
 * alphabet and each account holds an id of its own.
 */

import { describe, expect, it } from 'vitest';
import type { AccountConfig, SyncedSettings } from '../model/settings';
import {
	addAccount,
	checkAccount,
	findAccount,
	isWebAddress,
	mintCredentialRef,
	proposeAccountId,
	removeAccount,
	replaceAccount,
} from './accounts';

const ACCOUNT: AccountConfig = {
	id: 'caldav-example-com',
	serverUrl: 'https://caldav.example.com/',
	username: 'ren',
	credentialType: 'app-password',
	credentialRef: 'caldav-example-com',
};

function settingsOf(...accounts: AccountConfig[]): SyncedSettings {
	return { accounts, calendars: [] };
}

describe('the id of a new account', () => {
	it('comes from the host name of the server address', () => {
		expect(proposeAccountId('https://caldav.fastmail.com/dav/', [])).toBe(
			'caldav-fastmail-com',
		);
	});

	it('holds no part of the username', () => {
		const id = proposeAccountId('https://ren@caldav.example.com/dav/', []);
		expect(id).toBe('caldav-example-com');
	});

	it('adds a number where another account holds the id', () => {
		const taken = ['caldav-example-com', 'caldav-example-com-2'];
		expect(proposeAccountId('https://caldav.example.com/', taken)).toBe(
			'caldav-example-com-3',
		);
	});

	it('gives a name to an address that states no host name', () => {
		expect(proposeAccountId('not an address', [])).toBe('account');
		expect(proposeAccountId('not an address', ['account'])).toBe(
			'account-2',
		);
	});

	it('takes the characters of an address of numbers', () => {
		expect(proposeAccountId('https://192.168.1.4/dav/', [])).toBe(
			'192-168-1-4',
		);
	});

	it('gives the id to the credential reference', () => {
		expect(mintCredentialRef('caldav-example-com')).toBe(
			'caldav-example-com',
		);
	});
});

describe('the check of an account', () => {
	it('states no fault for an account with every field', () => {
		expect(checkAccount(ACCOUNT, [])).toEqual([]);
	});

	it('names the id that another account holds', () => {
		expect(checkAccount(ACCOUNT, ['caldav-example-com'])).toEqual([
			{ kind: 'repeated', field: 'id', value: 'caldav-example-com' },
		]);
	});

	it('names an id with a character outside the alphabet', () => {
		expect(checkAccount({ ...ACCOUNT, id: 'CalDAV' }, [])).toEqual([
			{ kind: 'alphabet', field: 'id', value: 'CalDAV' },
		]);
	});

	it('names a field that holds no characters', () => {
		expect(checkAccount({ ...ACCOUNT, id: '' }, [])).toEqual([
			{ kind: 'empty', field: 'id' },
		]);
		expect(checkAccount({ ...ACCOUNT, username: '' }, [])).toEqual([
			{ kind: 'empty', field: 'username' },
		]);
		expect(checkAccount({ ...ACCOUNT, serverUrl: '' }, [])).toEqual([
			{ kind: 'empty', field: 'serverUrl' },
		]);
		expect(checkAccount({ ...ACCOUNT, credentialRef: '' }, [])).toEqual([
			{ kind: 'empty', field: 'credentialRef' },
		]);
	});

	it('names a server address that the plugin cannot reach', () => {
		expect(
			checkAccount({ ...ACCOUNT, serverUrl: 'caldav.example.com' }, []),
		).toEqual([
			{
				kind: 'not-a-web-address',
				field: 'serverUrl',
				value: 'caldav.example.com',
			},
		]);
	});

	it('takes the two schemes that the plugin speaks', () => {
		expect(isWebAddress('https://caldav.example.com/')).toBe(true);
		expect(isWebAddress('http://caldav.example.com/')).toBe(true);
		expect(isWebAddress('ftp://caldav.example.com/')).toBe(false);
		expect(isWebAddress('javascript:alert(1)')).toBe(false);
		expect(isWebAddress('/dav/calendars/')).toBe(false);
	});
});

describe('the list of accounts', () => {
	it('adds an account at the end of the list', () => {
		const second = { ...ACCOUNT, id: 'two', credentialRef: 'two' };
		const settings = addAccount(settingsOf(ACCOUNT), second);
		expect(settings.accounts.map((held) => held.id)).toEqual([
			'caldav-example-com',
			'two',
		]);
	});

	it('puts an account in the place of the account of that id', () => {
		const changed = { ...ACCOUNT, username: 'other' };
		const settings = replaceAccount(settingsOf(ACCOUNT), changed);
		expect(settings.accounts).toEqual([changed]);
	});

	it('takes the account of an id out of the list', () => {
		const settings = removeAccount(settingsOf(ACCOUNT), ACCOUNT.id);
		expect(settings.accounts).toEqual([]);
	});

	it('keeps the calendars where the list of accounts changes', () => {
		const settings: SyncedSettings = {
			accounts: [ACCOUNT],
			calendars: [
				{
					name: 'Work',
					source: 'caldav',
					collectionHref: '/dav/work/',
					mode: 'remote-owned',
					components: ['VEVENT'],
				},
			],
		};
		expect(removeAccount(settings, ACCOUNT.id).calendars).toEqual(
			settings.calendars,
		);
	});

	it('finds the account of an id, and states none for another id', () => {
		expect(findAccount(settingsOf(ACCOUNT), ACCOUNT.id)).toEqual(ACCOUNT);
		expect(findAccount(settingsOf(ACCOUNT), 'other')).toBeNull();
	});
});
