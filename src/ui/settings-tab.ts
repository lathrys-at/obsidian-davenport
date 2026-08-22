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
 *
 * A section can read a store, and such a read ends after the draw that
 * started it. The screen counts its draws for that reason. A section asks
 * whether its own draw is the draw that stands now, and a section of an
 * older draw changes nothing. The count moves on each draw and when the
 * user leaves the screen.
 */

import { App, Plugin, PluginSettingTab } from 'obsidian';
import type { AccountService } from '../core/settings/service';
import { renderAccounts } from './accounts';

export class DavenportSettingTab extends PluginSettingTab {
	private readonly service: AccountService;
	private drawn = 0;

	constructor(app: App, plugin: Plugin, service: AccountService) {
		super(app, plugin);
		this.service = service;
	}

	override display(): void {
		this.drawn += 1;
		const draw = this.drawn;
		this.containerEl.empty();
		renderAccounts(this.containerEl, {
			app: this.app,
			service: this.service,
			redraw: () => {
				this.display();
			},
			live: () => this.drawn === draw,
		});
	}

	override hide(): void {
		this.drawn += 1;
		super.hide();
	}
}
