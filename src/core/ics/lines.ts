/**
 * The lines of an iCalendar text, as the parse boundary reads them.
 *
 * A writer splits a long line across two physical lines or more, and it
 * starts each line after the first with one space or one tab. The split is
 * a fold, and the line that the pieces make together is a logical line.
 * The functions here join the pieces again and then split one logical line
 * into the name, the parameter names, and the value.
 *
 * The parse boundary reads the text a second time in this way, beside the
 * parse library, so that the boundary can compare the text with what the
 * library reports.
 */

/** The name, the parameter names and the value of one logical line. */
export interface ContentLine {
	readonly name: string;
	readonly parameterNames: readonly string[];
	readonly value: string;
}

const LINE_BREAK = /\r\n|\n|\r/;

/**
 * The logical lines of the text. The function joins each folded piece to
 * the line that the piece continues, and it drops the one space or tab
 * that the fold added. The function gives null back when the text starts
 * with such a continuation, because no legal text starts that way.
 */
export function logicalLines(text: string): string[] | null {
	const lines: string[] = [];
	for (const physical of text.split(LINE_BREAK)) {
		if (physical === '') {
			continue;
		}
		if (physical.startsWith(' ') || physical.startsWith('\t')) {
			const opened = lines.pop();
			if (opened === undefined) {
				return null;
			}
			lines.push(opened + physical.slice(1));
			continue;
		}
		lines.push(physical);
	}
	return lines;
}

/**
 * Splits one logical line into the name, the parameter names and the
 * value. A colon inside quotation marks belongs to a parameter value, so
 * the split counts the quotation marks as it reads. The function gives
 * null back when the line holds no colon outside quotation marks.
 */
export function readContentLine(line: string): ContentLine | null {
	const parameterNames: string[] = [];
	let quoted = false;
	let nameEnd = -1;
	let segmentStart = -1;
	for (let index = 0; index < line.length; index += 1) {
		const character = line.charAt(index);
		if (character === '"') {
			quoted = !quoted;
			continue;
		}
		if (quoted || (character !== ';' && character !== ':')) {
			continue;
		}
		if (nameEnd < 0) {
			nameEnd = index;
		} else if (segmentStart >= 0) {
			parameterNames.push(parameterName(line.slice(segmentStart, index)));
		}
		if (character === ':') {
			return {
				name: line.slice(0, nameEnd),
				parameterNames,
				value: line.slice(index + 1),
			};
		}
		segmentStart = index + 1;
	}
	return null;
}

/**
 * True when the line holds a character that iCalendar forbids. The format
 * permits the horizontal tab, and it forbids every other control
 * character.
 */
export function hasControlCharacter(line: string): boolean {
	for (const character of line) {
		const code = character.codePointAt(0) ?? 0;
		if (code === 0x09) {
			continue;
		}
		if (code < 0x20 || code === 0x7f) {
			return true;
		}
	}
	return false;
}

function parameterName(segment: string): string {
	const equals = segment.indexOf('=');
	return equals < 0 ? segment : segment.slice(0, equals);
}
