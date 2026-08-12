/**
 * The probe carries its own SHA-256 so that it hashes the same way on a
 * phone as on a desktop and needs nothing from the environment it runs in.
 * That only holds if it is really SHA-256, which is what this asks: the
 * same digests node's own implementation produces, over the corpus the
 * probe actually hashes and over the lengths that exercise the padding.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex, sha256HexOfText } from '../tools/a11-probe/sha256';
import { NOTE_FIXTURES } from './harness/fixtures/note-corpus';

/** What node says, for the same bytes. */
function reference(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

describe('the probe digest', () => {
	it('agrees with node over every fixture in the corpus', () => {
		for (const fixture of NOTE_FIXTURES) {
			const bytes = new TextEncoder().encode(fixture.content);
			expect(sha256HexOfText(fixture.content)).toBe(reference(bytes));
		}
	});

	// One block is 64 bytes and the length takes the last 8 of them, so 55,
	// 56 and 64 are where a padding mistake shows up.
	it.each([0, 1, 55, 56, 63, 64, 65, 119, 120, 1000])(
		'agrees with node over %i bytes',
		(length) => {
			const bytes = Uint8Array.from(
				{ length },
				(_value, index) => (index * 7 + 13) % 256,
			);
			expect(sha256Hex(bytes)).toBe(reference(bytes));
		},
	);

	it('agrees with node over text that is not ASCII', () => {
		const text = '週次ミーティング — Café Müller 🎉';
		expect(sha256HexOfText(text)).toBe(
			reference(new TextEncoder().encode(text)),
		);
	});

	it('gives the published digest of the empty input', () => {
		expect(sha256Hex(new Uint8Array(0))).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		);
	});
});
