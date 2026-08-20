/**
 * The reader of the archive that the timezone release ships.
 *
 * The release is one gzip file, and that file holds a tar archive. The
 * archive states each file in a header block of 512 bytes, and then the
 * bytes of the file in more blocks of 512 bytes. A header states the name
 * of the file, the count of its bytes, and a checksum of the header
 * itself. Two blocks of zero bytes end the archive.
 *
 * This module reads those headers and gives back the files that the
 * caller names. The module reads the archive of one release. It therefore
 * takes the form that the release ships and no other form: a name of at
 * most 255 characters, a count of bytes in octal digits, and one entry
 * for each name. The module refuses every other shape. The next release
 * comes through this same code, and a reader that guesses would put bytes
 * into the cache that no checksum states.
 */

import { gunzipSync } from 'node:zlib';

/** The count of bytes in one block of a tar archive. */
const BLOCK = 512;

/** The places of the fields that this reader takes from a header. */
const NAME = { at: 0, size: 100 };
const SIZE = { at: 124, size: 12 };
const CHECKSUM = { at: 148, size: 8 };
const TYPE = { at: 156, size: 1 };
const PREFIX = { at: 345, size: 155 };

/** The type that a header states for the bytes of a file. */
const FILE_TYPE = '0';

/** The files that the caller named, from the gzip archive of a release. */
export function readReleaseArchive(
	archive: Uint8Array,
	wanted: readonly string[],
): ReadonlyMap<string, Buffer> {
	return readTarFiles(gunzipSync(archive), wanted);
}

/** The files that the caller named, from the bytes of a tar archive. */
export function readTarFiles(
	tar: Buffer,
	wanted: readonly string[],
): ReadonlyMap<string, Buffer> {
	const want = new Set(wanted);
	const found = new Map<string, Buffer>();
	let at = 0;
	while (at + BLOCK <= tar.length) {
		const header = tar.subarray(at, at + BLOCK);
		if (isEmpty(header)) {
			break;
		}
		refuseWrongChecksum(header, at);
		const name = readName(header);
		const size = readSize(header, at, name);
		const start = at + BLOCK;
		const end = start + size;
		if (end > tar.length) {
			throw new Error(
				`the archive states ${String(size)} bytes for ${name} at ${String(at)}, and the archive stops before them`,
			);
		}
		if (want.has(name) && readType(header) === FILE_TYPE) {
			if (found.has(name)) {
				throw new Error(`the archive holds the file ${name} two times`);
			}
			found.set(name, Buffer.from(tar.subarray(start, end)));
		}
		at = start + Math.ceil(size / BLOCK) * BLOCK;
	}
	for (const name of want) {
		if (!found.has(name)) {
			throw new Error(`the archive holds no file named ${name}`);
		}
	}
	return found;
}

/** The text of one field of a header, without the bytes of zero. */
function readField(
	header: Buffer,
	field: { readonly at: number; readonly size: number },
): string {
	return header
		.subarray(field.at, field.at + field.size)
		.toString('latin1')
		.replace(/\0.*$/s, '');
}

/**
 * The name of the file. The form states a long name in two fields, and
 * the name of the directory then stands in the second one.
 */
function readName(header: Buffer): string {
	const name = readField(header, NAME);
	const prefix = readField(header, PREFIX);
	return prefix === '' ? name : `${prefix}/${name}`;
}

/**
 * The type of the entry. The first form of tar wrote a byte of zero for
 * the bytes of a file, and the form that came after it wrote the digit.
 */
function readType(header: Buffer): string {
	const byte = header
		.subarray(TYPE.at, TYPE.at + TYPE.size)
		.toString('latin1');
	return byte === '\0' ? FILE_TYPE : byte;
}

/** The count of bytes of the file. The form states it in octal digits. */
function readSize(header: Buffer, at: number, name: string): number {
	const field = readField(header, SIZE).trim();
	if (!/^[0-7]+$/.test(field)) {
		throw new Error(
			`the header at ${String(at)} states the count of bytes of ${name} as ${JSON.stringify(field)}, and the reader wants octal digits`,
		);
	}
	return Number.parseInt(field, 8);
}

/** Whether every byte of the block is zero. */
function isEmpty(block: Buffer): boolean {
	return block.every((byte) => byte === 0);
}

/**
 * The header holds the sum of its own bytes, and the field of the sum
 * counts as spaces in that sum. A header that does not agree is not a
 * header.
 */
function refuseWrongChecksum(header: Buffer, at: number): void {
	const stated = readField(header, CHECKSUM).trim();
	if (!/^[0-7]+$/.test(stated)) {
		throw new Error(
			`the block at ${String(at)} states no checksum, and the reader wants a tar archive there`,
		);
	}
	let sum = 0;
	for (const [place, byte] of header.entries()) {
		const inside =
			place >= CHECKSUM.at && place < CHECKSUM.at + CHECKSUM.size;
		sum += inside ? 0x20 : byte;
	}
	if (sum !== Number.parseInt(stated, 8)) {
		throw new Error(
			`the header at ${String(at)} states the checksum ${stated}, and its bytes give ${sum.toString(8)}`,
		);
	}
}
