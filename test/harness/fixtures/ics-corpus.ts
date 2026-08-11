/**
 * The adversarial ICS corpus: hand-authored iCalendar files, each legal and
 * each carrying one property that a naive reader or writer gets wrong.
 * Suites draw on it directly; property tests draw on it through the
 * arbitraries below.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';

/** The adversarial properties the corpus covers. */
export const ICS_CATEGORIES = [
	'vendor-x-properties',
	'foreign-alarms',
	'structured-location',
	'folding-and-escaping',
	'vtimezone',
	'recurrence-overrides',
] as const;

export type IcsCategory = (typeof ICS_CATEGORIES)[number];

/** One corpus file, with the tags and text a consumer needs. */
export interface IcsFixture {
	/** File name without its extension; unique across the corpus. */
	readonly id: string;
	/** Absolute path to the file. */
	readonly path: string;
	/** Every property the fixture carries, most central first. */
	readonly categories: readonly [IcsCategory, ...IcsCategory[]];
	/** What makes the fixture adversarial. */
	readonly summary: string;
	/** The file decoded as UTF-8, its CRLF line endings intact. */
	readonly content: string;
}

type IcsFixtureEntry = Omit<IcsFixture, 'path' | 'content'>;

const INDEX: readonly IcsFixtureEntry[] = [
	{
		id: 'x-props-vendor-names',
		categories: ['vendor-x-properties', 'folding-and-escaping'],
		summary:
			'Vendor property names at their extremes: one character, a leading digit, repeated dashes, two spellings that differ only in case, and a name long enough to be folded through its middle.',
	},
	{
		id: 'x-props-parameters',
		categories: ['vendor-x-properties'],
		summary:
			'Vendor properties carrying explicit value types, vendor parameters on a modeled property, a multi-valued parameter, an empty parameter value and an empty property value.',
	},
	{
		id: 'x-component-unmodeled',
		categories: ['vendor-x-properties'],
		summary:
			'A vendor component beside the event, with a second one nested inside it.',
	},
	{
		id: 'valarm-foreign-actions',
		categories: ['foreign-alarms'],
		summary:
			'Audio, repeating display and email alarms written by another client, with the attachment and attendees each action carries.',
	},
	{
		id: 'valarm-trigger-forms',
		categories: ['foreign-alarms'],
		summary:
			'Every trigger form on one event: relative to start, related to end, absolute, and a week-scale duration.',
	},
	{
		id: 'valarm-apple-default',
		categories: ['foreign-alarms', 'vendor-x-properties'],
		summary:
			'An alarm marked as a client default, with a vendor action, a vendor alarm identifier and a fixed historical trigger.',
	},
	{
		id: 'structured-location-apple',
		categories: ['structured-location', 'folding-and-escaping'],
		summary:
			'A structured location whose quoted address holds a comma and non-ASCII text, folded across three lines, beside the plain location and coordinates it duplicates.',
	},
	{
		id: 'structured-location-travel',
		categories: ['structured-location'],
		summary:
			'Travel time and an opaque map handle hung off a second structured location.',
	},
	{
		id: 'fold-at-75-octets',
		categories: ['folding-and-escaping'],
		summary:
			'Two physical lines of exactly the octet limit, a fold through the middle of a word, and a continuation opening with two spaces where one belongs to the value.',
	},
	{
		id: 'fold-splits-escape',
		categories: ['folding-and-escaping'],
		summary:
			'Folds falling between the two characters of an escape sequence: an escaped newline, backslash, comma and semicolon each split in half.',
	},
	{
		id: 'fold-splits-multibyte-run',
		categories: ['folding-and-escaping'],
		summary:
			'Folds inside runs of multi-octet characters: a line of exactly the octet limit but far fewer characters, and a joined emoji sequence split at a codepoint boundary.',
	},
	{
		id: 'fold-with-htab',
		categories: ['folding-and-escaping'],
		summary:
			'Continuations introduced by a horizontal tab rather than a space, and one value folded both ways.',
	},
	{
		id: 'escaped-separators',
		categories: ['folding-and-escaping'],
		summary:
			'Escaped commas, semicolons and backslashes inside single and multi-valued text, including values that end in an escaped backslash.',
	},
	{
		id: 'quoted-parameter-values',
		categories: ['folding-and-escaping'],
		summary:
			'Quoted parameter values holding the characters that separate parameters, a quoted member of a parameter list, and caret-escaped quotes.',
	},
	{
		id: 'vtimezone-dateline-apia',
		categories: ['vtimezone'],
		summary:
			'A zone that crossed the date line, and an event spanning the calendar day it skipped.',
	},
	{
		id: 'vtimezone-half-hour-lord-howe',
		categories: ['vtimezone'],
		summary:
			'A zone whose daylight shift is half an hour, with an event starting inside the half hour its clocks repeat.',
	},
	{
		id: 'vtimezone-pre-1970-amsterdam',
		categories: ['vtimezone'],
		summary:
			'Nineteenth and early twentieth century rules at offsets that carry seconds, with an event in 1916.',
	},
	{
		id: 'vtimezone-rdate-only-troll',
		categories: ['vtimezone'],
		summary:
			'A zone with a two-hour daylight shift whose transitions are listed as dates rather than projected from a rule.',
	},
	{
		id: 'recurrence-override-moved',
		categories: ['recurrence-overrides'],
		summary:
			'A weekly series with one instance moved to another day and lengthened, and another cancelled where it stood.',
	},
	{
		id: 'recurrence-override-thisandfuture',
		categories: ['recurrence-overrides'],
		summary: 'An override that claims every instance from its own onward.',
	},
	{
		id: 'exdate-multiple-forms',
		categories: ['recurrence-overrides', 'vtimezone'],
		summary:
			'One series excluded four ways: a two-valued list, a repeated property, an explicit value type, and a UTC instant against a zoned start.',
	},
	{
		id: 'exdate-all-day-dates',
		categories: ['recurrence-overrides'],
		summary:
			'An all-day series whose exclusions are dates rather than instants.',
	},
	{
		id: 'recurrence-rdate-override',
		categories: ['recurrence-overrides'],
		summary:
			'Instances added outside the rule, one of them as a period, with an override targeting an added instance.',
	},
];

