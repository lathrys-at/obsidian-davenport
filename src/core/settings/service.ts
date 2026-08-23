/**
 * The account operations of the settings screen.
 *
 * The screen shows a list of accounts. A user adds an account, changes an
 * account, or removes an account. Each of those operations touches two
 * stores: the settings hold the account, and the secret store holds the
 * credential of that account. This module runs both steps in one order,
 * and it states what happened.
 *
 * The order is the same for every operation: the credential first, and the
 * settings after it. A step that fails stops the operation, and the
 * operation then puts the credential back as it stood. An add removes the
 * credential that it wrote. A change writes the credential that stood
 * there before it. A removal writes the credential back. The user reads a
 * failure and the two stores hold what they held.
 *
 * One step of that repair can fail too. The operation then states what
 * stands in the two stores now, in the words that the user reads, and the
 * log holds the same fact.
 *
 * The credential passes through this module and stops here. It goes into
 * the secret store, and it goes nowhere else. The log holds only words
 * that this plugin wrote: a refusal writes the field and the kind of the
 * fault, and a failure writes the name of the step that failed. The words
 * of a store and the values that the user typed reach the screen of that
 * user alone, and they reach no settings value and no log entry.
 */

import type { ConnectionResult } from '../caldav/connection';
import { checkConnection } from '../caldav/connection';
import type { Clock } from '../ports/clock';
import type { Logger, LogOutcome } from '../ports/logger';
import type { SecretStore, SecretTier } from '../ports/secret-store';
import type { SettingsStore } from '../ports/settings-store';
import type { HttpTransport } from '../ports/transport';
import { fitsBasicAuth } from '../model/credential';
import type { AccountConfig, SyncedSettings } from '../model/settings';
import type { AccountDraft } from './accounts';
import {
	addAccount,
	checkAccount,
	findAccount,
	mintCredentialRef,
	proposeAccountId,
	removeAccount,
	replaceAccount,
	trimDraft,
} from './accounts';
import { decodeCredential, encodeCredential } from './credential';
import type { FieldFault, SettingsProblem } from './problems';
import { nameFieldFault } from './problems';
import {
	DEFAULT_SETTINGS,
	NO_HELD_SECTIONS,
	type SettingsReading,
} from './read';

/** What one account operation gives back to the settings screen. */
export type AccountOutcome =
	| { readonly ok: true; readonly account: AccountConfig }
	| {
			readonly ok: false;
			/** The faults of the values that the user gave. */
			readonly faults: readonly FieldFault[];
			/** The words of a failure of a store, or null. */
			readonly failure: string | null;
	  };

export interface AccountServiceParts {
	readonly settings: SettingsStore;
	readonly secrets: SecretStore;
	readonly logger: Logger;
	readonly clock: Clock;
	/** The transport that the connection test of an account uses. */
	readonly transport: HttpTransport;
}

export class AccountService {
	private readonly parts: AccountServiceParts;
	private reading: SettingsReading = {
		settings: DEFAULT_SETTINGS,
		problems: [],
		held: NO_HELD_SECTIONS,
	};

	constructor(parts: AccountServiceParts) {
		this.parts = parts;
	}

	get accounts(): readonly AccountConfig[] {
		return this.reading.settings.accounts;
	}

	/** The problems that the last read of the settings found. */
	get problems(): readonly SettingsProblem[] {
		return this.reading.problems;
	}

	/** The storage that holds the credentials. */
	get tier(): SecretTier {
		return this.parts.secrets.tier;
	}

	/** Reads the settings. A later read replaces what this read gave. */
	async load(): Promise<void> {
		this.reading = await this.parts.settings.read();
	}

	/**
	 * The ids of the accounts that hold a credential in the secret store.
	 * The call reads the store one time for each account. Where a read
	 * fails, the id stays out of the set and the log holds the failure.
	 */
	async accountsWithCredential(): Promise<ReadonlySet<string>> {
		const held = new Set<string>();
		for (const account of this.accounts) {
			try {
				const value = await this.parts.secrets.get(
					account.credentialRef,
				);
				if (value !== null) {
					held.add(account.id);
				}
			} catch {
				this.record('read app password', account.id, 'failed');
			}
		}
		return held;
	}

