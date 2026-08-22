/**
 * The secret store port holds the credential of each account. A credential
 * is the app password of an account, or the OAuth values of an account. A
 * reference names one credential. The account holds that reference, and
 * the reference is never the credential itself.
 *
 * The engine and the settings screen read a credential only through this
 * port. No other part of the plugin reads the storage that holds the
 * credentials.
 *
 * The store holds text. The caller decides what that text states, and the
 * caller reads the text back into the shape of the credential.
 */

/**
 * The storage that holds the credentials.
 *
 * `secret-storage` is the secret storage of Obsidian. `data-json` is the
 * data file of the plugin. The plugin uses the data file when the version
 * of Obsidian gives the plugin no secret storage. The data file holds the
 * credentials as plain text. The settings screen reads this value, states
 * the condition to the user, and does nothing else with it.
 */
export type SecretTier = 'secret-storage' | 'data-json';

export interface SecretStore {
	readonly tier: SecretTier;
	/**
	 * The credential that the reference names, or null where the store
	 * holds none. The store gives null back for a value with no
	 * characters, because such a value states no credential.
	 */
	get(ref: string): Promise<string | null>;
	/** Writes the credential that the reference names. */
	set(ref: string, value: string): Promise<void>;
	/**
	 * Removes the credential that the reference names. After this call,
	 * `get` gives null back for that reference.
	 */
	remove(ref: string): Promise<void>;
}
