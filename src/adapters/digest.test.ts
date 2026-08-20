import { describe, expect, it } from 'vitest';
import { SHA256_HEX_LENGTH } from '../core/ports/digest';
import { WebCryptoDigest } from './digest';

const digest = new WebCryptoDigest();

describe('the digest port over the crypto of the platform', () => {
	it('answers the published hash of an empty text', async () => {
		expect(await digest.sha256Hex('')).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		);
	});

	it('answers the published hash of the letters abc', async () => {
		expect(await digest.sha256Hex('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		);
	});

	it('hashes the octets of the text as UTF-8', () => {
		// The letter below costs two octets in UTF-8 and one octet in the
		// older encoding of Latin-1. The two encodings give two hashes, and
		// the answer must be the one of UTF-8.
		return expect(digest.sha256Hex('\u00e9')).resolves.toBe(
			'4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c',
		);
	});

	it('gives 64 characters of the hexadecimal form, in lower case', async () => {
		const hash = await digest.sha256Hex('anything');
		expect(hash).toHaveLength(SHA256_HEX_LENGTH);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('writes the leading zero of an octet', async () => {
		// The hash of this text starts with an octet below sixteen. A
		// conversion that dropped that zero would give 63 characters.
		expect(await digest.sha256Hex('davenport-21')).toBe(
			'016e5621925804619a5d3c09710e0ec18d384c2a4808609e345d1e718abd2f3f',
		);
	});

	it('gives one answer for one text', async () => {
		expect(await digest.sha256Hex('one')).toBe(
			await digest.sha256Hex('one'),
		);
	});

	it('gives another answer for another text', async () => {
		expect(await digest.sha256Hex('one')).not.toBe(
			await digest.sha256Hex('two'),
		);
	});
});
