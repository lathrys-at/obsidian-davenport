/**
 * The accounts section of the settings screen.
 *
 * The section shows one row for each account, and it shows the buttons
 * that add an account, change an account, and remove an account. A removal
 * asks a question first, because a removal takes the app password away as
 * well.
 *
 * The section holds no rule of its own. It draws the view that the view
 * module builds, it gives the values of the user back to the service, and
 * it shows what the service states.
 */

import { App, Notice, Setting } from 'obsidian';
import type { AccountConfig } from '../core/model/settings';
import type { AccountOutcome, AccountService } from '../core/settings/service';
import { AccountModal } from './account-modal';
import { ConfirmModal } from './confirm-modal';
import {
	ADD_ACCOUNT,
	EDIT,
	EDIT_ACCOUNT,
	KEEP_PASSWORD,
	NO_CREDENTIAL,
	REMOVE,
	REMOVE_ACCOUNT,
	removeQuestion,
	tierNote,
} from './copy';
import { accountsView } from './view';

/** The class of a paragraph that stands under a row of the screen. */
const NOTE_CLASS = 'setting-item-description';

/** The class of a paragraph that states a warning. */
const WARNING_CLASS = 'mod-warning';

export interface AccountsSection {
	readonly app: App;
	readonly service: AccountService;
	/** Draws the screen again, after a change of the accounts. */
	readonly redraw: () => void;
}

/** Draws the accounts section into the element. */
export function renderAccounts(
	containerEl: HTMLElement,
	section: AccountsSection,
): void {
	const { service } = section;
	const view = accountsView(service.tier, service.accounts, service.problems);
	new Setting(containerEl).setName(view.heading).setHeading();
	containerEl.createEl('p', { text: view.intro, cls: NOTE_CLASS });
	containerEl.createEl('p', {
		text: view.storage.text,
		cls: view.storage.warning ? WARNING_CLASS : NOTE_CLASS,
	});
	for (const row of view.rows) {
		renderAccount(containerEl, section, row.account, row.name, row.note);
	}
	if (view.empty !== null) {
		containerEl.createEl('p', { text: view.empty, cls: NOTE_CLASS });
	}
	new Setting(containerEl).addButton((button) =>
		button
			.setButtonText(view.addButton)
			.setCta()
			.onClick(() => {
				openAdd(section);
			}),
	);
	if (view.problemsHeading !== null && view.problemsNote !== null) {
		new Setting(containerEl).setName(view.problemsHeading).setHeading();
		containerEl.createEl('p', {
			text: view.problemsNote,
			cls: NOTE_CLASS,
		});
		const list = containerEl.createEl('ul');
		for (const problem of view.problems) {
			list.createEl('li', { text: problem });
		}
	}
}

/** Draws one row of the list of accounts. */
function renderAccount(
	containerEl: HTMLElement,
	section: AccountsSection,
	account: AccountConfig,
	name: string,
	note: string,
): void {
	const row = new Setting(containerEl).setName(name).setDesc(note);
	row.addButton((button) =>
		button.setButtonText(EDIT).onClick(() => {
			openEdit(section, account);
		}),
	);
	row.addButton((button) =>
		button.setButtonText(REMOVE).onClick(() => {
			openRemove(section, account);
		}),
	);
	void section.service.hasCredential(account.id).then((held) => {
		if (!held) {
			row.setDesc(`${note} ${NO_CREDENTIAL}`);
		}
	});
}

/** Opens the window that adds an account. */
function openAdd(section: AccountsSection): void {
	new AccountModal(section.app, {
		title: ADD_ACCOUNT,
		values: { serverUrl: '', username: '', password: '' },
		passwordNote: tierNote(section.service.tier),
		onSubmit: async (values) => {
			const outcome = await section.service.add(
				{
					serverUrl: values.serverUrl.trim(),
					username: values.username.trim(),
				},
				values.password,
			);
			return finish(section, outcome);
		},
	}).open();
}

/** Opens the window that changes an account. */
function openEdit(section: AccountsSection, account: AccountConfig): void {
	new AccountModal(section.app, {
		title: EDIT_ACCOUNT,
		values: {
			serverUrl: account.serverUrl,
			username: account.username,
			password: '',
		},
		passwordNote: `${KEEP_PASSWORD} ${tierNote(section.service.tier)}`,
		onSubmit: async (values) => {
			const outcome = await section.service.change(
				account.id,
				{
					serverUrl: values.serverUrl.trim(),
					username: values.username.trim(),
				},
				values.password,
			);
			return finish(section, outcome);
		},
	}).open();
}

/** Opens the window that asks the question before a removal. */
function openRemove(section: AccountsSection, account: AccountConfig): void {
	new ConfirmModal(section.app, {
		title: REMOVE_ACCOUNT,
		question: removeQuestion(account.username, account.serverUrl),
		confirm: REMOVE,
		onConfirm: () => {
			void remove(section, account);
		},
	}).open();
}

async function remove(
	section: AccountsSection,
	account: AccountConfig,
): Promise<void> {
	finish(section, await section.service.remove(account.id));
}

/**
 * Draws the screen again after an operation that succeeded, and states a
 * failure of a store to the user. The window that started the operation
 * shows each fault of a field, so this function passes the outcome on.
 */
function finish(
	section: AccountsSection,
	outcome: AccountOutcome,
): AccountOutcome {
	if (outcome.ok) {
		section.redraw();
		return outcome;
	}
	if (outcome.failure !== null) {
		new Notice(outcome.failure);
	}
	return outcome;
}
