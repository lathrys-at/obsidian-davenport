/**
 * The octet arithmetic iCalendar text runs on. A content line is limited by
 * the octets it encodes to rather than by the characters it holds, so the
 * writer that folds a line and the reader that checks one measure the same
 * way, through the same encoder.
 */

const encoder = new TextEncoder();

/** The octet count a physical line may reach, its line break excluded. */
export const ICS_LINE_OCTET_LIMIT = 75;

/** The number of octets the text occupies encoded as UTF-8. */
export function octetLength(text: string): number {
	return encoder.encode(text).length;
}

/** Encodes text as the UTF-8 octets a response body carries. */
export function encodeIcsBytes(text: string): Uint8Array {
	return encoder.encode(text);
}
