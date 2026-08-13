/**
 * A variant states what one poll of a feed serves. A variant is data, and not
 * a callback. The fixture renders the variant from the poll counter and from
 * the reference time that the caller gives. The same declaration therefore
 * always produces the same octets.
 */

import { encodeIcsBytes } from '../ics-octets';
import type { FeedEventSpec } from './events';
import { instantLine } from './events';
import { escapeIcsText, icsText, icsUtcStamp } from './ics-text';

export interface FeedVariantContext {
	/** The number of the poll that the feed serves now. The first poll is 1. */
	readonly poll: number;
	/**
	 * The reference time, in epoch milliseconds. Every generated stamp
	 * derives from this time.
	 */
	readonly referenceTime: number;
	/**
	 * How much DTSTAMP advances from one poll to the next, on a feed that
	 * changes DTSTAMP.
	 */
	readonly churnStepMs: number;
}

export interface ServedBody {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly bytes: Uint8Array;
}

export interface EventsVariantOptions {
	/**
	 * Writes a new DTSTAMP on every poll. The new value derives from the poll
	 * counter.
	 */
	readonly dtstampChurn?: boolean;
	/**
	 * Mints a new UID for every event on every poll. To mint a UID is to make
	 * a UID that no earlier poll served. The fixture keys each minted UID by
	 * the UID that the event declares. Two events that declare one UID get one
	 * minted UID. Two duplicate events in one feed therefore stay duplicates.
	 * An event that declares no UID still serves no UID line.
	 */
	readonly uidReminting?: boolean;
	readonly prodId?: string;
	readonly calendarName?: string;
}

/**
 * Where the fixture cuts a truncated body. The fixture measures the cut
 * against the octets of the whole body.
 */
export type TruncationPoint =
	| { readonly kind: 'octets'; readonly value: number }
	| { readonly kind: 'fraction'; readonly value: number };

export type FeedVariant =
	| {
			readonly kind: 'events';
			readonly events: readonly FeedEventSpec[];
			readonly options: EventsVariantOptions;
	  }
	| { readonly kind: 'empty'; readonly options: EventsVariantOptions }
	| {
			readonly kind: 'truncated';
			readonly inner: FeedVariant;
			readonly keep: TruncationPoint;
	  }
	| {
			readonly kind: 'login-wall';
			readonly status: number;
			readonly html: string;
	  }
	| {
			readonly kind: 'raw';
			readonly status: number;
			readonly contentType: string;
			readonly body: string | Uint8Array;
	  };

const DEFAULT_PROD_ID = '-//Davenport//Feed fixture//EN';
const CALENDAR_CONTENT_TYPE = 'text/calendar; charset=utf-8';

/**
 * The page that a captive portal or an expired session serves in place of the
 * feed. The server sends this HTML page with the status HTTP 200. The page is
 * a constant, so its octets stay the same across runs.
 */
export const LOGIN_WALL_HTML = [
	'<!doctype html>',
	'<html lang="en">',
	'<head><title>Sign in required</title></head>',
	'<body>',
	'<h1>Sign in required</h1>',
	'<p>This calendar is only available to signed-in members.</p>',
	'</body>',
	'</html>',
	'',
].join('\n');

/** Builds a variant that serves a full calendar with the given events. */
export function events(
	specs: readonly FeedEventSpec[],
	options: EventsVariantOptions = {},
): FeedVariant {
	return { kind: 'events', events: specs, options };
}

/**
 * Builds a variant that serves a correctly formed VCALENDAR with no
 * components.
 */
export function emptyCalendar(options: EventsVariantOptions = {}): FeedVariant {
	return { kind: 'empty', options };
}

/**
 * Builds a variant that serves the body of another variant, cut short in the
 * middle of the file.
 */
export function truncated(
	inner: FeedVariant,
	keep: TruncationPoint = { kind: 'fraction', value: 0.5 },
): FeedVariant {
	return { kind: 'truncated', inner, keep };
}

export function keepOctets(value: number): TruncationPoint {
	return { kind: 'octets', value };
}

export function keepFraction(value: number): TruncationPoint {
	return { kind: 'fraction', value };
}

export function loginWall(
	overrides: { readonly status?: number; readonly html?: string } = {},
): FeedVariant {
	return {
		kind: 'login-wall',
		status: overrides.status ?? 200,
		html: overrides.html ?? LOGIN_WALL_HTML,
	};
}

/**
 * Builds a variant that serves the given bytes without a change. Use it to
 * replay a stored body.
 */
export function raw(
	body: string | Uint8Array,
	overrides: { readonly status?: number; readonly contentType?: string } = {},
): FeedVariant {
	return {
		kind: 'raw',
		status: overrides.status ?? 200,
		contentType: overrides.contentType ?? CALENDAR_CONTENT_TYPE,
		body,
	};
}