const FIXTURE_EXTENSION = '.ics';
const FIXTURE_DIR = join(import.meta.dirname, 'ics');
const utf8 = new TextDecoder('utf-8', { fatal: true });

let corpus: readonly IcsFixture[] | undefined;

/** The whole corpus in index order. Files are read once and held. */
export function icsCorpus(): readonly IcsFixture[] {
	corpus ??= INDEX.map(readFixture);
	return corpus;
}

/** Every fixture tagged with the category, in index order. */
export function icsFixturesFor(category: IcsCategory): readonly IcsFixture[] {
	return icsCorpus().filter((fixture) =>
		fixture.categories.includes(category),
	);
}

/** The fixture of that name; throws when the corpus holds no such file. */
export function icsFixture(name: string): IcsFixture {
	const found = icsCorpus().find((fixture) => fixture.id === name);
	if (found === undefined) {
		throw new Error(`no ICS fixture named ${name}`);
	}
	return found;
}

/** The fixture names present on disk, whatever the index claims. */
export function icsFixtureNamesOnDisk(): readonly string[] {
	return readdirSync(FIXTURE_DIR)
		.filter((file) => file.endsWith(FIXTURE_EXTENSION))
		.map((file) => file.slice(0, -FIXTURE_EXTENSION.length))
		.sort();
}

/** Draws uniformly from the corpus, or from one category of it. */
export function icsFixtureArbitrary(
	category?: IcsCategory,
): fc.Arbitrary<IcsFixture> {
	const pool =
		category === undefined ? icsCorpus() : icsFixturesFor(category);
	const [first, ...rest] = pool;
	if (first === undefined) {
		throw new Error(`no ICS fixtures tagged ${category ?? 'at all'}`);
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
			}`,
		);
	}
	return { ...entry, path, content };
}
