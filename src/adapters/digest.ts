/**
 * The digest port over the crypto of the platform.
 *
 * The Web Crypto API states `crypto.subtle.digest`. A browser holds this
 * API, and so does the runtime that Obsidian uses on a desktop and on a
 * phone. The adapter therefore adds no dependency, and it uses no API of
 * Node.
 *
 * The adapter encodes the text as UTF-8 and hashes those octets. The
 * encoder replaces a lone surrogate with the replacement character, as
 * every UTF-8 encoder does. Two texts that differ in one lone surrogate
 * would therefore reach one hash. The engine hashes two texts, and each
 * one is free of a lone surrogate before it arrives: the emitter of a
 * record writes an escape for such a unit, and so does the join that
 * names a record file. The replacement therefore changes nothing that
 * the plugin hashes.
 */

import type { DigestPort } from '../core/ports/digest';

const HEX_DIGITS = '0123456789abcdef';

export class WebCryptoDigest implements DigestPort {
	private readonly encoder = new TextEncoder();

	async sha256Hex(text: string): Promise<string> {
		const octets = this.encoder.encode(text);
		const hash = await crypto.subtle.digest('SHA-256', octets);
		return hexOf(new Uint8Array(hash));
	}
}

/** The hexadecimal form of the octets, in lower case. */
function hexOf(octets: Uint8Array): string {
	let text = '';
	for (const octet of octets) {
		text += HEX_DIGITS.charAt(octet >> 4);
		text += HEX_DIGITS.charAt(octet & 0x0f);
	}
	return text;
}
