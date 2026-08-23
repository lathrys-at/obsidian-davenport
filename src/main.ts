import { Plugin, requestUrl } from 'obsidian';
import { systemClock } from './adapters/clock';
import { createHttpTransport } from './adapters/http-transport';
import { MemoryLog } from './adapters/log';
import { PluginDataStore } from './adapters/plugin-data';
import { createSecretStore } from './adapters/secret-store';
import { AccountService } from './core/settings/service';
import { loggedTransport } from './core/transport/logged';
import { DavenportSettingTab } from './ui/settings-tab';

/**
 * Davenport synchronizes calendar events and tasks between the vault and
 * a CalDAV server. It sends changes in both directions: from the vault
 * to the server, and from the server to the vault.
 *
 * This file is the entry point of the plugin. It holds the lifecycle of
 * the plugin, and it registers the parts of the plugin with Obsidian.
 * It holds no other code.
 *
 * The behavior of the plugin lives in core/. The code in core/ reaches
 * the platform only through the interfaces in core/ports/. The code in
 * adapters/ implements those interfaces over the platform APIs.
 */
export default class DavenportPlugin extends Plugin {
	override async onload(): Promise<void> {
		const data = new PluginDataStore(this);
		const logger = new MemoryLog();
		const clock = systemClock();
		const service = new AccountService({
			settings: data,
			secrets: createSecretStore(this.app, data),
			logger,
			clock,
			transport: loggedTransport({
				transport: createHttpTransport(requestUrl),
				logger,
				clock,
			}),
		});
		await service.load();
		this.addSettingTab(new DavenportSettingTab(this.app, this, service));
	}
}
