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
	'Davenport signs in to your calendar server with a username and a password. Use an app password. Do not use the password of your account. An app password gives one program access to one account. If the app password leaks, you cancel that app password and you keep your account. Your calendar server states how to make an app password.';

/** What the section states where the secret storage holds the passwords. */
export const SECRET_STORAGE_NOTE =
	'Davenport keeps your app passwords in the secret storage of Obsidian.';

/**
 * What the section states where the data file holds the passwords. The
 * section shows this text at all times, and not one time.
 *
 * The first sentence states what Davenport found, and it states no
 * version. Davenport asks this version of Obsidian for a secret storage
 * and reads the answer. A version number would be a second fact that
 * Davenport did not read, and a user on a new version of Obsidian whose
 * app gives no storage would then read a sentence that is false. The
 * remedy names the version, because the remedy is for the user whose
 * version of Obsidian is older than that version.
 */
export const DATA_FILE_WARNING =
	'Davenport found no secret storage in this version of Obsidian. Davenport keeps your app passwords in the data file of the plugin, as plain text. Every program that reads your vault reads them. If your version of Obsidian is older than 1.11.4, update Obsidian. Then enter each app password again. Davenport puts each password into the secret storage of Obsidian, and it takes each password out of the data file.';

/** What the screen states beside the field that takes a password. */
export const SECRET_STORAGE_FIELD_NOTE =
	'Davenport keeps this password in the secret storage of Obsidian.';
export const DATA_FILE_FIELD_NOTE =
	'Davenport keeps this password in the data file of the plugin, as plain text.';

export const NO_ACCOUNTS = 'You have no account. Select "Add account".';

export const ADD_ACCOUNT = 'Add account';
export const EDIT_ACCOUNT = 'Edit account';
export const REMOVE_ACCOUNT = 'Remove account';
export const EDIT = 'Edit';
export const REMOVE = 'Remove';
export const SAVE = 'Save';
export const CANCEL = 'Cancel';
export const TEST_CONNECTION = 'Test connection';

/**
 * What the screen states about one connection test.
 *
 * The test speaks to the calendar server of the account. The three
 * results of the server come first. The other results state that the test
 * did not start, because Davenport holds no credential that it can send.
 */
export const CONNECTION_RUNS = 'Davenport tests the connection.';
export const CONNECTION_SIGNED_IN =
	'Davenport reached the server. The server accepted your username and your app password.';
export const CONNECTION_REFUSED =
	'Davenport reached the server. The server did not accept your username or your app password. Check the username. Then select "Edit". Then enter the app password again.';
export const CONNECTION_NOT_REACHED =
	'Davenport reached no calendar server at that address. Check the server URL. Then check the network of this device.';
export const CONNECTION_UNREADABLE =
	'Davenport cannot read the app password of this account. Select "Edit". Then enter the app password again.';
export const CONNECTION_ALPHABET =
	'The username or the app password holds a character that Davenport cannot send to a calendar server. Select "Edit". Then give a username and an app password of letters, digits, and the marks of a keyboard.';
export const CONNECTION_NO_TOKEN_FLOW =
	'This account signs in with OAuth. This version of Davenport does not sign in with OAuth.';
export const CONNECTION_NO_ACCOUNT = 'Davenport holds no account of that name.';

export const SERVER_URL = 'Server URL';
export const SERVER_URL_NOTE =
	'The address of the CalDAV server. Your calendar server states this address.';
export const SERVER_URL_EXAMPLE = 'https://caldav.example.com/';

export const USERNAME = 'Username';
export const USERNAME_NOTE = 'The username of your account with that server.';

export const APP_PASSWORD = 'App password';

/** What the screen states where the account holds no password. */
export const NO_CREDENTIAL =
	'This account has no app password. Select "Edit" to enter one.';

/** What the screen states above the fields of an account that stands. */
export const KEEP_PASSWORD =
	'Leave this field empty to keep the password that Davenport holds.';

export const PROBLEMS_HEADING = 'Entries that Davenport did not read';
export const PROBLEMS_NOTE =
	'Davenport did not read these entries. Davenport keeps each of these entries in the data file, and it changes none of them. Correct the data file of the plugin where you want Davenport to read an entry.';

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

/**
 * What the screen states beside the field that takes a password. The text
 * is one sentence, because it stands beside one field.
 */
export function tierNote(tier: SecretTier): string {
	return tier === 'data-json'
		? DATA_FILE_FIELD_NOTE
		: SECRET_STORAGE_FIELD_NOTE;
}
