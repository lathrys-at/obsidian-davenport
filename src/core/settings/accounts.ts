/**
 * The rules of one account, and the list of accounts in the settings.
 *
 * An account holds an id, the address of a server, a username, a
 * credential type, and a credential reference. The account never holds the
 * credential. The credential reference names the credential in the secret
 * store.
 *
 * The id has a narrow alphabet: lowercase letters, digits, and dashes. The
 * secret storage of Obsidian takes an id of that alphabet, and the plugin
 * builds the id of each secret from the id of the account. An id outside
 * that alphabet would therefore make a secret that the storage refuses.
 *
 * The plugin builds the id from the host name of the server address when
 * it makes the account. The id then stays as it is: the id names the
 * credential of the account in the secret store, so a change of the id
 * would leave that credential with no name. A user who moves an account
 * to another server therefore keeps an id that names the first server.
 * The username stays out of the id, because the secret storage is one set
 * of names for the whole app, and every plugin can read the names in it.
 */

import type { AccountConfig, SyncedSettings } from '../model/settings';
import { CREDENTIAL_TYPES } from '../model/credential';
import type { FieldFault } from './problems';
import type { UnknownMap } from './fields';
import { requiredText, requiredWord } from './fields';

/** The characters that an account id takes. */
export const ACCOUNT_ID_PATTERN = /^[a-z0-9-]+$/;

/** The id of an account whose server address states no host name. */
const FALLBACK_ID = 'account';

/** The largest number of characters that a proposed id holds. */
const ID_LIMIT = 48;

/** The parts of an account that the user gives. */
export interface AccountDraft {
	readonly serverUrl: string;
	readonly username: string;
}

/**
 * The draft without the white space at the two ends of each value. A user
 * who copies an address or a username takes a space with it, and a space
 * at an end changes no value that a server reads.
 */
export function trimDraft(draft: AccountDraft): AccountDraft {
	return {
		serverUrl: draft.serverUrl.trim(),
		username: draft.username.trim(),
	};
}

/** What the reader made of one entry of the accounts. */
export interface AccountReading {
	/** The account, or null where one field or more holds a fault. */
	readonly account: AccountConfig | null;
	/** The id of the entry, or null where the entry states no id. */
	readonly name: string | null;
	readonly faults: readonly FieldFault[];
}

/**
 * An id for a new account. The id comes from the host name of the server
 * address. Where another account already holds that id, the proposal adds
 * a number to it.
 */
export function proposeAccountId(
	serverUrl: string,
	taken: readonly string[],
): string {
	const base = idFromAddress(serverUrl);
	let candidate = base;
	let count = 1;
	while (taken.includes(candidate)) {
		count += 1;
		candidate = `${base}-${String(count)}`;
	}
	return candidate;
}

/**
 * The reference that names the credential of an account. The reference
 * comes from the id of the account, so the reference takes the alphabet
 * of that id.
 */
export function mintCredentialRef(id: string): string {
	return id;
}

/**
 * The faults of an account. The check reads the values that the user
 * gives, and it reads the id against the ids of the other accounts.
 */
export function checkAccount(
	account: AccountConfig,
	otherIds: readonly string[],
): readonly FieldFault[] {
	const faults: FieldFault[] = [];
	if (account.id === '') {
		faults.push({ kind: 'empty', field: 'id' });
	} else if (!ACCOUNT_ID_PATTERN.test(account.id)) {
		faults.push({ kind: 'alphabet', field: 'id', value: account.id });
	} else if (otherIds.includes(account.id)) {
		faults.push({ kind: 'repeated', field: 'id', value: account.id });
	}
	if (account.serverUrl === '') {
		faults.push({ kind: 'empty', field: 'serverUrl' });
	} else {
		const fault = addressFault(account.serverUrl, 'serverUrl');
		if (fault !== null) {
			faults.push(fault);
		}
	}
	if (account.username === '') {
		faults.push({ kind: 'empty', field: 'username' });
	}
	if (account.credentialRef === '') {
		faults.push({ kind: 'empty', field: 'credentialRef' });
	}
	return faults;
}

