/**
 * The settings screen of the plugin.
 *
 * The screen draws one section for each part of the configuration. The
 * accounts section is the first section, and the other sections arrive
 * with the features that they configure.
 *
 * Obsidian calls `display` each time the user opens the screen. The screen
 * clears the element and draws the sections again. A change of an account
 * therefore shows in the list at the moment the change lands.
 */

import { App, Plugin, PluginSettingTab } from 'obsidian';
import type { AccountService } from '../core/settings/service';
import { renderAccounts } from './accounts';

export class DavenportSettingTab extends PluginSettingTab {
	private readonly service: AccountService;

	constructor(app: App, plugin: Plugin, service: AccountService) {
		super(app, plugin);
		this.service = service;
	}

	override display(): void {
		this.containerEl.empty();
		renderAccounts(this.containerEl, {
			app: this.app,
			service: this.service,
			redraw: () => {
				this.display();
			},
		});
	}
}
