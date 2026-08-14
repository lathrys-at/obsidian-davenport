/**
 * SHA-256 over bytes.
 *
 * The probe is a plugin, and it runs on desktop computers and on phones.
 * This file holds all of the SHA-256 algorithm. The probe therefore does
 * not ask the platform for a digest function. A platform function can
 * give different results on a desktop computer and on a phone, and a
 * platform function can be absent on one of the two. The function in this
 * file has neither problem. The comparison script checks each recorded
 * digest against the bytes that the digest claims to cover. A change that
 * makes this code different from SHA-256 makes that check fail.
 */

const ROUND_CONSTANTS = words([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
	0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
	0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
	0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
	0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
	0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
	0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
	0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
	0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const BLOCK_BYTES = 64;
const SCHEDULE_WORDS = 64;

/**
 * Calculates the SHA-256 digest of the bytes. The result is lowercase
 * hexadecimal text.
 */
export function sha256Hex(bytes: Uint8Array): string {
	const message = padded(bytes);
	const input = new DataView(
		message.buffer,
		message.byteOffset,
		message.byteLength,
	);
	const schedule = new DataView(new ArrayBuffer(SCHEDULE_WORDS * 4));

	let h0 = 0x6a09e667;
	let h1 = 0xbb67ae85;
	let h2 = 0x3c6ef372;
	let h3 = 0xa54ff53a;
	let h4 = 0x510e527f;
	let h5 = 0x9b05688c;
	let h6 = 0x1f83d9ab;
	let h7 = 0x5be0cd19;

	for (let block = 0; block < message.length; block += BLOCK_BYTES) {
		for (let index = 0; index < 16; index += 1) {
			schedule.setUint32(index * 4, input.getUint32(block + index * 4));
		}
		for (let index = 16; index < SCHEDULE_WORDS; index += 1) {
			const back15 = schedule.getUint32((index - 15) * 4);
			const back2 = schedule.getUint32((index - 2) * 4);
			const mix0 =
				rotate(back15, 7) ^ rotate(back15, 18) ^ (back15 >>> 3);
			const mix1 = rotate(back2, 17) ^ rotate(back2, 19) ^ (back2 >>> 10);
			const next =
				schedule.getUint32((index - 16) * 4) +
				mix0 +
				schedule.getUint32((index - 7) * 4) +
				mix1;
			schedule.setUint32(index * 4, next >>> 0);
		}

		let a = h0;
		let b = h1;
		let c = h2;
		let d = h3;
		let e = h4;
		let f = h5;
		let g = h6;
		let h = h7;

		for (let index = 0; index < SCHEDULE_WORDS; index += 1) {
			const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
			const choice = (e & f) ^ (~e & g);
			const step1 =
				h +
				sum1 +
				choice +
				ROUND_CONSTANTS.getUint32(index * 4) +
				schedule.getUint32(index * 4);
			const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
			const majority = (a & b) ^ (a & c) ^ (b & c);
			const step2 = sum0 + majority;

			h = g;
			g = f;
			f = e;
			e = (d + step1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (step1 + step2) >>> 0;
		}

		h0 = (h0 + a) >>> 0;
		h1 = (h1 + b) >>> 0;
		h2 = (h2 + c) >>> 0;
		h3 = (h3 + d) >>> 0;
		h4 = (h4 + e) >>> 0;
		h5 = (h5 + f) >>> 0;
		h6 = (h6 + g) >>> 0;
		h7 = (h7 + h) >>> 0;
	}

	return [h0, h1, h2, h3, h4, h5, h6, h7].map(hex).join('');
}

/**
 * Encodes the text as UTF-8, then calculates the SHA-256 digest of those
 * bytes. The result is lowercase hexadecimal text.
 */
export function sha256HexOfText(text: string): string {
	return sha256Hex(new TextEncoder().encode(text));
}

/**
 * Returns the bytes with the padding that SHA-256 adds at the end. The
 * padding finishes with the length of the input in bits.
 */
function padded(bytes: Uint8Array): Uint8Array {
	const bitLength = bytes.length * 8;
	const blocks = Math.ceil((bytes.length + 9) / BLOCK_BYTES);
	const message = new Uint8Array(blocks * BLOCK_BYTES);
	message.set(bytes);
	message[bytes.length] = 0x80;
	const view = new DataView(message.buffer);
	view.setUint32(message.length - 8, Math.floor(bitLength / 0x100000000));
	view.setUint32(message.length - 4, bitLength >>> 0);
	return message;
}

/**
 * Puts the values into a DataView as big-endian 32-bit words. The caller
 * then reads one whole word at a time, and does not build a word out of
 * single bytes.
 */
function words(values: readonly number[]): DataView {
	const view = new DataView(new ArrayBuffer(values.length * 4));
	values.forEach((value, index) => {
		view.setUint32(index * 4, value);
	});
	return view;
}

function rotate(value: number, bits: number): number {
	return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

function hex(value: number): string {
	return value.toString(16).padStart(8, '0');
}
