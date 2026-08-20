/**
 * The name of a record file, and the pair that the file holds inside it.
 *
 * The name of a record is a digest of the identity of the event, and the
 * identity is a pair: the href of the collection, and the UID. The name
 * carries no information that the file does not also state, so a device
 * can compare the two. A name that does not equal the digest of the pair
 * inside is a copy that a tool made.
 *
 * The name must also work on every filesystem that the plugin meets. The
 * harness of the illegal names holds the set of each platform, and the
 * tests below hold every name against every set.
 */

import { describe, expect, it } from 'vitest';
import { WebCryptoDigest } from '../../../src/adapters/digest';
import { parseIcs } from '../../../src/core/ics/parse';
import { NORMALIZATION_VERSIONS } from '../../../src/core/ics/stamp';
import { buildRecord } from '../../../src/core/records/build';
import { sealRecord } from '../../../src/core/records/checksum';
import {
	digestOfPath,
	identityText,
	recordDigest,
	recordPath,
} from '../../../src/core/records/filename';
import { LedgerIndex } from '../../../src/core/records/ledger-index';
import { readRecord } from '../../../src/core/records/read';
import type { EventIdentity } from '../../../src/core/model/identity';
import { RECORD_GOLDEN_CASES } from '../../harness/fixtures/record-goldens';
import { nameRefusals } from '../../harness/illegal-names';

const digest = new WebCryptoDigest();
const FOLDER = 'davenport/records';

/** Pairs that a hostile server, a feed, or a user can produce. */
const HOSTILE_IDENTITIES: readonly EventIdentity[] = [
	{ collectionHref: '', uid: '' },
	{ collectionHref: 'https://dav/c/', uid: '../../../etc/passwd' },
	{ collectionHref: 'https://dav/c/', uid: 'CON' },
	{ collectionHref: 'https://dav/c/', uid: 'nul.md' },
	{ collectionHref: 'https://dav/c/', uid: 'a/b\\c:d*e?f"g<h>i|j' },
	{ collectionHref: 'https://dav/c/', uid: 'trailing dot.' },
	{ collectionHref: 'https://dav/c/', uid: 'trailing space ' },
	{ collectionHref: 'https://dav/c/', uid: `bell${String.fromCharCode(7)}` },
	{ collectionHref: 'https://dav/c/', uid: '😀 emoji' },
	{ collectionHref: 'https://dav/c/', uid: 'x'.repeat(500) },
	{ collectionHref: 'https://dav/c/a b/', uid: 'a b' },
	{ collectionHref: 'ab', uid: 'c' },
	{ collectionHref: 'a', uid: 'bc' },
];

async function nameOf(identity: EventIdentity): Promise<string> {
	return recordDigest(digest, identity);
}

