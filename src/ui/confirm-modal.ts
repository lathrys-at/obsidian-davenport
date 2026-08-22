/**
 * The window that asks a question before an action that the user cannot
 * undo.
 *
 * The window states what the action does. The user then selects the button
 * that starts the action, or the button that closes the window. The window
 * starts the action one time.
 */

import { App, Modal, Setting } from 'obsidian';
import { CANCEL } from './copy';

export interface ConfirmParts {
	readonly title: string;
	readonly question: string;
	/** The words on the button that starts the action. */
	readonly confirm: string;
	readonly onConfirm: () => void;
}

export class ConfirmModal extends Modal {
	private readonly parts: ConfirmParts;

	constructor(app: App, parts: ConfirmParts) {
		super(app);
		this.parts = parts;
	}

	override onOpen(): void {
		this.setTitle(this.parts.title);
		this.contentEl.createEl('p', { text: this.parts.question });
		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText(CANCEL).onClick(() => {
					this.close();
				}),
			)
			.addButton((button) => {
				button.setButtonText(this.parts.confirm).onClick(() => {
					this.close();
					this.parts.onConfirm();
				});
				// The class gives the button the colors of an action that
				// takes data away. Two methods of the API add this class.
				// `setDestructive` needs Obsidian 1.13.0, which is newer
				// than the version that the manifest states.
				// `setWarning` works on that version and carries a
				// deprecation.
				button.buttonEl.addClass('mod-warning');
			});
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
