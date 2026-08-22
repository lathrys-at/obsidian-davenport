/**
 * The accounts section of the settings screen.
 *
 * The section shows one row for each account, and it shows the buttons
 * that add an account, change an account, and remove an account. A removal
 * asks a question first, because it takes the app password away as well.
 *
 * The section holds no rule of its own. It draws the view that the view
 * module builds, it gives the values of the user back to the service, and
 * it shows what the service states.
 *
 * The section reads the secret store one time for each draw, and it reads
 * that store after it drew the rows. The answer arrives later, so the
 * section asks the screen whether the draw still stands. A draw that the
 * screen discarded changes nothing.
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
	REMOVE,
	REMOVE_ACCOUNT,
	removeQuestion,
} from './copy';
import { accountsView, outcomeView, passwordNote, rowNote } from './view';

/** The class of a paragraph that stands under a row of the screen. */
const NOTE_CLASS = 'setting-item-description';

/** The class of a paragraph that states a warning. */
const WARNING_CLASS = 'mod-warning';

export interface AccountsSection {
	readonly app: App;
	readonly service: AccountService;
	/** Draws the screen again, after a change of the accounts. */
	readonly redraw: () => void;
	/**
	 * True while the elements of this draw stand on the screen. A read
	 * that ends after the screen discarded the draw changes nothing.
	 */
	readonly live: () => boolean;
}

/** One row of the list, and the way to state its credential. */
interface AccountRow {
	readonly account: AccountConfig;
	readonly setNote: (text: string) => void;
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
	const rows = view.rows.map((row) =>
		renderAccount(containerEl, section, row.account, row.name, row.note),
	);
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
	void showCredentials(section, rows);
}

/** Draws one row of the list of accounts. */
function renderAccount(
	containerEl: HTMLElement,
	section: AccountsSection,
	account: AccountConfig,
	name: string,
	note: string,
): AccountRow {
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
	return {
		account,
		setNote: (text) => {
			row.setDesc(text);
		},
	};
}

/**
 * States on each row whether the secret store holds a credential for that
 * account. The read of the store ends after the draw, so the function
 * asks whether the draw still stands before it changes a row.
 */
async function showCredentials(
	section: AccountsSection,
	rows: readonly AccountRow[],
): Promise<void> {
	const held = await section.service.accountsWithCredential();
	if (!section.live()) {
		return;
	}
	for (const row of rows) {
		row.setNote(rowNote(row.account.serverUrl, held.has(row.account.id)));
	}
}

/** Opens the window that adds an account. */
function openAdd(section: AccountsSection): void {
	new AccountModal(section.app, {
		title: ADD_ACCOUNT,
		tier: section.service.tier,
		values: { serverUrl: '', username: '', password: '' },
		passwordNote: passwordNote(section.service.tier, false),
		onSubmit: (values) =>
			finish(
				section,
				section.service.add(
					{
						serverUrl: values.serverUrl,
						username: values.username,
					},
					values.password,
				),
			),
	}).open();
}

/** Opens the window that changes an account. */
function openEdit(section: AccountsSection, account: AccountConfig): void {
	new AccountModal(section.app, {
		title: EDIT_ACCOUNT,
		tier: section.service.tier,
		values: {
			serverUrl: account.serverUrl,
			username: account.username,
			password: '',
		},
		passwordNote: passwordNote(section.service.tier, true),
		onSubmit: (values) =>
			finish(
				section,
				section.service.change(
					account.id,
					{
						serverUrl: values.serverUrl,
						username: values.username,
					},
					values.password,
				),
			),
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

/**
 * Removes an account. No window waits for this outcome, so a failure
 * reaches the user through a notice of the app.
 */
async function remove(
	section: AccountsSection,
	account: AccountConfig,
): Promise<void> {
	const outcome = await section.service.remove(account.id);
	const view = outcomeView(outcome);
	if (view.notice !== null) {
		new Notice(view.notice);
	}
	if (view.redraw) {
		section.redraw();
	}
}

/**
 * Draws the section again after a write that succeeded. The window that
 * started the write states each fault, so this function gives the outcome
 * back to that window.
 */
async function finish(
	section: AccountsSection,
	pending: Promise<AccountOutcome>,
): Promise<AccountOutcome> {
	const outcome = await pending;
	if (outcomeView(outcome).redraw) {
		section.redraw();
	}
	return outcome;
}
