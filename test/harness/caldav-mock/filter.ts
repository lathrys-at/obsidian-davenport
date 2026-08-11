/**
 * The calendar-query filter the mock understands: a component name, a
 * time range, and a UID property filter. Matching is lexical on the
 * normalized DTSTART and DTEND values — recurrence is not expanded and
 * TZID is not resolved, so a recurring event matches on its first
 * instance alone.
 *
 * Every other filter element is read as unsupported and named back to the
 * client rather than dropped, since a dropped element would widen the
 * result set with nothing to say so.
 */

import { normalizeStamp, readIcs } from './ics';
import { CALDAV_NS, childElements, childNamed, isNamed } from './xml';
import type { XmlDocument, XmlElement } from './xml';

/** Whole-value comparison, cased as the collation asks. */
export type Collation = 'i;octet' | 'i;ascii-casemap';

const COLLATIONS: readonly Collation[] = ['i;octet', 'i;ascii-casemap'];
const DEFAULT_COLLATION: Collation = 'i;ascii-casemap';

/** A filter element the mock does not implement, as the client wrote it. */
export interface UnsupportedFilter {
	readonly local: string;
	readonly name: string | null;
}

export interface CalendarFilter {
	/** The innermost component the filter named, if it named one. */
	readonly component: string | null;
	readonly rangeStart: string | null;
	readonly rangeEnd: string | null;
	/** The UID a prop-filter text-match asked for. */
	readonly uidMatch: string | null;
	readonly collation: Collation;
	readonly unsupported: UnsupportedFilter | null;
	/** A collation the mock cannot apply, refused by name. */
	readonly unsupportedCollation: string | null;
}

const EMPTY_FILTER: CalendarFilter = {
	component: null,
	rangeStart: null,
	rangeEnd: null,
	uidMatch: null,
	collation: DEFAULT_COLLATION,
	unsupported: null,
	unsupportedCollation: null,
};

export function parseFilter(document: XmlDocument): CalendarFilter {
	const root = document.documentElement;
	const filter = root ? childNamed(root, CALDAV_NS, 'filter') : null;
	const outer = filter ? childNamed(filter, CALDAV_NS, 'comp-filter') : null;
	if (!outer) {
		return EMPTY_FILTER;
	}
	// The outer comp-filter is always VCALENDAR; the component under test
	// is the one nested inside it.
	const inner = childNamed(outer, CALDAV_NS, 'comp-filter');
	return inner ? readCompFilter(inner) : EMPTY_FILTER;
}

function readCompFilter(element: XmlElement): CalendarFilter {
	let rangeStart: string | null = null;
	let rangeEnd: string | null = null;
	let uidMatch: string | null = null;
	let collation: Collation = DEFAULT_COLLATION;
	let unsupported: UnsupportedFilter | null = null;
	let unsupportedCollation: string | null = null;

	for (const child of childElements(element)) {
		if (isNamed(child, CALDAV_NS, 'time-range')) {
			rangeStart = child.getAttribute('start');
			rangeEnd = child.getAttribute('end');
			continue;
		}
		if (isUidFilter(child)) {
			const match = childNamed(child, CALDAV_NS, 'text-match');
			uidMatch = match ? (match.textContent ?? '') : '';
			const asked = match?.getAttribute('collation') ?? null;
			if (asked !== null) {
				const known = COLLATIONS.find(
					(candidate) => candidate === asked,
				);
				if (known === undefined) {
					unsupportedCollation ??= asked;
				} else {
					collation = known;
				}
			}
			unsupported ??= unsupportedWithin(child);
			continue;
		}
		unsupported ??= describe(child);
	}

	return {
		component: element.getAttribute('name'),
		rangeStart,
		rangeEnd,
		uidMatch,
		collation,
		unsupported,
		unsupportedCollation,
	};
}

function isUidFilter(element: XmlElement): boolean {
	return (
		isNamed(element, CALDAV_NS, 'prop-filter') &&
		element.getAttribute('name')?.toUpperCase() === 'UID'
	);
}

/**
 * The parts of a UID prop-filter beyond a plain text-match: an absence
 * test or a parameter filter changes what the filter selects, so neither
 * can be passed over.
 */
function unsupportedWithin(propFilter: XmlElement): UnsupportedFilter | null {
	for (const child of childElements(propFilter)) {
		if (isNamed(child, CALDAV_NS, 'text-match')) {
			if (child.getAttribute('negate-condition') === 'yes') {
				return { local: 'text-match', name: null };
			}
			continue;
		}
		return describe(child);
	}
	return null;
}

function describe(element: XmlElement): UnsupportedFilter {
	return {
		local: element.localName ?? '',
		name: element.getAttribute('name'),
	};
}

export function matchesFilter(ics: string, filter: CalendarFilter): boolean {
	const facts = readIcs(ics);
	if (filter.component !== null && facts.component !== filter.component) {
		return false;
	}
	if (
		filter.uidMatch !== null &&
		!textMatches(facts.uid ?? '', filter.uidMatch, filter.collation)
	) {
		return false;
	}
	return matchesRange(facts.start, facts.end, filter);
}

/** Whole values rather than substrings, which is what a UID lookup wants. */
function textMatches(
	value: string,
	wanted: string,
	collation: Collation,
): boolean {
	return collation === 'i;octet'
		? value === wanted
		: value.toUpperCase() === wanted.toUpperCase();
}

function matchesRange(
	start: string | null,
	end: string | null,
	filter: CalendarFilter,
): boolean {
	if (filter.rangeStart === null && filter.rangeEnd === null) {
		return true;
	}
	if (start === null || end === null) {
		return false;
	}
	const from =
		filter.rangeStart === null ? null : normalizeStamp(filter.rangeStart);
	const to =
		filter.rangeEnd === null ? null : normalizeStamp(filter.rangeEnd);
	// The range is half-open, so an event starting exactly at its end lies
	// outside it and an event ending exactly at its start does too.
	if (to !== null && start >= to) {
		return false;
	}
	if (from === null) {
		return true;
	}
	// A zero-length event overlaps the instant it sits on.
	return start === end ? end >= from : end > from;
}
