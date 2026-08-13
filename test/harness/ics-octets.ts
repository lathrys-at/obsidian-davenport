/**
 * Octet counts for iCalendar text. An octet is one byte. The iCalendar
 * format limits the length of a line in octets and not in characters, and
 * UTF-8 encodes some characters into more than one octet. The writer that
 * folds a line and the reader that measures a line both call the functions
 * here. Therefore the writer and the reader measure a line in the same way,
 * with the same encoder.
 */

const encoder = new TextEncoder();

/**
 * The largest number of octets that one physical line can contain. The line
 * break at the end of the line does not count.
 */
export const ICS_LINE_OCTET_LIMIT = 75;

/** The number of octets in the UTF-8 encoding of the text. */
export function octetLength(text: string): number {
	return encoder.encode(text).length;
}

/**
 * Encodes the text into UTF-8 octets. A test server puts these octets in
 * the body of an HTTP response.
 */
export function encodeIcsBytes(text: string): Uint8Array {
	return encoder.encode(text);
}