/** Reads one entry of the accounts. */
export function readAccount(entry: UnknownMap): AccountReading {
	const faults: FieldFault[] = [];
	const id = requiredText(entry, 'id', faults);
	const serverUrl = requiredText(entry, 'serverUrl', faults);
	const username = requiredText(entry, 'username', faults);
	const credentialType = requiredWord(
		entry,
		'credentialType',
		CREDENTIAL_TYPES,
		faults,
	);
	const credentialRef = requiredText(entry, 'credentialRef', faults);
	if (id !== null && !ACCOUNT_ID_PATTERN.test(id)) {
		faults.push({ kind: 'alphabet', field: 'id', value: id });
	}
	if (serverUrl !== null) {
		const fault = addressFault(serverUrl, 'serverUrl');
		if (fault !== null) {
			faults.push(fault);
		}
	}
	if (
		faults.length > 0 ||
		id === null ||
		serverUrl === null ||
		username === null ||
		credentialType === null ||
		credentialRef === null
	) {
		return { account: null, name: id, faults };
	}
	return {
		account: { id, serverUrl, username, credentialType, credentialRef },
		name: id,
		faults,
	};
}

/** The account with that id, or null where the settings hold none. */
export function findAccount(
	settings: SyncedSettings,
	id: string,
): AccountConfig | null {
	return settings.accounts.find((account) => account.id === id) ?? null;
}

/** The settings with one more account at the end of the list. */
export function addAccount(
	settings: SyncedSettings,
	account: AccountConfig,
): SyncedSettings {
	return { ...settings, accounts: [...settings.accounts, account] };
}

/**
 * The settings with the account of that id in place of the account that
 * stood there. The list keeps its order.
 */
export function replaceAccount(
	settings: SyncedSettings,
	account: AccountConfig,
): SyncedSettings {
	return {
		...settings,
		accounts: settings.accounts.map((held) =>
			held.id === account.id ? account : held,
		),
	};
}

/** The settings without the account of that id. */
export function removeAccount(
	settings: SyncedSettings,
	id: string,
): SyncedSettings {
	return {
		...settings,
		accounts: settings.accounts.filter((account) => account.id !== id),
	};
}

/**
 * The fault of a server address, or null where the address is one that
 * the plugin can use.
 *
 * The plugin takes an address of the schemes `http` and `https`. It
 * refuses an address that carries a username or a password in front of
 * the name of the host. A server can state such an address on its setup
 * page, and a user can paste it. The settings hold the address, and the
 * settings go to each device of that user. A password in the address
 * would therefore stand in the settings as plain text, on each device,
 * and outside the secret store.
 */
export function addressFault(
	text: string,
	field: 'serverUrl',
): FieldFault | null {
	const address = parseAddress(text);
	if (address === null) {
		return { kind: 'not-a-web-address', field, value: text };
	}
	if (address.protocol !== 'http:' && address.protocol !== 'https:') {
		return { kind: 'not-a-web-address', field, value: text };
	}
	if (address.username !== '' || address.password !== '') {
		return { kind: 'credentials-in-address', field };
	}
	return null;
}

/** True where the plugin can use the text as a server address. */
export function isWebAddress(text: string): boolean {
	return addressFault(text, 'serverUrl') === null;
}

/** The address that the text states, or null where the text states none. */
function parseAddress(text: string): URL | null {
	try {
		return new URL(text);
	} catch {
		return null;
	}
}

/** The id that comes from the host name of a server address. */
function idFromAddress(serverUrl: string): string {
	const host = hostOf(serverUrl);
	const cleaned = host
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.slice(0, ID_LIMIT)
		.replace(/^-+|-+$/g, '');
	return cleaned === '' ? FALLBACK_ID : cleaned;
}

function hostOf(serverUrl: string): string {
	try {
		return new URL(serverUrl).hostname;
	} catch {
		return '';
	}
}
