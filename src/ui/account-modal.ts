/**
 * The window that takes the fields of one account.
 *
 * The window takes the address of the server, the username, and the app
 * password. It gives those three values to the caller, and the caller
 * writes them. Where the caller refuses a value, the window states each
 * fault and stays open, so the user corrects the value in place.
 *
 * The field that takes the password uses the secret component of Obsidian
 * where two conditions hold: the version of Obsidian has that component,
 * and the secret storage of Obsidian holds the passwords. A component
 * that states "secret" beside a field would otherwise stand over a data
 * file that holds the password as plain text. In every other case the
 * field is a text field that shows dots in the place of the characters.
 * The window shows no password that the plugin already holds.
 */

import {
	App,
	Modal,
	SecretComponent,
	Setting,
	requireApiVersion,
} from 'obsidian';
import type { SecretTier } from '../core/ports/secret-store';
import type { AccountOutcome } from '../core/settings/service';
import { outcomeView } from './view';
import {
	APP_PASSWORD,
	CANCEL,
	SAVE,
	SERVER_URL,
	SERVER_URL_EXAMPLE,
	SERVER_URL_NOTE,
	USERNAME,
	USERNAME_NOTE,
} from './copy';

export interface AccountFormValues {
	serverUrl: string;
	username: string;
	password: string;
}

export interface AccountFormParts {
	readonly title: string;
	/** The storage that holds the passwords. */
	readonly tier: SecretTier;
	/** The values that the fields hold when the window opens. */
	readonly values: AccountFormValues;
	/** The words that stand beside the field of the password. */
	readonly passwordNote: string;
	/**
	 * Takes the values and writes them. The window closes where the write
	 * succeeded. Where the write did not succeed, the window states each
	 * fault and stays open.
	 */
	readonly onSubmit: (values: AccountFormValues) => Promise<AccountOutcome>;
}

export class AccountModal extends Modal {
	private readonly parts: AccountFormParts;
	private readonly values: AccountFormValues;
	private messages: readonly string[] = [];
	private messagesEl: HTMLElement | null = null;

	constructor(app: App, parts: AccountFormParts) {
		super(app);
		this.parts = parts;
		this.values = { ...parts.values };
	}

	override onOpen(): void {
		this.setTitle(this.parts.title);
		const content = this.contentEl;
		new Setting(content)
			.setName(SERVER_URL)
			.setDesc(SERVER_URL_NOTE)
			.addText((text) =>
				text
					.setPlaceholder(SERVER_URL_EXAMPLE)
					.setValue(this.values.serverUrl)
					.onChange((value) => {
						this.values.serverUrl = value;
					}),
			);
		new Setting(content)
			.setName(USERNAME)
			.setDesc(USERNAME_NOTE)
			.addText((text) =>
				text.setValue(this.values.username).onChange((value) => {
					this.values.username = value;
				}),
			);
		this.password(
			new Setting(content)
				.setName(APP_PASSWORD)
				.setDesc(this.parts.passwordNote),
		);
		this.messagesEl = content.createDiv({ cls: 'mod-warning' });
		this.showMessages();
		new Setting(content)
			.addButton((button) =>
				button.setButtonText(CANCEL).onClick(() => {
					this.close();
				}),
			)
			.addButton((button) =>
				button
					.setButtonText(SAVE)
					.setCta()
					.onClick(() => {
						void this.submit();
					}),
			);
	}

	override onClose(): void {
		this.messagesEl = null;
		this.contentEl.empty();
	}

	/**
	 * Adds the field that takes the password. The secret component of
	 * Obsidian arrives in version 1.11.4, and the version test asks for
	 * that version. The component stands over the secret storage, so the
	 * field takes it only while that storage holds the passwords.
	 */
	private password(setting: Setting): void {
		if (
			requireApiVersion('1.11.4') &&
			this.parts.tier === 'secret-storage'
		) {
			const secret = new SecretComponent(this.app, setting.controlEl);
			secret.setValue(this.values.password).onChange((value) => {
				this.values.password = value;
			});
			return;
		}
		setting.addText((text) => {
			text.inputEl.type = 'password';
			text.setValue(this.values.password).onChange((value) => {
				this.values.password = value;
			});
		});
	}

	private async submit(): Promise<void> {
		const view = outcomeView(await this.parts.onSubmit({ ...this.values }));
		if (view.done) {
			this.close();
			return;
		}
		this.messages = view.messages;
		this.showMessages();
	}

	private showMessages(): void {
		const holder = this.messagesEl;
		if (holder === null) {
			return;
		}
		holder.empty();
		for (const message of this.messages) {
			holder.createEl('p', { text: message });
		}
	}
}
