/**
 * The rules of the record emitter and the record reader, over generated
 * content.
 *
 * A record is the copy of the server state that the vault keeps. The
 * plugin owns the file, and the plugin is the only writer of it. Two rules
 * hold over the whole space of content that a record can carry:
 *
 * - The emitter and the reader invert each other. The reader gives back
 *   the content that the emitter wrote, and a second emit gives back the
 *   same bytes.
 * - The bytes follow from the content alone. Two constructions of one
 *   content reach one file. The order in which a program added the keys
 *   of an object changes nothing, and an empty list beside an absent list
 *   changes nothing.
 *
 * The second rule is what lets two devices hold the same file. A device
 * that wrote different bytes for the same state would rewrite the record
 * on every loop, and the other device would rewrite it back.
 *
 * The base snapshot of a generated record is a generated calendar, written
 * by the canonical serializer. The record always holds that form.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { WebCryptoDigest } from '../../../src/adapters/digest';
import type { RecordData } from '../../../src/core/model/record';
import { renderRecord } from '../../../src/core/records/canonical';
import {
	sealRecord,
	verifyRecordText,
} from '../../../src/core/records/checksum';
import { readRecord } from '../../../src/core/records/read';
import { checksumText, recordData } from '../../harness/arbitraries/record';
import {
	assertAsyncProperty,
	assertProperty,
} from '../../harness/arbitraries/seed';

const digest = new WebCryptoDigest();

/** The content that a record text states. */
function contentOf(text: string): RecordData {
	const result = readRecord(text);
	if (!result.ok) {
		throw new Error(
			`the reader refused the record: ${result.failure.problem}: ${result.failure.message}\n${text}`,
		);
	}
	return result.data;
}

/**
 * The same value, with the keys of every object in the opposite order. A
 * program that builds a record from another direction holds an object of
 * this shape, and the emitter must write the same bytes for it.
 */
function withReversedKeys(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item: unknown) => withReversedKeys(item));
	}
	if (typeof value === 'object' && value !== null) {
		return Object.fromEntries(
			Object.entries(value)
				.map(([key, item]) => [key, withReversedKeys(item)])
				.reverse(),
		);
	}
	return value;
}

/**
 * The record built the other way round. The reversal changes only the
 * order in which the keys stand in the objects, and it changes no value.
 */
function otherConstruction(data: RecordData): RecordData {
	return withReversedKeys(data) as RecordData;
}

describe('the emitter and the reader of a record', () => {
	it('writes a record that the reader accepts', () => {
		assertProperty(
			fc.property(recordData(), (data) => {
				expect(readRecord(renderRecord(data)).ok).toBe(true);
			}),
			200,
		);
	});

	it('gives back the content that the emitter wrote', () => {
		assertProperty(
			fc.property(recordData(), (data) => {
				expect(contentOf(renderRecord(data))).toEqual(data);
			}),
			200,
		);
	});

	it('writes the same bytes for the content that it read', () => {
		assertProperty(
			fc.property(recordData(), (data) => {
				const text = renderRecord(data);
				expect(renderRecord(contentOf(text))).toBe(text);
			}),
			200,
		);
	});
});

describe('the bytes of a record follow from its content', () => {
	it('writes one file for two constructions of one content', () => {
		assertProperty(
			fc.property(recordData(), (data) => {
				expect(renderRecord(otherConstruction(data))).toBe(
					renderRecord(data),
				);
			}),
			200,
		);
	});

	it('writes one file for an empty list and for an absent list', () => {
		assertProperty(
			fc.property(recordData(), (data) => {
				const { attachments, categories, ...rest } = data.fields;
				const absent: RecordData = { ...data, fields: rest };
				const empty: RecordData = {
					...data,
					fields: { ...rest, attachments: [], categories: [] },
				};
				expect(renderRecord(empty)).toBe(renderRecord(absent));
			}),
			200,
		);
	});

	it('writes one file for an empty map and for an absent map', () => {
		assertProperty(
			fc.property(recordData(), (data) => {
				const { materialization, renderHashes, ...rest } = data;
				const empty: RecordData = {
					...rest,
					materialization: {},
					renderHashes: {},
				};
				expect(renderRecord(empty)).toBe(renderRecord(rest));
			}),
			200,
		);
	});

	it('reads no clock, so two writes of one content agree', () => {
		assertProperty(
			fc.property(recordData(), (data) => {
				expect(renderRecord(data)).toBe(renderRecord(data));
			}),
			200,
		);
	});
});

describe('the checksum of a record', () => {
	it('does not depend on the checksum that the content carries', async () => {
		await assertAsyncProperty(
			fc.asyncProperty(
				recordData(),
				checksumText(),
				async (data, other) => {
					const one = await sealRecord(digest, data);
					const two = await sealRecord(digest, {
						...data,
						checksum: other,
					});
					expect(two).toBe(one);
				},
			),
			100,
		);
	});

	it('verifies against the file that carries it', async () => {
		await assertAsyncProperty(
			fc.asyncProperty(recordData(), async (data) => {
				const sealed = await sealRecord(digest, data);
				const verdict = await verifyRecordText(digest, sealed);
				expect(verdict.ok && verdict.valid).toBe(true);
			}),
			100,
		);
	});

	it('seals a file that the reader accepts', async () => {
		await assertAsyncProperty(
			fc.asyncProperty(recordData(), async (data) => {
				const sealed = await sealRecord(digest, data);
				expect(renderRecord(contentOf(sealed))).toBe(sealed);
			}),
			100,
		);
	});
});
