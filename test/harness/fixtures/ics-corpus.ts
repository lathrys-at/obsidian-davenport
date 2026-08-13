/**
 * The adversarial ICS corpus. A person wrote each iCalendar file in the
 * corpus by hand. Every file is legal iCalendar. The corpus is adversarial
 * because every file also carries one detail that a careless reader or a
 * careless writer gets wrong.
 *
 * A test suite reads the corpus directly. A property test reads the corpus
 * through the arbitrary below. An arbitrary is the fast-check object that
 * supplies the values of a property test.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';

/** The kinds of adversarial detail that the corpus covers. */
export const ICS_CATEGORIES = [
	'vendor-x-properties',
	'foreign-alarms',
	'structured-location',
	'folding-and-escaping',
	'vtimezone',
	'recurrence-overrides',
] as const;

export type IcsCategory = (typeof ICS_CATEGORIES)[number];

/** One file of the corpus. A caller needs its categories and its text. */
export interface IcsFixture {
	/** The file name without its extension. No two fixtures share an id. */
	readonly id: string;
	/** The absolute path of the file. */
	readonly path: string;
	/**
	 * Every kind of adversarial detail that the fixture carries. The kind
	 * that matters most comes first.
	 */
	readonly categories: readonly [IcsCategory, ...IcsCategory[]];
	/** The detail that makes the fixture adversarial. */
	readonly summary: string;
	/**
	 * The text of the fixture file, decoded from UTF-8. The CRLF line
	 * endings stay as they are.
	 */
	readonly content: string;
}

type IcsFixtureEntry = Omit<IcsFixture, 'path' | 'content'>;

const INDEX: readonly IcsFixtureEntry[] = [
	{
		id: 'x-props-vendor-names',
		categories: ['vendor-x-properties', 'folding-and-escaping'],
		summary:
			'Vendor property names in the forms that are hardest to read. One name has a single character. One name starts with a digit. One name repeats dashes inside it. Two names differ only in their letter case. One name is long enough that a fold falls inside the name.',
	},
	{
		id: 'x-props-parameters',
		categories: ['vendor-x-properties'],
		summary:
			'Vendor properties that state their value type. Vendor parameters on a property that Davenport models. A parameter with more than one value. A parameter with an empty value, and a property with an empty value.',
	},
	{
		id: 'x-component-unmodeled',
		categories: ['vendor-x-properties'],
		summary:
			'A vendor component beside the event. A second vendor component sits inside the first vendor component.',
	},
	{
		id: 'valarm-foreign-actions',
		categories: ['foreign-alarms'],
		summary:
			'Three alarms that another client wrote: an audio alarm, a display alarm that repeats, and an email alarm. Each alarm carries the attachment or the attendees that its action needs.',
	},
	{
		id: 'valarm-trigger-forms',
		categories: ['foreign-alarms'],
		summary:
			'Every form of trigger on one event. One trigger is relative to the start. One trigger relates to the end. One trigger is an absolute time. One trigger uses a duration measured in weeks.',
	},
	{
		id: 'valarm-apple-default',
		categories: ['foreign-alarms', 'vendor-x-properties'],
		summary:
			'An alarm that the client marks as its default. The alarm carries a vendor action, a vendor alarm identifier, and a trigger at a fixed time in the past.',
	},
	{
		id: 'structured-location-apple',
		categories: ['structured-location', 'folding-and-escaping'],
		summary:
			'A structured location that a fold splits across three lines. Its quoted address holds a comma and text that is not ASCII. The plain location and the coordinates stand beside it, and the structured location repeats what they say.',
	},
	{
		id: 'structured-location-travel',
		categories: ['structured-location'],
		summary:
			'A travel time and a map handle attached to a second property that carries a structured location. The map handle is opaque: only its vendor can read the value.',
	},
	{
		id: 'fold-at-75-octets',
		categories: ['folding-and-escaping'],
		summary:
			'Two physical lines of exactly the octet limit. One fold falls in the middle of a word. One continuation line starts with two spaces, and the second space belongs to the value.',
	},
	{
		id: 'fold-splits-escape',
		categories: ['folding-and-escaping'],
		summary:
			'Folds that fall between the two characters of an escape sequence. A fold splits an escaped newline, an escaped backslash, an escaped comma, and an escaped semicolon.',
	},
	{
		id: 'fold-splits-multibyte-run',
		categories: ['folding-and-escaping'],
		summary:
			'Folds inside runs of characters that need more than one octet. One line holds exactly the octet limit, and it holds far fewer characters than that. A fold also splits a joined emoji sequence at a codepoint boundary.',
	},
	{
		id: 'fold-with-htab',
		categories: ['folding-and-escaping'],
		summary:
			'Continuation lines that start with a horizontal tab and not with a space. One value uses both a tab fold and a space fold.',
	},
	{
		id: 'escaped-separators',
		categories: ['folding-and-escaping'],
		summary:
			'Escaped commas, semicolons and backslashes inside text values. Some properties carry one value, and some carry several. Some values end with an escaped backslash.',
	},
	{
		id: 'quoted-parameter-values',
		categories: ['folding-and-escaping'],
		summary:
			'Quoted parameter values that hold the characters that separate parameters. One member of a parameter list is quoted. One parameter value holds quotes that a caret escapes.',
	},
	{
		id: 'vtimezone-dateline-apia',
		categories: ['vtimezone'],
		summary:
			'A time zone that crossed the date line. One event spans the calendar day that the zone skipped.',
	},
	{
		id: 'vtimezone-half-hour-lord-howe',
		categories: ['vtimezone'],
		summary:
			'A time zone with a daylight shift of half an hour. One event starts inside the half hour that the clocks of the zone repeat.',
	},
	{
		id: 'vtimezone-pre-1970-amsterdam',
		categories: ['vtimezone'],
		summary:
			'Rules from the nineteenth century and the early twentieth century, at offsets that carry seconds. One event happens in 1916.',
	},
	{
		id: 'vtimezone-rdate-only-troll',
		categories: ['vtimezone'],
		summary:
			'A time zone with a daylight shift of two hours. The file lists each transition as a date. The file states no rule that projects the transitions.',
	},
	{
		id: 'recurrence-override-moved',
		categories: ['recurrence-overrides'],
		summary:
			'A weekly series. One instance moves to another day, and it becomes longer. Another instance carries a cancelled status at its original time.',
	},
	{
		id: 'recurrence-override-thisandfuture',
		categories: ['recurrence-overrides'],
		summary:
			'An override that applies to its own instance and to every instance after it.',
	},
	{
		id: 'exdate-multiple-forms',
		categories: ['recurrence-overrides', 'vtimezone'],
		summary:
			'One series with exclusions in four forms. One exclusion is a list of two values. One exclusion repeats the property. One exclusion states the value type. One exclusion is a UTC instant against a start that carries a time zone.',
	},
	{
		id: 'exdate-all-day-dates',
		categories: ['recurrence-overrides'],
		summary:
			'An all-day series. Its exclusions are dates, and not instants.',
	},
	{
		id: 'recurrence-rdate-override',
		categories: ['recurrence-overrides'],
		summary:
			'Instances that the file adds outside the rule. One added instance is a period. An override points at an added instance.',
	},
];

