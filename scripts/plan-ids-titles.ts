/**
 * The titles that a file of source declares. A title is the first argument of
 * a call to describe, to it, or to test. The reader also takes the title of a
 * curried call, which is the shape that a table of rows produces.
 *
 * This module matches patterns over text, and it does not parse the code. Two
 * shapes get past the reader. The first shape is a title that is not text,
 * and the reader counts these titles so that the count is visible. The second
 * shape is a regular expression that holds one quote character, because the
 * reader takes that quote for the start of a string.
 */

/** A name in the source, and a property name after a dot. */
const WORD = /[A-Za-z_$][\w$]*/y;

/** The names that carry a title. */
const CALLERS = new Set(['describe', 'it', 'test']);

/** One title, and the line of the file that the title starts on. */
export interface TitleSite {
	readonly line: number;
	readonly title: string;
}

/** The titles of one file, and the count of the titles that are not text. */
export interface TitleScan {
	readonly titles: readonly TitleSite[];
	readonly unreadable: number;
}

/** The titles that a file declares. */
export function readTitles(source: string): TitleScan {
	const titles: TitleSite[] = [];
	let unreadable = 0;
	const reader = new SourceReader(source);
	for (const start of reader.callSites()) {
		const site = reader.titleAt(start);
		if (site === UNREADABLE) {
			unreadable += 1;
			continue;
		}
		titles.push(site);
	}
	return { titles, unreadable };
}

/** The answer for a call whose title is not text. */
const UNREADABLE = Symbol('unreadable title');

/**
 * A reader over the text of one file. The reader steps over comments and over
 * text in quotes. Therefore the reader finds a call only where the file makes
 * a call, and not inside a comment and not inside a title.
 */
class SourceReader {
	private readonly source: string;
	private readonly newlines: number[] = [];

	constructor(source: string) {
		this.source = source;
		for (let index = 0; index < source.length; index += 1) {
			if (source[index] === '\n') {
				this.newlines.push(index);
			}
		}
	}

	/**
	 * The place after the name of each call to describe, to it, or to test.
	 * A name that no call follows is not a call site.
	 */
	callSites(): readonly number[] {
		const sites: number[] = [];
		let index = 0;
		while (index < this.source.length) {
			const step = this.skip(index);
			if (step > index) {
				index = step;
				continue;
			}
			const name = this.wordAt(index);
			if (name === undefined) {
				index += 1;
				continue;
			}
			const start = index + name.length;
			if (
				CALLERS.has(name) &&
				this.source[index - 1] !== '.' &&
				this.source[this.chain(start)] === '('
			) {
				sites.push(start);
			}
			index = start;
		}
		return sites;
	}

	/** The title of the call that starts at this place. */
	titleAt(start: number): TitleSite | typeof UNREADABLE {
		let index = this.chain(start);
		const direct = this.literalAt(index + 1);
		if (direct !== undefined) {
			return direct;
		}
		index = this.trivia(this.group(index, '(', ')'));
		if (this.source[index] !== '(') {
			return UNREADABLE;
		}
		return this.literalAt(index + 1) ?? UNREADABLE;
	}

	/** The name that starts at this place. */
	private wordAt(index: number): string | undefined {
		WORD.lastIndex = index;
		return WORD.exec(this.source)?.[0];
	}

	/** The place after a chain of property names, as in a call to each. */
	private chain(start: number): number {
		let index = this.trivia(start);
		while (this.source[index] === '.') {
			const after = this.trivia(index + 1);
			const name = this.wordAt(after);
			if (name === undefined) {
				return index;
			}
			index = this.trivia(after + name.length);
		}
		return index;
	}

	/** The text in quotes that starts here, and the line that it starts on. */
	private literalAt(start: number): TitleSite | undefined {
		const index = this.trivia(start);
		const quote = this.source[index];
		if (quote !== "'" && quote !== '"' && quote !== '`') {
			return undefined;
		}
		const end = this.stringEnd(index);
		return {
			line: this.lineOf(index),
			title: this.source.slice(index + 1, Math.max(index + 1, end - 1)),
		};
	}

	/** The place after a group in brackets that starts here. */
	private group(start: number, open: string, close: string): number {
		if (this.source[start] !== open) {
			return start;
		}
		let index = start + 1;
		let depth = 1;
		while (index < this.source.length && depth > 0) {
			const step = this.skip(index);
			if (step > index) {
				index = step;
				continue;
			}
			const character = this.source[index];
			if (character === open) {
				depth += 1;
			} else if (character === close) {
				depth -= 1;
			}
			index += 1;
		}
		return index;
	}

	/** The place after white space, after a comment, or after both. */
	private trivia(start: number): number {
		let index = start;
		while (index < this.source.length) {
			if (/\s/.test(this.source[index] ?? '')) {
				index += 1;
				continue;
			}
			const step = this.comment(index);
			if (step === index) {
				return index;
			}
			index = step;
		}
		return index;
	}

	/**
	 * The place after a comment or after text in quotes that starts here. The
	 * answer is the given place when neither one starts here.
	 */
	private skip(start: number): number {
		const step = this.comment(start);
		if (step > start) {
			return step;
		}
		const character = this.source[start];
		if (character === "'" || character === '"' || character === '`') {
			return this.stringEnd(start);
		}
		return start;
	}

	/** The place after a comment that starts here. */
	private comment(start: number): number {
		const two = this.source.slice(start, start + 2);
		if (two === '//') {
			const end = this.source.indexOf('\n', start);
			return end === -1 ? this.source.length : end;
		}
		if (two === '/*') {
			const end = this.source.indexOf('*/', start + 2);
			return end === -1 ? this.source.length : end + 2;
		}
		return start;
	}

	/** The place after the text in quotes that starts here. */
	private stringEnd(start: number): number {
		const quote = this.source[start];
		let index = start + 1;
		while (index < this.source.length) {
			const character = this.source[index];
			if (character === '\\') {
				index += 2;
				continue;
			}
			if (character === quote) {
				return index + 1;
			}
			if (quote === '`' && this.source.slice(index, index + 2) === '${') {
				index = this.group(index + 1, '{', '}');
				continue;
			}
			index += 1;
		}
		return this.source.length;
	}

	/** The line that holds this place. The first line is line one. */
	private lineOf(index: number): number {
		let line = 1;
		for (const newline of this.newlines) {
			if (newline >= index) {
				return line;
			}
			line += 1;
		}
		return line;
	}
}
