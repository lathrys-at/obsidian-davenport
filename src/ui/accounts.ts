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
 *
 * A row also has a button that tests the connection of that account. The
 * test speaks to the server, so the answer arrives later as well, and it
 * lands in a paragraph under the row. The same rule holds there: an answer
 * that arrives after the screen discarded the draw changes nothing.
 */

import { App, Notice, Setting } from 'obsidian';
import type { ButtonComponent } from 'obsidian';
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
import type { ConnectionView } from './view';
import {
	accountsView,
	connectionRunningView,
	connectionView,
	outcomeView,
	passwordNote,
	rowNote,
} from './view';

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
		renderAccount(containerEl, section, row.account, {
			name: row.name,
			note: row.note,
			testButton: view.testButton,
		}),
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

/** The words that one row of the list draws. */
interface AccountRowText {
	readonly name: string;
	readonly note: string;
	readonly testButton: string;
}

/**
 * Draws one row of the list of accounts. The paragraph that states the
 * result of a connection test stands after the row, and not inside the
 * description of the row: a later read of the secret store writes that
 * description again.
 */
function renderAccount(
	containerEl: HTMLElement,
	section: AccountsSection,
	account: AccountConfig,
	text: AccountRowText,
): AccountRow {
	const row = new Setting(containerEl).setName(text.name).setDesc(text.note);
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
	const state = containerEl.createEl('p', { cls: NOTE_CLASS });
	state.hide();
	row.addButton((button) =>
		button.setButtonText(text.testButton).onClick(() => {
			void runTest(section, account, state, button);
		}),
	);
	return {
		account,
		setNote: (note) => {
			row.setDesc(note);
		},
	};
}

/**
 * Tests the connection of one account and states the result under the row.
 * The screen states that the test runs first, because the test speaks to a
 * server and the answer takes time.
 *
 * The button takes no second selection while its own test runs. Two tests
 * of one account write to one paragraph, and the test that ends last then
 * states its result over the result of the other one. The button takes
 * selections again when the test ends, and it does so only while the draw
 * that holds it stands on the screen.
 *
 * The function writes the `disabled` property of the element of the
 * button. The `setDisabled` method of the API does the same, and that
 * method arrives in a version of Obsidian that is newer than the version
 * that the manifest states.
 */
async function runTest(
	section: AccountsSection,
	account: AccountConfig,
	state: HTMLElement,
	button: ButtonComponent,
): Promise<void> {
	button.buttonEl.disabled = true;
	try {
		say(state, connectionRunningView());
		const result = await section.service.testConnection(account.id);
		if (section.live()) {
			say(state, connectionView(result));
		}
	} finally {
		if (section.live()) {
			button.buttonEl.disabled = false;
		}
	}
}

/** Writes one paragraph of the screen. */
function say(element: HTMLElement, view: ConnectionView): void {
	element.setText(view.text);
	element.toggleClass(WARNING_CLASS, view.warning);
	element.toggleClass(NOTE_CLASS, !view.warning);
	element.show();
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
