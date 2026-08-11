/**
 * What one poll of a feed serves. A variant is data, not a callback: the
 * fixture renders it against the poll counter and the caller's reference
 * time, so the same declaration always produces the same octets.
 */

import { encodeIcsBytes } from '../ics-octets';
import type { FeedEventSpec } from './events';
import { instantLine } from './events';
import { escapeIcsText, icsText, icsUtcStamp } from './ics-text';

export interface FeedVariantContext {
	/** One-based count of polls this feed has served, this one included. */
	readonly poll: number;
	/** Epoch milliseconds every generated stamp derives from. */
	readonly referenceTime: number;
	/** How far DTSTAMP advances per poll when the feed churns it. */
	readonly churnStepMs: number;
}

export interface ServedBody {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly bytes: Uint8Array;
}

export interface EventsVariantOptions {
	/** Re-stamps DTSTAMP on every poll, deriving it from the poll counter. */
	readonly dtstampChurn?: boolean;
	/**
	 * Mints a fresh UID for every event on every poll, keyed by the UID the
	 * event declares: two events declaring one UID are served one minted UID,
	 * so an in-feed duplicate stays a duplicate. An event declaring no UID
	 * still serves no UID line.
	 */
	readonly uidReminting?: boolean;
	readonly prodId?: string;
	readonly calendarName?: string;
}

/** Where a truncated body is cut, measured in octets of the whole body. */
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
 * The page a captive portal or expired session serves in place of the feed:
 * HTTP 200 carrying HTML. It is a constant so its octets are stable across
 * runs.
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

/** A full calendar built from the given events. */
export function events(
	specs: readonly FeedEventSpec[],
	options: EventsVariantOptions = {},
): FeedVariant {
	return { kind: 'events', events: specs, options };
}

/** A well-formed VCALENDAR carrying no components. */
export function emptyCalendar(options: EventsVariantOptions = {}): FeedVariant {
	return { kind: 'empty', options };
}

/** Another variant's body, cut short mid-file. */
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

/** Bytes served exactly as handed over, for replaying a stored body. */
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
 * What each declared UID is served as. A re-minting generator hands out UIDs
 * bearing no trace of the previous poll's, so a consumer cannot pair polls by
 * UID text — only by content. A minted UID is derived from the position of
 * the first event declaring it rather than from each event's own position,
 * which is what keeps two events sharing a UID sharing the minted one. A feed
 * that does not re-mint declares nothing here and serves every UID as it
 * stands.
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

/** Renders the variant to the status, headers, and octets one poll serves. */
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