function dtstampFor(
	options: EventsVariantOptions,
	context: FeedVariantContext,
): string {
	const churn =
		options.dtstampChurn === true ? context.poll * context.churnStepMs : 0;
	return icsUtcStamp(context.referenceTime + churn);
}

/**
 * Returns the map from each declared UID to the UID that the feed serves. A
 * feed that re-mints hands out UIDs that keep no trace of the UIDs of the
 * previous poll. A consumer therefore cannot pair two polls by UID text, and
 * can pair them only by content. A minted UID derives from the position of
 * the first event with that declared UID, and not from the position of each
 * event. Two events that declare one UID therefore share one minted UID. A
 * feed that does not re-mint puts nothing in this map, and serves every UID
 * unchanged.
 */
function mintedUids(
	specs: readonly FeedEventSpec[],
	options: EventsVariantOptions,
	context: FeedVariantContext,
): ReadonlyMap<string, string> {
	const minted = new Map<string, string>();
	if (options.uidReminting !== true) return minted;
	specs.forEach((spec, index) => {
		if (spec.uid === undefined || minted.has(spec.uid)) return;
		minted.set(
			spec.uid,
			`p${String(context.poll)}-e${String(index)}@remint.feed.test`,
		);
	});
	return minted;
}

function eventLines(
	event: FeedEventSpec,
	minted: ReadonlyMap<string, string>,
	options: EventsVariantOptions,
	context: FeedVariantContext,
): string[] {
	const uid =
		event.uid === undefined
			? undefined
			: (minted.get(event.uid) ?? event.uid);
	const lines = ['BEGIN:VEVENT'];
	if (uid !== undefined) lines.push(`UID:${uid}`);
	lines.push(`DTSTAMP:${dtstampFor(options, context)}`);
	lines.push(instantLine('DTSTART', event.start));
	if (event.end !== undefined) lines.push(instantLine('DTEND', event.end));
	lines.push(`SUMMARY:${escapeIcsText(event.summary)}`);
	if (event.location !== undefined) {
		lines.push(`LOCATION:${escapeIcsText(event.location)}`);
	}
	if (event.description !== undefined) {
		lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
	}
	if (event.sequence !== undefined) {
		lines.push(`SEQUENCE:${String(event.sequence)}`);
	}
	if (event.extraLines !== undefined) lines.push(...event.extraLines);
	lines.push('END:VEVENT');
	return lines;
}

function calendarLines(
	specs: readonly FeedEventSpec[],
	options: EventsVariantOptions,
	context: FeedVariantContext,
): string[] {
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		`PRODID:${options.prodId ?? DEFAULT_PROD_ID}`,
		'CALSCALE:GREGORIAN',
	];
	if (options.calendarName !== undefined) {
		lines.push(`X-WR-CALNAME:${escapeIcsText(options.calendarName)}`);
	}
	const minted = mintedUids(specs, options, context);
	for (const spec of specs) {
		lines.push(...eventLines(spec, minted, options, context));
	}
	lines.push('END:VCALENDAR');
	return lines;
}

function truncationLimit(keep: TruncationPoint, length: number): number {
	const cut =
		keep.kind === 'octets' ? keep.value : Math.floor(length * keep.value);
	return Math.max(0, Math.min(length, Math.floor(cut)));
}

function calendarBody(text: string): ServedBody {
	return {
		status: 200,
		headers: { 'content-type': CALENDAR_CONTENT_TYPE },
		bytes: encodeIcsBytes(text),
	};
}

/**
 * Renders the variant into the status, the headers, and the octets that one
 * poll serves.
 */
export function renderVariant(
	variant: FeedVariant,
	context: FeedVariantContext,
): ServedBody {
	switch (variant.kind) {
		case 'events':
			return calendarBody(
				icsText(
					calendarLines(variant.events, variant.options, context),
				),
			);
		case 'empty':
			return calendarBody(
				icsText(calendarLines([], variant.options, context)),
			);
		case 'truncated': {
			const inner = renderVariant(variant.inner, context);
			const limit = truncationLimit(variant.keep, inner.bytes.byteLength);
			return { ...inner, bytes: inner.bytes.slice(0, limit) };
		}
		case 'login-wall':
			return {
				status: variant.status,
				headers: { 'content-type': 'text/html; charset=utf-8' },
				bytes: encodeIcsBytes(variant.html),
			};
		case 'raw':
			return {
				status: variant.status,
				headers: { 'content-type': variant.contentType },
				bytes:
					typeof variant.body === 'string'
						? encodeIcsBytes(variant.body)
						: Uint8Array.from(variant.body),
			};
	}
}
