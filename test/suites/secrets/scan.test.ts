/**
 * The scan for credential material around the settings.
 *
 * A user gives Davenport an app password. That password must reach the
 * storage of the credentials and no other place. These cases plant a
 * password, run the path that writes the settings, and then read
 * everything that the run left behind.
 *
 * The sweep of the harness does the reading. The run declares the password
 * as a sensitive value, and the sweep walks every surface of the evidence
 * and looks for that value. The surfaces hold the data file of the plugin
 * and the sync log, so a password in either one fails the run.
 */

import { describe, expect, it } from 'vitest';
import { ControlledClock } from '../../harness/clock';
import { FakePluginData } from '../../harness/obsidian-fake';
import { runSimulation } from '../../harness/sweeps';
import { PluginDataStore } from '../../../src/adapters/plugin-data';
import { createSecretStore } from '../../../src/adapters/secret-store';
import type { Logger } from '../../../src/core/ports/logger';
import { AccountService } from '../../../src/core/settings/service';

const PASSWORD = 'planted-app-password-8f3c1d';
const DRAFT = {
	serverUrl: 'https://caldav.example.com/dav/',
	username: 'ren',
};

/** A double of the secret storage of Obsidian. */
class FakeSecretStorage {
	private readonly held = new Map<string, string>();

	setSecret(id: string, secret: string): void {
		this.held.set(id, secret);
	}

	getSecret(id: string): string | null {
		return this.held.get(id) ?? null;
	}
}

/** Runs the write path of the settings with the app that the case gives. */
function service(
	app: { readonly secretStorage?: unknown },
	data: FakePluginData,
	logger: Logger,
): AccountService {
	const settings = new PluginDataStore(data);
	return new AccountService({
		settings,
		secrets: createSecretStore(app, settings),
		logger,
		clock: new ControlledClock(),
	});
}

describe('SC-2 the credential material around the settings', () => {
	it('SC-2: the write path puts no password in the data file and no password in the log', async () => {
		const data = new FakePluginData();
		await runSimulation(
			{ name: 'settings write', pluginData: data },
			async (run) => {
				run.registerSecret({ label: 'app password', value: PASSWORD });
				const accounts = service(
					{ secretStorage: new FakeSecretStorage() },
					data,
					run.logger,
				);
				await accounts.load();
				const outcome = await accounts.add(DRAFT, PASSWORD);
				expect(outcome.ok).toBe(true);
				await accounts.change(
					'caldav-example-com',
					DRAFT,
					`${PASSWORD}-again`,
				);
				await accounts.remove('caldav-example-com');
			},
		);
	});

	it('SC-2: a password that a user types into the field of the server address reaches no log', async () => {
		const data = new FakePluginData();
		await runSimulation(
			{ name: 'password in the wrong field', pluginData: data },
			async (run) => {
				run.registerSecret({ label: 'app password', value: PASSWORD });
				const accounts = service(
					{ secretStorage: new FakeSecretStorage() },
					data,
					run.logger,
				);
				await accounts.load();
				const outcome = await accounts.add(
					{ serverUrl: PASSWORD, username: 'ren' },
					PASSWORD,
				);
				expect(outcome.ok).toBe(false);
			},
		);
	});

	it('SC-2: a password inside a server address reaches no settings and no log', async () => {
		const data = new FakePluginData();
		await runSimulation(
			{ name: 'password inside the address', pluginData: data },
			async (run) => {
				run.registerSecret({ label: 'app password', value: PASSWORD });
				const accounts = service(
					{ secretStorage: new FakeSecretStorage() },
					data,
					run.logger,
				);
				await accounts.load();
				const outcome = await accounts.add(
					{
						serverUrl: `https://ren:${PASSWORD}@caldav.example.com/`,
						username: 'ren',
					},
					PASSWORD,
				);
				expect(outcome.ok).toBe(false);
			},
		);
	});

	it('SC-2: the settings hold no password where the data file holds the credentials', async () => {
		const data = new FakePluginData();
		const entries: string[] = [];
		const accounts = service({}, data, {
			log: (entry) => {
				entries.push(JSON.stringify(entry));
			},
		});
		await accounts.load();
		expect((await accounts.add(DRAFT, PASSWORD)).ok).toBe(true);
		const document = data.value as Record<string, unknown>;
		expect(JSON.stringify(document.settings)).not.toContain(PASSWORD);
		expect(entries.join('')).not.toContain(PASSWORD);
		expect(document.secretFallback).toEqual({
			'caldav-example-com': PASSWORD,
		});
	});

	it('SC-2: the scan reads the data file, so a password there fails the run', async () => {
		const data = new FakePluginData();
		await expect(
			runSimulation(
				{ name: 'no secret storage', pluginData: data },
				async (run) => {
					run.registerSecret({
						label: 'app password',
						value: PASSWORD,
					});
					const accounts = service({}, data, run.logger);
					await accounts.load();
					await accounts.add(DRAFT, PASSWORD);
				},
			),
		).rejects.toThrow(/secrets-scan/);
	});
});
