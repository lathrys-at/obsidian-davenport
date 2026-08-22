/**
 * The words that the settings screen shows.
 *
 * The text stands here, apart from the code that builds the screen. Two
 * results follow. First, a test reads the text and asks what the screen
 * states, without a browser. Second, a person who writes the text reads it
 * in one place.
 *
 * The text states where each app password goes. A user gives a password to
 * a program, and that user must know which storage holds it. Where the
 * data file holds the passwords, the screen states that condition and
 * keeps it in view.
 */

import type { SecretTier } from '../core/ports/secret-store';

export const ACCOUNTS_HEADING = 'Accounts';

/**
 * The first words of the section. They ask the user for an app password,
 * and they state why. An app password gives one program access to one
 * account, and the user cancels that one password if it leaks. The
 * password of the account of the user gives access to everything.
 */
export const ACCOUNTS_INTRO =
	'Davenport signs in to your calendar server with a username and a password. Use an app password, and do not use the password of your account. An app password gives one program access to one account. If the password leaks, you cancel that one password and you keep your account. Your calendar server states how to make an app password.';

/** What the screen states where the secret storage holds the passwords. */
export const SECRET_STORAGE_NOTE =
	'Davenport keeps your app passwords in the secret storage of Obsidian.';

/**
 * What the screen states where the data file holds the passwords. The
 * screen shows this text at all times, and not one time.
 */
export const DATA_FILE_WARNING =
	'This version of Obsidian gives the plugin no secret storage. Davenport keeps your app passwords in the data file of the plugin, as plain text. Every program that reads your vault reads them. Update Obsidian to version 1.11.4 or later, and then enter each app password again. Davenport then puts the password into the secret storage of Obsidian, and it takes the password out of the data file.';

export const NO_ACCOUNTS = 'You have no account. Select "Add account".';

export const ADD_ACCOUNT = 'Add account';
export const EDIT_ACCOUNT = 'Edit account';
export const REMOVE_ACCOUNT = 'Remove account';
export const EDIT = 'Edit';
export const REMOVE = 'Remove';
export const SAVE = 'Save';
export const CANCEL = 'Cancel';

export const SERVER_URL = 'Server URL';
export const SERVER_URL_NOTE =
	'The address of the CalDAV server. Your calendar server states this address.';
export const SERVER_URL_EXAMPLE = 'https://caldav.example.com/';

export const USERNAME = 'Username';
export const USERNAME_NOTE = 'The username of your account with that server.';

export const APP_PASSWORD = 'App password';

/** What the screen states where the account holds no password. */
export const NO_CREDENTIAL = 'No app password. Select "Edit" to enter one.';

/** What the screen states above the fields of an account that stands. */
export const KEEP_PASSWORD =
	'Leave this field empty to keep the password that Davenport holds.';

export const PROBLEMS_HEADING = 'Entries that Davenport did not read';
export const PROBLEMS_NOTE =
	'Davenport did not read these entries, and a write of the settings does not keep them. Correct the data file of the plugin, or add the entries again.';

/** The words of the question that stands before a removal. */
export function removeQuestion(username: string, serverUrl: string): string {
	return `Davenport removes the account "${username}" at ${serverUrl}. Davenport also removes the app password of that account. This action changes nothing on the server.`;
}

/**
 * The warning about the storage of the passwords, or null where the
 * secret storage of Obsidian holds them.
 */
export function tierWarning(tier: SecretTier): string | null {
	return tier === 'data-json' ? DATA_FILE_WARNING : null;
}

/** What the screen states beside the field that takes a password. */
export function tierNote(tier: SecretTier): string {
	return tier === 'data-json' ? DATA_FILE_WARNING : SECRET_STORAGE_NOTE;
}
