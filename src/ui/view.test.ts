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
import { accountsView, outcomeView, passwordNote, rowNote } from './view';

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

describe('the words under the name of one account', () => {
	it('state the address of the server', () => {
		expect(rowNote('https://caldav.example.com/', true)).toBe(
			'https://caldav.example.com/',
		);
	});

	it('state the way to the field where the account holds no password', () => {
		const note = rowNote('https://caldav.example.com/', false);
		expect(note).toContain('https://caldav.example.com/');
		expect(note).toContain('This account has no app password');
		expect(note).toContain('"Edit"');
	});
});

describe('the words beside the field of the password', () => {
	it('state the storage where the window takes a new account', () => {
		expect(passwordNote('secret-storage', false)).toBe(
			'Davenport keeps this password in the secret storage of Obsidian.',
		);
	});

	it('state the empty field first where the account stands', () => {
		const note = passwordNote('data-json', true);
		expect(note.startsWith('Leave this field empty')).toBe(true);
		expect(note).toContain('data file');
	});
});

describe('what the screen does with one outcome', () => {
	it('closes the window and draws the section again after a write', () => {
		expect(outcomeView({ ok: true, account: ACCOUNT })).toEqual({
			done: true,
			messages: [],
			notice: null,
			redraw: true,
		});
	});

	it('states each fault in the window that the user works in', () => {
		const view = outcomeView({
			ok: false,
			failure: null,
			faults: [
				{ kind: 'empty', field: 'username' },
				{ kind: 'empty', field: 'password' },
			],
		});
		expect(view.done).toBe(false);
		expect(view.redraw).toBe(false);
		expect(view.notice).toBeNull();
		expect(view.messages).toHaveLength(2);
		expect(view.messages[0]).toContain('"username"');
	});

	it('states a failure of a store in the window and in a notice', () => {
		const view = outcomeView({
			ok: false,
			faults: [],
			failure: 'the file is read-only',
		});
		expect(view.messages).toEqual(['the file is read-only']);
		expect(view.notice).toBe('the file is read-only');
		expect(view.redraw).toBe(false);
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
