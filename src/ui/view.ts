/**
 * What the accounts section shows, as data.
 *
 * The section is a list of texts and a list of rows. This module builds
 * that list, and the module that draws the screen turns it into elements.
 * A test therefore reads what the screen states without a browser.
 *
 * Two rules of the screen stand here as well. The first is the warning
 * about the data file: the section shows that warning at all times while
 * the data file holds the app passwords. The second is the words of an
 * outcome: which words reach the window that the user works in, and which
 * words reach the notice of the app.
 */

import type { AccountConfig } from '../core/model/settings';
import type { SecretTier } from '../core/ports/secret-store';
import type { SettingsProblem } from '../core/settings/problems';
import {
	describeFieldFault,
	describeSettingsProblem,
} from '../core/settings/problems';
import type { AccountOutcome } from '../core/settings/service';
import {
	ACCOUNTS_HEADING,
	ACCOUNTS_INTRO,
	ADD_ACCOUNT,
	KEEP_PASSWORD,
	NO_ACCOUNTS,
	NO_CREDENTIAL,
	PROBLEMS_HEADING,
	PROBLEMS_NOTE,
	SECRET_STORAGE_NOTE,
	tierNote,
	tierWarning,
} from './copy';

/** One row of the list of accounts. */
export interface AccountRowView {
	readonly account: AccountConfig;
	readonly name: string;
	readonly note: string;
}

/** One paragraph of the section. */
export interface NoteView {
	readonly text: string;
	/** True where the screen shows the text as a warning. */
	readonly warning: boolean;
}

export interface AccountsView {
	readonly heading: string;
	readonly intro: string;
	/** What the section states about the storage of the passwords. */
	readonly storage: NoteView;
	readonly rows: readonly AccountRowView[];
	/** The words for a list with no account, or null. */
	readonly empty: string | null;
	readonly addButton: string;
	/** The heading of the refused entries, or null where there are none. */
	readonly problemsHeading: string | null;
	readonly problemsNote: string | null;
	readonly problems: readonly string[];
}

/** Builds the view of the accounts section. */
export function accountsView(
	tier: SecretTier,
	accounts: readonly AccountConfig[],
	problems: readonly SettingsProblem[],
): AccountsView {
	const warning = tierWarning(tier);
	return {
		heading: ACCOUNTS_HEADING,
		intro: ACCOUNTS_INTRO,
		storage: {
			text: warning ?? SECRET_STORAGE_NOTE,
			warning: warning !== null,
		},
		rows: accounts.map((account) => ({
			account,
			name: account.username,
			note: rowNote(account.serverUrl, true),
		})),
		empty: accounts.length === 0 ? NO_ACCOUNTS : null,
		addButton: ADD_ACCOUNT,
		problemsHeading: problems.length === 0 ? null : PROBLEMS_HEADING,
		problemsNote: problems.length === 0 ? null : PROBLEMS_NOTE,
		problems: problems.map(describeSettingsProblem),
	};
}

/**
 * The words under the name of one account. The row states the address of
 * the server. Where the secret store holds no credential for the account,
 * the row also states that condition and the way to the field that takes
 * one.
 */
export function rowNote(serverUrl: string, hasCredential: boolean): string {
	return hasCredential ? serverUrl : `${serverUrl} ${NO_CREDENTIAL}`;
}

/**
 * The words beside the field that takes a password. The text states the
 * storage that holds the passwords, in one sentence. The window that
 * changes an account states first that an empty field keeps the password
 * that Davenport already holds.
 */
export function passwordNote(tier: SecretTier, keepsPassword: boolean): string {
	return keepsPassword
		? `${KEEP_PASSWORD} ${tierNote(tier)}`
		: tierNote(tier);
}

/** What the window that took the values of the user shows after a write. */
export interface OutcomeView {
	/** True where the window closes, because the write succeeded. */
	readonly done: boolean;
	/** The words of each fault and of the failure, for that window. */
	readonly messages: readonly string[];
	/** The words that go to a notice of the app, or null. */
	readonly notice: string | null;
	/** True where the screen draws the accounts again. */
	readonly redraw: boolean;
}

/**
 * What the screen does with one outcome.
 *
 * A write that succeeded closes the window and draws the section again.
 * A write that the plugin refused states each fault in the window, where
 * the user reads the fault beside the field that holds it. A failure of a
 * store reaches the window as well, and it reaches a notice for an
 * operation that no window started.
 */
export function outcomeView(outcome: AccountOutcome): OutcomeView {
	if (outcome.ok) {
		return { done: true, messages: [], notice: null, redraw: true };
	}
	return {
		done: false,
		messages: [
			...outcome.faults.map(describeFieldFault),
			...(outcome.failure === null ? [] : [outcome.failure]),
		],
		notice: outcome.failure,
		redraw: false,
	};
}
