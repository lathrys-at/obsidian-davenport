/**
 * The fold of the canonical serializer.
 *
 * iCalendar limits a physical line to 75 octets. A longer content line
 * breaks into more than one physical line, and each line after the first
 * starts with one space. That space is part of the line, so the space
 * counts towards the limit. The break is a fold.
 *
 * This engine owns its fold. The parse library folds too, and the fold of
 * the library goes one octet past the limit. The library counts 75 octets
 * of content, and then it puts the fold space in front of those octets. A
 * physical line of the library therefore holds 76 octets. The canonical
 * text must stay inside the limit. The canon therefore asks the library
 * for a line that the library does not fold, and the canon folds that
 * line with the function below.
 *
 * The limit counts octets and not characters, because UTF-8 writes some
 * characters in more than one octet. A fold falls between two whole
 * characters. The text writes some characters as a surrogate pair, and
 * this function reads such a pair as one character. A fold therefore
 * never divides a surrogate pair.
 */

/**
 * The largest number of octets that one physical line holds. The line
 * break at the end of the line does not count.
 */
export const ICS_FOLD_OCTET_LIMIT = 75;

/**
 * The number of octets that UTF-8 needs for the text. The count follows
 * the ranges of the encoding: one octet below U+0080, two below U+0800,
 * three below U+10000, and four above. A lone surrogate counts three
 * octets, which is the size of the character that an encoder writes in
 * its place.
 */
export function icsOctetLength(text: string): number {
	let octets = 0;
	for (const character of text) {
		octets += characterOctets(character);
	}
	return octets;
}

/**
 * The physical lines of one content line. The first line holds as many
 * characters as the limit permits. Each line after the first starts with
 * one space, and that space counts towards the limit.
 */
export function foldIcsLine(line: string): readonly string[] {
	const physical: string[] = [];
	let current = '';
	let octets = 0;
	for (const character of line) {
		const size = characterOctets(character);
		if (octets + size > ICS_FOLD_OCTET_LIMIT) {
			physical.push(current);
			current = ' ';
			octets = 1;
		}
		current += character;
		octets += size;
	}
	physical.push(current);
	return physical;
}

/** The iCalendar text of the content lines. Every line ends with CRLF. */
export function foldedIcsText(lines: readonly string[]): string {
	return lines
		.flatMap(foldIcsLine)
		.map((line) => `${line}\r\n`)
		.join('');
}

function characterOctets(character: string): number {
	const code = character.codePointAt(0) ?? 0;
	if (code < 0x80) {
		return 1;
	}
	if (code < 0x800) {
		return 2;
	}
	return code < 0x10000 ? 3 : 4;
}
