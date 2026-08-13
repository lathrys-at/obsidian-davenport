/**
 * The parts of a calendar-query filter that the mock understands: a
 * component name, a time range, and a UID property filter. The mock
 * compares the normalized DTSTART and DTEND values as text. The mock does
 * not expand recurrence, and the mock does not resolve TZID. Thus a
 * recurring event matches on the first instance only.
 *
 * The mock marks every other filter element as unsupported, and names
 * that element back to the client. The mock does not drop the element,
 * because a dropped element makes the result set larger and gives the
 * client no sign of the cause.
 */

import { normalizeStamp, readIcs } from './ics';
import { CALDAV_NS, childElements, childNamed, isNamed } from './xml';
import type { XmlDocument, XmlElement } from './xml';

/**
 * A comparison of whole values. The collation tells the mock how to treat
 * letter case.
 */
export type Collation = 'i;octet' | 'i;ascii-casemap';

const COLLATIONS: readonly Collation[] = ['i;octet', 'i;ascii-casemap'];
const DEFAULT_COLLATION: Collation = 'i;ascii-casemap';

/**
 * A filter element that the mock does not implement. The fields keep the
 * form that the client wrote.
 */
export interface UnsupportedFilter {
	readonly local: string;
	readonly name: string | null;
}

export interface CalendarFilter {
	/** The innermost component that the filter named, or null for none. */
	readonly component: string | null;
	readonly rangeStart: string | null;
	readonly rangeEnd: string | null;
	/** The UID that a prop-filter text-match asked for. */
	readonly uidMatch: string | null;
	readonly collation: Collation;
	readonly unsupported: UnsupportedFilter | null;
	/**
	 * A collation that the mock cannot apply. The refusal names that
	 * collation.
	 */
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
	// The outer comp-filter is always VCALENDAR. The component that the
	// filter selects is the comp-filter inside the outer one.
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
 * Finds the parts of a UID prop-filter that a plain text-match does not
 * cover. An absence test changes what the filter selects, and a parameter
 * filter changes what the filter selects. Thus the mock must not ignore
 * either part.
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

/**
 * Compares whole values and not parts of values, because a UID lookup
 * needs a comparison of whole values.
 */
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
	// The range is half-open. An event that starts at the end of the range
	// is outside the range, and an event that ends at the start of the
	// range is outside the range too.
	if (to !== null && start >= to) {
		return false;
	}
	if (from === null) {
		return true;
	}
	// An event with zero length covers the instant where the event starts.
	// Thus such an event is inside a range that starts at that instant.
	return start === end ? end >= from : end > from;
}