	/**
	 * Adds an account that signs in with an app password. The plugin
	 * builds the id and the credential reference of the account.
	 */
	async add(input: AccountDraft, password: string): Promise<AccountOutcome> {
		const draft = trimDraft(input);
		const taken = this.accounts.map((account) => account.id);
		const id = proposeAccountId(draft.serverUrl, taken);
		const account: AccountConfig = {
			id,
			serverUrl: draft.serverUrl,
			username: draft.username,
			credentialType: 'app-password',
			credentialRef: mintCredentialRef(id),
		};
		const faults = [
			...checkAccount(account, taken),
			...passwordFaults(password),
		];
		if (faults.length > 0) {
			return this.refuse('add account', id, faults);
		}
		try {
			await this.parts.secrets.set(
				account.credentialRef,
				encodeCredential({ type: 'app-password', password }),
			);
		} catch (error) {
			return this.fail('add account', id, error, PASSWORD_WRITE);
		}
		try {
			await this.write(addAccount(this.reading.settings, account));
		} catch (error) {
			const back = await this.restore(id, account.credentialRef, null);
			return this.fail(
				'add account',
				id,
				error,
				SETTINGS_WRITE,
				back ? undefined : PASSWORD_STANDS,
			);
		}
		this.record('add account', id, 'success');
		return { ok: true, account };
	}

	/**
	 * Changes the server address and the username of an account. An empty
	 * password keeps the credential that the store holds.
	 */
	async change(
		id: string,
		input: AccountDraft,
		password: string,
	): Promise<AccountOutcome> {
		const held = findAccount(this.reading.settings, id);
		if (held === null) {
			return this.missing('change account', id);
		}
		const draft = trimDraft(input);
		const account: AccountConfig = {
			...held,
			serverUrl: draft.serverUrl,
			username: draft.username,
		};
		const others = this.accounts
			.filter((other) => other.id !== id)
			.map((other) => other.id);
		const faults = [
			...checkAccount(account, others),
			...(password === '' ? [] : passwordFaults(password)),
		];
		if (faults.length > 0) {
			return this.refuse('change account', id, faults);
		}
		let previous: string | null = null;
		if (password !== '') {
			try {
				previous = await this.parts.secrets.get(account.credentialRef);
			} catch (error) {
				return this.fail('change account', id, error, PASSWORD_READ);
			}
			try {
				await this.parts.secrets.set(
					account.credentialRef,
					encodeCredential({ type: 'app-password', password }),
				);
			} catch (error) {
				return this.fail('change account', id, error, PASSWORD_WRITE);
			}
		}
		try {
			await this.write(replaceAccount(this.reading.settings, account));
		} catch (error) {
			if (password === '') {
				return this.fail('change account', id, error, SETTINGS_WRITE);
			}
			const back = await this.restore(
				id,
				account.credentialRef,
				previous,
			);
			return this.fail(
				'change account',
				id,
				error,
				SETTINGS_WRITE,
				back ? undefined : NEW_PASSWORD_STANDS,
			);
		}
		this.record('change account', id, 'success');
		return { ok: true, account };
	}

	/** Removes an account and the credential of that account. */
	async remove(id: string): Promise<AccountOutcome> {
		const account = findAccount(this.reading.settings, id);
		if (account === null) {
			return this.missing('remove account', id);
		}
		let previous: string | null = null;
		try {
			previous = await this.parts.secrets.get(account.credentialRef);
		} catch (error) {
			return this.fail('remove account', id, error, PASSWORD_READ);
		}
		try {
			await this.parts.secrets.remove(account.credentialRef);
		} catch (error) {
			return this.fail('remove account', id, error, PASSWORD_REMOVAL);
		}
		try {
			await this.write(removeAccount(this.reading.settings, id));
		} catch (error) {
			const back = await this.restore(
				id,
				account.credentialRef,
				previous,
			);
			return this.fail(
				'remove account',
				id,
				error,
				SETTINGS_WRITE,
				back ? undefined : PASSWORD_GONE,
			);
		}
		this.record('remove account', id, 'success');
		return { ok: true, account };
	}

	/**
	 * Runs the connection test of one account. The test reads the
	 * credential of the account and runs the discovery of the principal
	 * against the server. The result states what happened, in one word of
	 * this plugin. The log holds that word, and it holds no value of the
	 * user and no word of the server.
	 */
	async testConnection(id: string): Promise<ConnectionResult> {
		const account = findAccount(this.reading.settings, id);
		if (account === null) {
			return this.stateConnection(id, 'no-account');
		}
		let held: string | null;
		try {
			held = await this.parts.secrets.get(account.credentialRef);
		} catch {
			return this.stateConnection(id, 'credential-unreadable');
		}
		if (held === null) {
			return this.stateConnection(id, 'no-credential');
		}
		const credential = decodeCredential(account.credentialType, held);
		if (credential === null) {
			return this.stateConnection(id, 'credential-unreadable');
		}
		const result = await checkConnection({
			transport: this.parts.transport,
			serverUrl: account.serverUrl,
			username: account.username,
			credential,
		});
		return this.stateConnection(id, result);
	}

	/** Writes one result of a connection test to the log, and gives it back. */
	private stateConnection(
		id: string,
		result: ConnectionResult,
	): ConnectionResult {
		this.record('test connection', id, connectionOutcome(result), result);
		return result;
	}

