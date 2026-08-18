/**
 * The probe carries its own SHA-256 code. That code gives the probe two
 * properties. The probe hashes in the same way on a phone and on a
 * desktop computer, and the code needs nothing from the environment that
 * the probe runs in. Both properties hold only if the carried code really
 * is SHA-256. This file checks that condition. The tests compare the
 * digests of the carried code against the digests of the SHA-256 that
 * node supplies. The tests use the note corpus that the probe hashes, and
 * the input lengths where a mistake in the padding shows itself.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex, sha256HexOfText } from '../tools/frontmatter-probe/sha256';
import { NOTE_FIXTURES } from './harness/fixtures/note-corpus';

/**
 * Calculates the digest of the same bytes with the SHA-256 that node
 * supplies. The result is lowercase hexadecimal text.
 */
function reference(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

describe('the digest that the probe carries', () => {
	it('matches the digest from node for every note in the corpus', () => {
		for (const fixture of NOTE_FIXTURES) {
			const bytes = new TextEncoder().encode(fixture.content);
			expect(sha256HexOfText(fixture.content)).toBe(reference(bytes));
		}
	});

	// SHA-256 works on blocks of 64 bytes, and the length of the input
	// takes the last 8 bytes of the final block. A mistake in the padding
	// therefore shows itself at the lengths 55, 56 and 64.
	it.each([0, 1, 55, 56, 63, 64, 65, 119, 120, 1000])(
		'matches the digest from node for an input of %i bytes',
		(length) => {
			const bytes = Uint8Array.from(
				{ length },
				(_value, index) => (index * 7 + 13) % 256,
			);
			expect(sha256Hex(bytes)).toBe(reference(bytes));
		},
	);

	it('matches the digest from node for text that is not ASCII', () => {
		const text = '週次ミーティング — Café Müller 🎉';
		expect(sha256HexOfText(text)).toBe(
			reference(new TextEncoder().encode(text)),
		);
	});

	it('gives the published digest for an input of zero bytes', () => {
		expect(sha256Hex(new Uint8Array(0))).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		);
	});
});
