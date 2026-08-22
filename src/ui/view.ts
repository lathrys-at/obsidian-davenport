/**
 * What the accounts section shows, as data.
 *
 * The section is a list of texts and a list of rows. This module builds
 * that list, and the module that draws the screen turns it into elements.
 * A test therefore reads what the screen states without a browser.
 *
 * The warning about the data file stands here. The section shows that
 * warning at all times while the data file holds the app passwords, and
 * this module is where that rule lives.
 */

import type { AccountConfig } from '../core/model/settings';
import type { SecretTier } from '../core/ports/secret-store';
import type { SettingsProblem } from '../core/settings/problems';
import { describeSettingsProblem } from '../core/settings/problems';
import {
	ACCOUNTS_HEADING,
	ACCOUNTS_INTRO,
	ADD_ACCOUNT,
	NO_ACCOUNTS,
	PROBLEMS_HEADING,
	PROBLEMS_NOTE,
	SECRET_STORAGE_NOTE,
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
			note: account.serverUrl,
		})),
		empty: accounts.length === 0 ? NO_ACCOUNTS : null,
		addButton: ADD_ACCOUNT,
		problemsHeading: problems.length === 0 ? null : PROBLEMS_HEADING,
		problemsNote: problems.length === 0 ? null : PROBLEMS_NOTE,
		problems: problems.map(describeSettingsProblem),
	};
}
