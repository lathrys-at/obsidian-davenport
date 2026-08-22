/**
 * The view of the accounts section.
 *
 * The point of these cases is the paragraph about the storage of the app
 * passwords. The section shows a warning while the data file holds those
 * passwords, and it shows that warning each time the screen opens.
 */

import { describe, expect, it } from 'vitest';
import type { AccountConfig } from '../core/model/settings';
import { DATA_FILE_WARNING, SECRET_STORAGE_NOTE } from './copy';
import { accountsView } from './view';

const ACCOUNT: AccountConfig = {
	id: 'caldav-example-com',
	serverUrl: 'https://caldav.example.com/',
	username: 'ren',
	credentialType: 'app-password',
	credentialRef: 'caldav-example-com',
};

describe('what the section states about the storage', () => {
	it('warns while the data file holds the app passwords', () => {
		const view = accountsView('data-json', [], []);
		expect(view.storage).toEqual({
			text: DATA_FILE_WARNING,
			warning: true,
		});
		expect(view.storage.text).toContain('plain text');
	});

	it('names the secret storage where that storage holds them', () => {
		expect(accountsView('secret-storage', [], []).storage).toEqual({
			text: SECRET_STORAGE_NOTE,
			warning: false,
		});
	});

	it('asks for an app password and states the reason', () => {
		const view = accountsView('secret-storage', [], []);
		expect(view.intro).toContain('app password');
		expect(view.intro).toContain('one account');
	});
});

describe('the list of accounts', () => {
	it('shows the username and the address of each account', () => {
		const view = accountsView('secret-storage', [ACCOUNT], []);
		expect(view.rows).toEqual([
			{
				account: ACCOUNT,
				name: 'ren',
				note: 'https://caldav.example.com/',
			},
		]);
		expect(view.empty).toBeNull();
	});

	it('states the way to the first account where the list is empty', () => {
		const view = accountsView('secret-storage', [], []);
		expect(view.rows).toEqual([]);
		expect(view.empty).toContain('Add account');
	});
});

describe('the entries that the plugin did not read', () => {
	it('states each problem of the read', () => {
		const view = accountsView(
			'secret-storage',
			[],
			[{ kind: 'not-a-map' }],
		);
		expect(view.problemsHeading).not.toBeNull();
		expect(view.problemsNote).not.toBeNull();
		expect(view.problems).toHaveLength(1);
	});

	it('states nothing where the read found no problem', () => {
		const view = accountsView('secret-storage', [ACCOUNT], []);
		expect(view.problemsHeading).toBeNull();
		expect(view.problemsNote).toBeNull();
		expect(view.problems).toEqual([]);
	});
});
