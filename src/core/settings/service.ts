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
 * settings after it. A step that fails stops the operation. An add that
 * fails at the second step removes the credential that the first step
 * wrote, so no credential stays behind with no account.
 *
 * The credential passes through this module and stops here. It goes into
 * the secret store, and it goes nowhere else. It reaches no settings
 * value, no log entry, and no message.
 */

import type { Clock } from '../ports/clock';
import type { Logger, LogOutcome } from '../ports/logger';
import type { SecretStore, SecretTier } from '../ports/secret-store';
import type { SettingsStore } from '../ports/settings-store';
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
} from './accounts';
import { encodeCredential } from './credential';
import type { FieldFault, SettingsProblem } from './problems';
import { describeFieldFault } from './problems';
import { DEFAULT_SETTINGS, type SettingsReading } from './read';

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
}

export class AccountService {
	private readonly parts: AccountServiceParts;
	private reading: SettingsReading = {
		settings: DEFAULT_SETTINGS,
		problems: [],
	};

	constructor(parts: AccountServiceParts) {
		this.parts = parts;
	}

	get settings(): SyncedSettings {
		return this.reading.settings;
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

	/** True where the secret store holds a credential for the account. */
	async hasCredential(id: string): Promise<boolean> {
		const account = findAccount(this.reading.settings, id);
		if (account === null) {
			return false;
		}
		return (await this.parts.secrets.get(account.credentialRef)) !== null;
	}

	/**
	 * Adds an account that signs in with an app password. The plugin
	 * builds the id and the credential reference of the account.
	 */
	async add(draft: AccountDraft, password: string): Promise<AccountOutcome> {
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
			return this.fail('add account', id, error);
		}
		try {
			await this.write(addAccount(this.reading.settings, account));
		} catch (error) {
			await this.discard(account.credentialRef);
			return this.fail('add account', id, error);
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
		draft: AccountDraft,
		password: string,
	): Promise<AccountOutcome> {
		const held = findAccount(this.reading.settings, id);
		if (held === null) {
			return this.fail('change account', id, new Error(NO_ACCOUNT));
		}
		const account: AccountConfig = {
			...held,
			serverUrl: draft.serverUrl,
			username: draft.username,
		};
		const others = this.accounts
			.filter((other) => other.id !== id)
			.map((other) => other.id);
		const faults = checkAccount(account, others);
		if (faults.length > 0) {
			return this.refuse('change account', id, faults);
		}
		if (password !== '') {
			try {
				await this.parts.secrets.set(
					account.credentialRef,
					encodeCredential({ type: 'app-password', password }),
				);
			} catch (error) {
				return this.fail('change account', id, error);
			}
		}
		try {
			await this.write(replaceAccount(this.reading.settings, account));
		} catch (error) {
			return this.fail('change account', id, error);
		}
		this.record('change account', id, 'success');
		return { ok: true, account };
	}

	/** Removes an account and the credential of that account. */
	async remove(id: string): Promise<AccountOutcome> {
		const account = findAccount(this.reading.settings, id);
		if (account === null) {
			return this.fail('remove account', id, new Error(NO_ACCOUNT));
		}
		try {
			await this.parts.secrets.remove(account.credentialRef);
		} catch (error) {
			return this.fail('remove account', id, error);
		}
		try {
			await this.write(removeAccount(this.reading.settings, id));
		} catch (error) {
			return this.fail('remove account', id, error);
		}
		this.record('remove account', id, 'success');
		return { ok: true, account };
	}

	/** Writes the settings and keeps what the write left. */
	private async write(settings: SyncedSettings): Promise<void> {
		await this.parts.settings.write(settings);
		this.reading = { settings, problems: this.reading.problems };
	}

	/**
	 * Removes a credential that an operation wrote and then could not
	 * use. A failure of this step reaches the log and stops nothing: the
	 * operation already failed, and the caller reads that failure.
	 */
	private async discard(ref: string): Promise<void> {
		try {
			await this.parts.secrets.remove(ref);
		} catch (error) {
			this.record('remove credential', ref, 'failed', words(error));
		}
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
			faults.map(describeFieldFault).join(' '),
		);
		return { ok: false, faults, failure: null };
	}

	private fail(action: string, id: string, error: unknown): AccountOutcome {
		const failure = words(error);
		this.record(action, id, 'failed', failure);
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

const NO_ACCOUNT = 'The settings hold no account with that id.';

/** The faults of the password that the user gave. */
function passwordFaults(password: string): readonly FieldFault[] {
	return password === '' ? [{ kind: 'empty', field: 'password' }] : [];
}

/**
 * The words of a failure. The value that a store throws can refuse to
 * become text, so the reading of that value stands inside a guard.
 */
function words(error: unknown): string {
	try {
		const text =
			error instanceof Error && typeof error.message === 'string'
				? error.message
				: String(error);
		return text.trim() === '' ? NO_REASON : text;
	} catch {
		return NO_REASON;
	}
}

const NO_REASON = 'The store refused the write and stated no reason.';
