/**
 * The digest port gives the engine its only source of a hash. The engine
 * hashes two things: the pair that names an event, and the bytes of a
 * record.
 *
 * The port takes text and gives back the hash of the UTF-8 octets of that
 * text, in lower-case hexadecimal. The caller never sees octets, and the
 * caller never chooses an encoding. One encoding for every caller keeps
 * the answer the same on every device.
 *
 * The adapter behind this port uses the crypto of the platform. Every
 * platform that runs the plugin holds that crypto, and a phone holds it
 * too. The engine adds no library for this.
 *
 * The answer is a pure function of the text. The port reads no clock, and
 * the port holds no state. The method is asynchronous because the crypto
 * of the platform is asynchronous, and for no other reason.
 */

export interface DigestPort {
	/**
	 * The SHA-256 hash of the UTF-8 octets of the text. The result holds
	 * 64 characters, and each character is a digit or a lower-case letter
	 * from `a` to `f`.
	 */
	sha256Hex(text: string): Promise<string>;
}

/** The number of characters that a full SHA-256 hash holds. */
export const SHA256_HEX_LENGTH = 64;