describe('LG-1 the name of a record and the pair inside it', () => {
	it('LG-1: the name of a record equals the digest of the pair', async () => {
		for (const entry of RECORD_GOLDEN_CASES) {
			const identity = entry.state.identity;
			const path = await recordPath(digest, FOLDER, identity);
			const whole = await digest.sha256Hex(identityText(identity));
			expect(path).toBe(`${FOLDER}/${whole.slice(0, 32)}.md`);
			expect(digestOfPath(FOLDER, path)).toBe(whole.slice(0, 32));
		}
	});

	it('LG-1: the record holds both parts of the pair inside the file', async () => {
		for (const entry of RECORD_GOLDEN_CASES) {
			const parsed = parseIcs(entry.ics);
			expect(parsed.ok).toBe(true);
			if (!parsed.ok) {
				continue;
			}
			const built = buildRecord(NORMALIZATION_VERSIONS, {
				...entry.state,
				calendar: parsed.calendar,
			});
			const text = await sealRecord(digest, built.data);
			const read = readRecord(text);
			expect(read.ok).toBe(true);
			if (read.ok) {
				expect(read.data.identity).toEqual(entry.state.identity);
			}
		}
	});

	it('LG-1: the digest of the file answers the pair that the file states', async () => {
		for (const entry of RECORD_GOLDEN_CASES) {
			const parsed = parseIcs(entry.ics);
			if (!parsed.ok) {
				throw new Error(parsed.failure.message);
			}
			const built = buildRecord(NORMALIZATION_VERSIONS, {
				...entry.state,
				calendar: parsed.calendar,
			});
			const path = await recordPath(digest, FOLDER, entry.state.identity);
			const read = readRecord(await sealRecord(digest, built.data));
			expect(read.ok).toBe(true);
			if (read.ok) {
				expect(
					await recordPath(digest, FOLDER, read.data.identity),
				).toBe(path);
			}
		}
	});

	it('LG-1: two pairs that differ give two names', async () => {
		const names = new Set<string>();
		for (const identity of HOSTILE_IDENTITIES) {
			names.add(await nameOf(identity));
		}
		expect(names.size).toBe(HOSTILE_IDENTITIES.length);
	});

	it('LG-1: the same pair gives the same name on every run', async () => {
		for (const identity of HOSTILE_IDENTITIES) {
			expect(await nameOf(identity)).toBe(await nameOf(identity));
		}
	});
});

describe('LG-1 the name of a record on every filesystem', () => {
	it('LG-1: no platform refuses the name of a record of a hostile pair', async () => {
		for (const identity of HOSTILE_IDENTITIES) {
			const name = await nameOf(identity);
			expect(nameRefusals(name), name).toEqual([]);
			expect(nameRefusals(`${name}.md`), name).toEqual([]);
		}
	});

	it('LG-1: no platform refuses the name of a record of the gate', async () => {
		for (const entry of RECORD_GOLDEN_CASES) {
			const name = await nameOf(entry.state.identity);
			expect(nameRefusals(`${name}.md`), entry.id).toEqual([]);
		}
	});

	it('LG-1: the name holds digits and the letters a to f, and nothing else', async () => {
		for (const identity of HOSTILE_IDENTITIES) {
			expect(await nameOf(identity)).toMatch(/^[0-9a-f]{32}$/);
		}
	});

	it('LG-1: the name is 32 characters long, whatever the pair states', async () => {
		for (const identity of HOSTILE_IDENTITIES) {
			expect(await nameOf(identity)).toHaveLength(32);
		}
	});
});

describe('LG-1 the index from an identity to a path', () => {
	it('LG-1: the ledger answers the path of a pair that it holds', async () => {
		const index = new LedgerIndex();
		for (const entry of RECORD_GOLDEN_CASES) {
			index.add(
				entry.state.identity,
				await recordPath(digest, FOLDER, entry.state.identity),
			);
		}
		for (const entry of RECORD_GOLDEN_CASES) {
			expect(index.pathOf(entry.state.identity)).toBe(
				await recordPath(digest, FOLDER, entry.state.identity),
			);
		}
	});

	it('LG-1: the ledger holds one identity of two collections as two records', async () => {
		const index = new LedgerIndex();
		const work = { collectionHref: 'https://dav/work/', uid: 'shared' };
		const home = { collectionHref: 'https://dav/home/', uid: 'shared' };
		index.add(work, await recordPath(digest, FOLDER, work));
		index.add(home, await recordPath(digest, FOLDER, home));
		expect(index.size).toBe(2);
		expect(index.pathOf(work)).not.toBe(index.pathOf(home));
	});

	it('LG-1: the ledger refuses a second file for one identity', async () => {
		const index = new LedgerIndex();
		const identity = { collectionHref: 'https://dav/work/', uid: 'one' };
		const path = await recordPath(digest, FOLDER, identity);
		expect(index.add(identity, path)).toBe('added');
		expect(index.add(identity, `${FOLDER}/copy.md`)).toBe(
			'duplicate-identity',
		);
	});
});
