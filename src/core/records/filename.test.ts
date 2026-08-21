import { describe, expect, it } from 'vitest';
import { WebCryptoDigest } from '../../adapters/digest';
import type { EventIdentity } from '../model/identity';
import {
	RECORD_DIGEST_ALPHABET,
	RECORD_DIGEST_LENGTH,
	digestOfPath,
	identityText,
	recordDigest,
	recordPath,
	recordPathOf,
} from './filename';

const digest = new WebCryptoDigest();
const FOLDER = 'davenport/records';

function identity(collectionHref: string, uid: string): EventIdentity {
	return { collectionHref, uid };
}

describe('the text that the digest of an identity hashes', () => {
	it('states the length of each part before that part', () => {
		expect(identityText(identity('ab', 'c'))).toBe('2:ab1:c');
	});

	it('gives two texts to two pairs that a plain join would run together', () => {
		expect(identityText(identity('ab', 'c'))).not.toBe(
			identityText(identity('a', 'bc')),
		);
	});

	it('gives two texts to two pairs that differ in the separator alone', () => {
		expect(identityText(identity('a:1', 'b'))).not.toBe(
			identityText(identity('a', '1:b')),
		);
	});

	it('gives one text to one pair', () => {
		expect(identityText(identity('a', 'b'))).toBe(
			identityText(identity('a', 'b')),
		);
	});

	it('gives its own text to every pair of a hostile set', () => {
		const parts = ['', 'a', 'ab', '1:', ':', '2:ab', 'a b', '😀'];
		const texts = new Set<string>();
		for (const collection of parts) {
			for (const uid of parts) {
				texts.add(identityText(identity(collection, uid)));
			}
		}
		expect(texts.size).toBe(parts.length * parts.length);
	});
});

describe('the digest that names a record', () => {
	it('holds 32 characters of the hexadecimal form', async () => {
		const name = await recordDigest(digest, identity('c', 'u'));
		expect(name).toHaveLength(RECORD_DIGEST_LENGTH);
		expect(name).toMatch(/^[0-9a-f]{32}$/);
	});

	it('takes the front of the whole hash', async () => {
		const whole = await digest.sha256Hex(identityText(identity('c', 'u')));
		expect(await recordDigest(digest, identity('c', 'u'))).toBe(
			whole.slice(0, RECORD_DIGEST_LENGTH),
		);
	});

	it('names every character that the digest can hold', () => {
		expect(RECORD_DIGEST_ALPHABET).toBe('0123456789abcdef');
	});

	it('gives one name to one pair and another name to another pair', async () => {
		expect(await recordDigest(digest, identity('c', 'u'))).not.toBe(
			await recordDigest(digest, identity('c', 'v')),
		);
	});
});

describe('the path of a record inside its folder', () => {
	it('joins the folder, the digest, and the extension', () => {
		expect(recordPathOf(FOLDER, 'a1')).toBe('davenport/records/a1.md');
	});

	it('takes one slash off the end of the folder', () => {
		expect(recordPathOf('davenport/records/', 'a1')).toBe(
			'davenport/records/a1.md',
		);
	});

	it('takes every slash off the end of the folder', () => {
		expect(recordPathOf('davenport/records///', 'a1')).toBe(
			'davenport/records/a1.md',
		);
	});

	it('writes the file at the root when the folder is empty', () => {
		expect(recordPathOf('', 'a1')).toBe('a1.md');
	});

	it('builds the path of one identity', async () => {
		const name = await recordDigest(digest, identity('c', 'u'));
		expect(await recordPath(digest, FOLDER, identity('c', 'u'))).toBe(
			`${FOLDER}/${name}.md`,
		);
	});
});

describe('the digest that a path states', () => {
	const NAME = '0123456789abcdef0123456789abcdef';

	it('reads the digest out of a path of the folder', () => {
		expect(digestOfPath(FOLDER, `${FOLDER}/${NAME}.md`)).toBe(NAME);
	});

	it('reads the digest where the folder ends with a slash', () => {
		expect(digestOfPath(`${FOLDER}/`, `${FOLDER}/${NAME}.md`)).toBe(NAME);
	});

	it('reads no digest from a path outside the folder', () => {
		expect(digestOfPath(FOLDER, `other/${NAME}.md`)).toBeUndefined();
	});

	it('reads no digest from a path in a folder below the folder', () => {
		expect(
			digestOfPath(FOLDER, `${FOLDER}/deep/${NAME}.md`),
		).toBeUndefined();
	});

	it('reads no digest from a file with another extension', () => {
		expect(digestOfPath(FOLDER, `${FOLDER}/${NAME}.txt`)).toBeUndefined();
	});

	it('reads no digest from a name that is too short', () => {
		expect(digestOfPath(FOLDER, `${FOLDER}/abc.md`)).toBeUndefined();
	});

	it('reads no digest from a name that holds a letter in upper case', () => {
		expect(
			digestOfPath(FOLDER, `${FOLDER}/${NAME.toUpperCase()}.md`),
		).toBeUndefined();
	});

	it('reads no digest from a copy that a sync tool named', () => {
		expect(
			digestOfPath(FOLDER, `${FOLDER}/${NAME} (conflicted copy).md`),
		).toBeUndefined();
	});

	it('reads a digest at the root when the folder is empty', () => {
		expect(digestOfPath('', `${NAME}.md`)).toBe(NAME);
	});
});

describe('the escape that the join writes', () => {
	it('separates two pairs that differ in one surrogate with no partner', async () => {
		const high = String.fromCharCode(0xd800);
		const other = String.fromCharCode(0xd801);
		expect(identityText({ collectionHref: 'c', uid: high })).not.toBe(
			identityText({ collectionHref: 'c', uid: other }),
		);
		expect(
			await recordDigest(digest, { collectionHref: 'c', uid: high }),
		).not.toBe(
			await recordDigest(digest, { collectionHref: 'c', uid: other }),
		);
	});

	it('separates a surrogate with no partner from the replacement character', async () => {
		expect(
			await recordDigest(digest, {
				collectionHref: 'c',
				uid: String.fromCharCode(0xd800),
			}),
		).not.toBe(
			await recordDigest(digest, {
				collectionHref: 'c',
				uid: String.fromCharCode(0xfffd),
			}),
		);
	});

	it('separates a surrogate with no partner from the text of its escape', () => {
		expect(
			identityText({
				collectionHref: 'c',
				uid: String.fromCharCode(0xd800),
			}),
		).not.toBe(identityText({ collectionHref: 'c', uid: '\\ud800' }));
	});

	it('writes no surrogate into the text that the digest hashes', () => {
		const text = identityText({
			collectionHref: `a${String.fromCharCode(0xdc00)}`,
			uid: `b${String.fromCharCode(0xd800)}c`,
		});
		expect(/[\ud800-\udfff]/.test(text)).toBe(false);
	});

	it('keeps a pair of surrogates whole', () => {
		const text = identityText({ collectionHref: 'c', uid: '😀' });
		expect(text).toContain('\\ud83d\\ude00');
	});

	it('states the length of each part after the escape', () => {
		expect(identityText({ collectionHref: '\\', uid: 'ab' })).toBe(
			'2:\\\\2:ab',
		);
	});
});
