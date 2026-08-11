/**
 * The calendar-query filter the mock understands: a component name, a
 * time range, and a UID property filter. Matching is lexical on the
 * normalized DTSTART and DTEND values — recurrence is not expanded and
 * TZID is not resolved, so a recurring event matches on its first
 * instance alone.
 */

import { normalizeStamp, readIcs } from './ics';
import { CALDAV_NS, childElements, childNamed, isNamed } from './xml';
import type { XmlDocument, XmlElement } from './xml';

export interface CalendarFilter {
	/** The innermost component the filter named, if it named one. */
	readonly component: string | null;
	readonly rangeStart: string | null;
	readonly rangeEnd: string | null;
	/** The UID a prop-filter text-match asked for. */
	readonly uidMatch: string | null;
}

const EMPTY_FILTER: CalendarFilter = {
	component: null,
	rangeStart: null,
	rangeEnd: null,
	uidMatch: null,
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

	for (const child of childElements(element)) {
		if (isNamed(child, CALDAV_NS, 'time-range')) {
			rangeStart = child.getAttribute('start');
			rangeEnd = child.getAttribute('end');
		} else if (
			isNamed(child, CALDAV_NS, 'prop-filter') &&
			child.getAttribute('name')?.toUpperCase() === 'UID'
		) {
			const match = childNamed(child, CALDAV_NS, 'text-match');
			uidMatch = match ? (match.textContent ?? '') : '';
		}
	}

	return {
		component: element.getAttribute('name'),
		rangeStart,
		rangeEnd,
		uidMatch,
	};
}

export function matchesFilter(ics: string, filter: CalendarFilter): boolean {
	const facts = readIcs(ics);
	if (filter.component !== null && facts.component !== filter.component) {
		return false;
	}
	if (filter.uidMatch !== null && facts.uid !== filter.uidMatch) {
		return false;
	}
	return matchesRange(facts.start, facts.end, filter);
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
