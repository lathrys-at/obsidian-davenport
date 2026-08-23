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
 *
 * The last block runs the transport instead of the settings. A request to
 * a calendar server carries the credential of the user, and the log of
 * that request must carry none of it.
 */

import { describe, expect, it } from 'vitest';
import { MockCalDavServer } from '../../harness/caldav-mock/server';
import { ControlledClock } from '../../harness/clock';
import { FakePluginData } from '../../harness/obsidian-fake';
import { runSimulation } from '../../harness/sweeps';
import { refusingTransport } from '../../harness/transport';
import { PluginDataStore } from '../../../src/adapters/plugin-data';
import { createSecretStore } from '../../../src/adapters/secret-store';
import { basicHeaders } from '../../../src/core/caldav/credentials';
import { CalDavSession } from '../../../src/core/caldav/session';
import type { Logger, SyncLogEntry } from '../../../src/core/ports/logger';
import { AccountService } from '../../../src/core/settings/service';
import { loggedTransport } from '../../../src/core/transport/logged';

const PASSWORD = 'planted-app-password-8f3c1d';
/** No case of this file makes a request, so every request is a fault. */
const NO_REQUESTS = 'this test makes no network request';

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

/** A double of the secret storage whose error carries the value it refused. */
class EchoingSecretStorage {
	setSecret(id: string, secret: string): never {
		throw new Error(`refused secret ${secret}`);
	}

	getSecret(): string | null {
		return null;
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
		transport: refusingTransport(NO_REQUESTS),
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

	it('SC-2: the words of a store that echo a password reach no log', async () => {
		const data = new FakePluginData();
		await runSimulation(
			{ name: 'store words in the log', pluginData: data },
			async (run) => {
				run.registerSecret({ label: 'app password', value: PASSWORD });
				const accounts = service(
					{ secretStorage: new EchoingSecretStorage() },
					data,
					run.logger,
				);
				await accounts.load();
				const outcome = await accounts.add(DRAFT, PASSWORD);
				expect(outcome.ok).toBe(false);
				expect(outcome.ok ? '' : (outcome.failure ?? '')).toContain(
					PASSWORD,
				);
			},
		);
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

/** The mock calendar server that the transport cases speak to. */
function calendarServer(): MockCalDavServer {
	return new MockCalDavServer({
		accounts: [{ name: 'ren', collections: [{ name: 'home' }] }],
	});
}

/**
 * Runs a session of the transport against the mock server, and gives the
 * log entries of that session back. The sweep of the run reads the same
 * entries.
 */
async function transportSession(
	mock: MockCalDavServer,
	name: string,
): Promise<readonly SyncLogEntry[]> {
	return runSimulation({ name, caldav: mock }, async (run) => {
		run.registerSecret({ label: 'app password', value: PASSWORD });
		const entries: SyncLogEntry[] = [];
		const session = new CalDavSession({
			transport: loggedTransport({
				transport: mock,
				logger: {
					log: (entry) => {
						entries.push(entry);
						run.logger.log(entry);
					},
				},
				clock: new ControlledClock(),
			}),
			serverUrl: mock.principalRootUrl,
			headers: basicHeaders('ren', PASSWORD),
		});
		await session.calendars(await session.discover());
		return entries;
	});
}

describe('SC-2 the credential material around the transport', () => {
	it('SC-2: a session of the transport puts no password in the log', async () => {
		const entries = await transportSession(
			calendarServer(),
			'caldav session',
		);
		expect(entries.length).toBeGreaterThan(0);
		expect(JSON.stringify(entries)).not.toContain(PASSWORD);
	});

	it('SC-2: no entry of that log carries the sign-in header', async () => {
		const mock = calendarServer();
		const entries = await transportSession(mock, 'caldav session header');
		const written = JSON.stringify(entries);
		const sent = basicHeaders('ren', PASSWORD).authorization ?? '';
		expect(sent).toContain('Basic ');
		expect(written).not.toContain(sent);
		expect(written).not.toContain('authorization');
	});

	it('SC-2: every request of that session carried the sign-in header', async () => {
		const mock = calendarServer();
		await transportSession(mock, 'caldav session requests');
		const sent = basicHeaders('ren', PASSWORD).authorization;
		expect(mock.log.entries.length).toBeGreaterThan(0);
		for (const entry of mock.log.entries) {
			expect(entry.headers.authorization).toBe(sent);
		}
	});
});