const FIXTURE_EXTENSION = '.ics';
const FIXTURE_DIR = join(import.meta.dirname, 'ics');
const utf8 = new TextDecoder('utf-8', { fatal: true });

let corpus: readonly IcsFixture[] | undefined;

/**
 * The whole corpus, in index order. The function reads each file one time
 * and then holds the text.
 */
export function icsCorpus(): readonly IcsFixture[] {
	corpus ??= INDEX.map(readFixture);
	return corpus;
}

/** Every fixture that carries the category, in index order. */
export function icsFixturesFor(category: IcsCategory): readonly IcsFixture[] {
	return icsCorpus().filter((fixture) =>
		fixture.categories.includes(category),
	);
}

/**
 * The fixture with this name. The function throws an error when the corpus
 * holds no file with this name.
 */
export function icsFixture(name: string): IcsFixture {
	const found = icsCorpus().find((fixture) => fixture.id === name);
	if (found === undefined) {
		throw new Error(
			`ics corpus: no fixture named ${name}; use a name that the corpus index lists`,
		);
	}
	return found;
}

/**
 * The fixture names on disk. The function reads the directory, and it
 * ignores the index.
 */
export function icsFixtureNamesOnDisk(): readonly string[] {
	return readdirSync(FIXTURE_DIR)
		.filter((file) => file.endsWith(FIXTURE_EXTENSION))
		.map((file) => file.slice(0, -FIXTURE_EXTENSION.length))
		.sort();
}

/**
 * Draws with equal chance from the whole corpus, or from one category of
 * the corpus.
 */
export function icsFixtureArbitrary(
	category?: IcsCategory,
): fc.Arbitrary<IcsFixture> {
	const pool =
		category === undefined ? icsCorpus() : icsFixturesFor(category);
	const [first, ...rest] = pool;
	if (first === undefined) {
		throw new Error(
			`ics corpus: no fixture carries ${category ?? 'any category'}; add a fixture to the corpus`,
		);
	}
	return fc.constantFrom(first, ...rest);
}

function readFixture(entry: IcsFixtureEntry): IcsFixture {
	const path = join(FIXTURE_DIR, `${entry.id}${FIXTURE_EXTENSION}`);
	let content: string;
	try {
		content = utf8.decode(readFileSync(path));
	} catch (error) {
		throw new Error(
			`ics corpus: cannot read ${path}: ${
				error instanceof Error ? error.message : String(error)
			}; add the file, or remove its entry from the index`,
		);
	}
	return { ...entry, path, content };
}
