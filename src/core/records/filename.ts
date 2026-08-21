/**
 * The name of a record file, and the text that the name hashes.
 *
 * The identity of an event is a pair: the href of the collection and the
 * UID. The file name of a record is a digest of that pair. The record
 * holds both parts of the pair inside the file, so the name carries no
 * information that the file does not also state. A name that does not
 * equal the digest of the identity inside is therefore a copy that a tool
 * made, and the ledger can find such a copy.
 *
 * The digest is SHA-256, and the name takes the first 32 characters of
 * the hexadecimal form. The plugin uses the crypto of the platform for
 * this, through the digest port.
 *
 * The two parts of the pair join into one text before the hash, and the
 * join states the length of each part. Without the length, the pair
 * ("ab", "c") and the pair ("a", "bc") join into one text, and one digest
 * then names two events. With the length, one text comes from one pair
 * only.
 *
 * The join also writes an escape for a backslash and for every surrogate.
 * The digest port hashes the UTF-8 octets of the text, and an encoder of
 * UTF-8 replaces a surrogate with no partner. Two UIDs that differ in
 * that one code unit would otherwise reach one digest, and two events
 * would take one path. A backslash stands in front of every escape, so
 * the escape of a backslash keeps the join injective. This rule is
 * frozen: a change to it moves the name of every record file.
 *
 * The name holds digits and the letters `a` to `f`, and nothing else.
 * Every filesystem that the plugin meets accepts every character of that
 * set, and no platform reserves a name that this set can spell. A
 * reserved name of Windows holds letters that this set does not hold. A
 * name of this set does not end with a dot, and it does not end with a
 * space. The safety therefore follows from the alphabet, and not from a
 * check that runs later.
 */

import type { DigestPort } from '../ports/digest';
import type { EventIdentity } from '../model/identity';

/** The number of characters that the name of a record holds. */
export const RECORD_DIGEST_LENGTH = 32;

/** Every character that the name of a record can hold. */
export const RECORD_DIGEST_ALPHABET = '0123456789abcdef';

/** The extension of a record file. */
export const RECORD_EXTENSION = '.md';

/**
 * The shape of a record name, for a check of a name that a vault holds.
 * The pattern follows the alphabet and the length above, so the three
 * cannot drift apart.
 */
export const RECORD_NAME_PATTERN = new RegExp(
	`^[${RECORD_DIGEST_ALPHABET}]{${String(RECORD_DIGEST_LENGTH)}}$`,
);

/**
 * The text that the digest of an identity hashes. Each part stands after
 * its own length, so one text comes from one pair only. The result holds
 * no surrogate, so an encoder of UTF-8 changes no character of it.
 */
export function identityText(identity: EventIdentity): string {
	return joined(identity.collectionHref) + joined(identity.uid);
}

/** The characters that the join writes as an escape. */
const ESCAPED = /[\\\ud800-\udfff]/g;

/** One part of the pair, after its own length. */
function joined(part: string): string {
	const safe = part.replace(ESCAPED, escapeUnit);
	return `${String(safe.length)}:${safe}`;
}

function escapeUnit(character: string): string {
	return character === '\\'
		? '\\\\'
		: `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
}

/** The digest that names the record of one identity. */
export async function recordDigest(
	digest: DigestPort,
	identity: EventIdentity,
): Promise<string> {
	const hash = await digest.sha256Hex(identityText(identity));
	return hash.slice(0, RECORD_DIGEST_LENGTH);
}

/** The path of the record of one identity, inside the given folder. */
export async function recordPath(
	digest: DigestPort,
	folder: string,
	identity: EventIdentity,
): Promise<string> {
	return recordPathOf(folder, await recordDigest(digest, identity));
}

/** The path that a digest takes inside the given folder. */
export function recordPathOf(folder: string, digest: string): string {
	const base = folder.replace(/\/+$/, '');
	const name = `${digest}${RECORD_EXTENSION}`;
	return base.length === 0 ? name : `${base}/${name}`;
}

/**
 * The digest that a path states, or nothing when the path does not name a
 * record of the given folder. The check reads the name of the file, and
 * it never reads the file.
 */
export function digestOfPath(folder: string, path: string): string | undefined {
	const base = folder.replace(/\/+$/, '');
	const prefix = base.length === 0 ? '' : `${base}/`;
	if (!path.startsWith(prefix)) {
		return undefined;
	}
	const name = path.slice(prefix.length);
	if (!name.endsWith(RECORD_EXTENSION)) {
		return undefined;
	}
	const stem = name.slice(0, -RECORD_EXTENSION.length);
	return RECORD_NAME_PATTERN.test(stem) ? stem : undefined;
}