	/**
	 * Writes the settings, and then reads the settings back. The read
	 * gives the problems of the file as the file stands after the write,
	 * so the screen states no problem of an entry that the write took
	 * away. A read that fails leaves the settings of the write in place
	 * with the problems of the read before it.
	 */
	private async write(settings: SyncedSettings): Promise<void> {
		await this.parts.settings.write(settings);
		try {
			this.reading = await this.parts.settings.read();
		} catch {
			this.record('read settings', 'settings', 'failed');
			this.reading = {
				settings,
				problems: this.reading.problems,
				held: this.reading.held,
			};
		}
	}

	/**
	 * Puts a credential back as it stood before the operation wrote it.
	 * Gives false back where that step fails, and the log then holds the
	 * failure. The caller states the condition of the stores to the user.
	 */
	private async restore(
		id: string,
		ref: string,
		previous: string | null,
	): Promise<boolean> {
		try {
			if (previous === null) {
				await this.parts.secrets.remove(ref);
			} else {
				await this.parts.secrets.set(ref, previous);
			}
			return true;
		} catch {
			this.record('restore app password', id, 'failed');
			return false;
		}
	}

	/**
	 * States that the settings hold no account of that id. The log takes
	 * a word of the plugin and no value of the caller.
	 */
	private missing(action: string, id: string): AccountOutcome {
		this.record(action, id, 'failed', 'no-such-account');
		return { ok: false, faults: [], failure: NO_ACCOUNT };
	}

	private refuse(
		action: string,
		id: string,
		faults: readonly FieldFault[],
	): AccountOutcome {
		this.record(
			action,
			id,
			'refused',
			faults.map(nameFieldFault).join(' '),
		);
		return { ok: false, faults, failure: null };
	}

	/**
	 * States a failure of one step. The screen takes the words of the
	 * store, with the fallback of the step where the store states none,
	 * and the note where a repair failed. The log takes the name of the
	 * step alone, because the words of a store can carry any value.
	 */
	private fail(
		action: string,
		id: string,
		error: unknown,
		step: FailedStep,
		note?: string,
	): AccountOutcome {
		const reason = words(error, step.fallback);
		const failure = note === undefined ? reason : `${reason} ${note}`;
		this.record(action, id, 'failed', step.name);
		return { ok: false, faults: [], failure };
	}

	private record(
		action: string,
		item: string,
		outcome: LogOutcome,
		reason?: string,
	): void {
		this.parts.logger.log({
			time: this.parts.clock.now(),
			action,
			item,
			outcome,
			...(reason === undefined ? {} : { reason }),
		});
	}
}

const NO_ACCOUNT = 'Davenport holds no account of that name.';

/**
 * A step that can fail. The name goes into the log. The fallback goes to
 * the screen where the store states no reason of its own.
 */
interface FailedStep {
	readonly name: string;
	readonly fallback: string;
}

const SETTINGS_WRITE: FailedStep = {
	name: 'settings write',
	fallback:
		'Davenport could not save the settings, and the reason is not known.',
};
const PASSWORD_WRITE: FailedStep = {
	name: 'app password write',
	fallback:
		'Davenport could not save the app password, and the reason is not known.',
};
const PASSWORD_REMOVAL: FailedStep = {
	name: 'app password removal',
	fallback:
		'Davenport could not remove the app password, and the reason is not known.',
};
const PASSWORD_READ: FailedStep = {
	name: 'app password read',
	fallback:
		'Davenport could not read the app password, and the reason is not known.',
};

/** The words that state what the stores hold after a repair that failed. */
const PASSWORD_STANDS =
	'Davenport saved the app password and could not remove it again. That password stands in the storage, and no account holds it.';
const NEW_PASSWORD_STANDS =
	'Davenport could not put the old app password back. This account now holds the new app password.';
const PASSWORD_GONE =
	'Davenport removed the app password of this account and could not put it back. Enter the app password again.';

/** The faults of the password that the user gave. */
function passwordFaults(password: string): readonly FieldFault[] {
	if (password === '') {
		return [{ kind: 'empty', field: 'password' }];
	}
	return fitsBasicAuth(password)
		? []
		: [{ kind: 'sign-in-alphabet', field: 'password' }];
}

/** The outcome that one result of a connection test writes to the log. */
function connectionOutcome(result: ConnectionResult): LogOutcome {
	if (result === 'signed-in') {
		return 'success';
	}
	return result === 'refused' ? 'refused' : 'failed';
}

/**
 * The words of a failure. A store can state a reason, and the words of
 * that reason go to the user. Where the store states no reason, the words
 * of the caller go to the user instead. The value that a store throws can
 * refuse to become text, so the reading of that value stands in a guard.
 */
function words(error: unknown, fallback: string): string {
	try {
		const text =
			error instanceof Error && typeof error.message === 'string'
				? error.message
				: String(error);
		return text.trim() === '' ? fallback : text;
	} catch {
		return fallback;
	}
}
