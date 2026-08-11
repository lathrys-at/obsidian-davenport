import { describe, expect, it } from 'vitest';
import type { FeedEventSpec } from './events';
import { timedAt } from './events';
import { ICS_LINE_OCTET_LIMIT, octetLength } from '../ics-octets';
import type { FeedVariant, FeedVariantContext } from './variants';
import {
	LOGIN_WALL_HTML,
	emptyCalendar,
	events,
	keepFraction,
	keepOctets,
	loginWall,
	raw,
	renderVariant,
	truncated,
} from './variants';

const REFERENCE_TIME = Date.UTC(2026, 7, 10, 12, 0, 0);
const HOUR_MS = 3_600_000;
const decoder = new TextDecoder();

function context(poll: number): FeedVariantContext {
	return { poll, referenceTime: REFERENCE_TIME, churnStepMs: 60_000 };
}

function bodyText(variant: FeedVariant, poll: number): string {
	return decoder.decode(renderVariant(variant, context(poll)).bytes);
}

function linesMatching(text: string, prefix: string): string[] {
	return text.split('\r\n').filter((line) => line.startsWith(prefix));
}

const meeting: FeedEventSpec = {
	id: 'meeting',
	uid: 'meeting@feed.test',
	summary: 'Meeting',
	start: timedAt(REFERENCE_TIME),
	end: timedAt(REFERENCE_TIME + HOUR_MS),
};

const standup: FeedEventSpec = {
	id: 'standup',
	uid: 'standup@feed.test',
	summary: 'Standup',
	start: timedAt(REFERENCE_TIME + HOUR_MS),
};

/** An event the generator serves with no UID line at all. */
const anonymous: FeedEventSpec = {
	id: 'anonymous',
	summary: 'Anonymous',
	start: timedAt(REFERENCE_TIME + 2 * HOUR_MS),
};

describe('generated calendar bodies', () => {
	it('serves a complete calendar carrying every event', () => {
		const text = bodyText(events([meeting, standup]), 1);
		expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
		expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
		expect(linesMatching(text, 'BEGIN:VEVENT')).toHaveLength(2);
		expect(text).toContain('UID:meeting@feed.test');
		expect(text).toContain('DTSTART:20260810T120000Z');
		expect(text).toContain('DTEND:20260810T130000Z');
	});

	it('folds and CRLF-terminates what it generates', () => {
		const wordy: FeedEventSpec = {
			...meeting,
			summary: 'Quarterly planning '.repeat(12),
		};
		const text = bodyText(events([wordy]), 1);
		const physical = text.slice(0, -2).split('\r\n');
		for (const line of physical) {
			expect(octetLength(line)).toBeLessThanOrEqual(ICS_LINE_OCTET_LIMIT);
		}
		expect(physical.some((line) => line.startsWith(' '))).toBe(true);
	});

	it('serves a valid calendar with no components', () => {
		const text = bodyText(emptyCalendar(), 1);
		expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
		expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
		expect(text).not.toContain('BEGIN:VEVENT');
	});

	it('omits the UID line for an event declaring no UID', () => {
		const text = bodyText(events([anonymous, standup]), 1);
		expect(linesMatching(text, 'UID:')).toEqual(['UID:standup@feed.test']);
	});

	it('serves one UID twice when two events declare it', () => {
		const twin: FeedEventSpec = {
			...standup,
			id: 'twin',
			uid: 'meeting@feed.test',
		};
		const text = bodyText(events([meeting, twin]), 1);
		expect(linesMatching(text, 'UID:')).toEqual([
			'UID:meeting@feed.test',
			'UID:meeting@feed.test',
		]);
	});
});

describe('per-fetch misbehavior', () => {
	const feed = events([meeting, standup], { dtstampChurn: true });

	it('churns DTSTAMP across polls and holds everything else', () => {
		const first = bodyText(feed, 1);
		const second = bodyText(feed, 2);
		expect(linesMatching(first, 'DTSTAMP:')).toEqual([
			'DTSTAMP:20260810T120100Z',
			'DTSTAMP:20260810T120100Z',
		]);
		expect(linesMatching(second, 'DTSTAMP:')).toEqual([
			'DTSTAMP:20260810T120200Z',
			'DTSTAMP:20260810T120200Z',
		]);
		const withoutStamps = (text: string): string =>
			text.replace(/DTSTAMP:[^\r]*\r\n/g, '');
		expect(withoutStamps(second)).toBe(withoutStamps(first));
	});

	it('holds DTSTAMP still when the feed does not churn', () => {
		const steady = events([meeting, standup]);
		expect(bodyText(steady, 7)).toBe(bodyText(steady, 1));
	});

	it('re-mints UIDs per poll, leaving no trace of the declared UID', () => {
		const reminting = events([meeting, standup], { uidReminting: true });
		const first = linesMatching(bodyText(reminting, 1), 'UID:');
		const second = linesMatching(bodyText(reminting, 2), 'UID:');
		expect(new Set([...first, ...second]).size).toBe(4);
		for (const line of [...first, ...second]) {
			expect(line).not.toContain('meeting@feed.test');
			expect(line).not.toContain('standup@feed.test');
		}
		expect(linesMatching(bodyText(reminting, 1), 'UID:')).toEqual(first);
	});

	it('mints one UID for two events declaring one, poll after poll', () => {
		const twin: FeedEventSpec = {
			...standup,
			id: 'twin',
			uid: 'meeting@feed.test',
		};
		const reminting = events([meeting, twin, standup], {
			uidReminting: true,
		});
		const first = linesMatching(bodyText(reminting, 1), 'UID:');
		expect(first).toHaveLength(3);
		expect(first[0]).toBe(first[1]);
		expect(first[2]).not.toBe(first[0]);
		const second = linesMatching(bodyText(reminting, 2), 'UID:');
		expect(second[0]).toBe(second[1]);
		expect(new Set([...first, ...second]).size).toBe(4);
		for (const line of [...first, ...second]) {
			expect(line).not.toContain('meeting@feed.test');
			expect(line).not.toContain('standup@feed.test');
		}
	});

	it('leaves a UID-less event UID-less under re-minting', () => {
		const text = bodyText(events([anonymous], { uidReminting: true }), 3);
		expect(linesMatching(text, 'UID:')).toHaveLength(0);
	});
});

describe('bodies that are not a calendar', () => {
	const feed = events([meeting, standup]);

	it('cuts a truncated body mid-file, as a prefix of the whole', () => {
		const whole = renderVariant(feed, context(1)).bytes;
		const cut = renderVariant(truncated(feed), context(1)).bytes;
		expect(cut.byteLength).toBe(Math.floor(whole.byteLength / 2));
		expect([...cut]).toEqual([...whole.slice(0, cut.byteLength)]);
		expect(decoder.decode(cut)).not.toContain('END:VCALENDAR');
	});

	it('serves byte-stable truncated bodies for the same poll', () => {
		const at = truncated(feed, keepOctets(120));
		expect([...renderVariant(at, context(4)).bytes]).toEqual([
			...renderVariant(at, context(4)).bytes,
		]);
		expect(renderVariant(at, context(4)).bytes.byteLength).toBe(120);
	});

	it('clamps a cut past the end of the body', () => {
		const whole = renderVariant(feed, context(1)).bytes;
		const past = renderVariant(
			truncated(feed, keepOctets(whole.byteLength * 4)),
			context(1),
		).bytes;
		expect(past.byteLength).toBe(whole.byteLength);
		expect(
			renderVariant(truncated(feed, keepFraction(0)), context(1)).bytes
				.byteLength,
		).toBe(0);
	});

	it('serves a login wall as HTML under a 200, byte-stable', () => {
		const wall = renderVariant(loginWall(), context(1));
		expect(wall.status).toBe(200);
		expect(wall.headers['content-type']).toBe('text/html; charset=utf-8');
		expect(decoder.decode(wall.bytes)).toBe(LOGIN_WALL_HTML);
		expect([...wall.bytes]).toEqual([
			...renderVariant(loginWall(), context(9)).bytes,
		]);
		expect(decoder.decode(wall.bytes)).not.toContain('BEGIN:VCALENDAR');
	});

	it('passes raw bytes through untouched', () => {
		const bytes = Uint8Array.from([0x42, 0x00, 0xff, 0xfe, 0x0a]);
		const served = renderVariant(
			raw(bytes, {
				status: 503,
				contentType: 'application/octet-stream',
			}),
			context(1),
		);
		expect(served.status).toBe(503);
		expect([...served.bytes]).toEqual([...bytes]);
		expect(served.headers['content-type']).toBe('application/octet-stream');
	});

	it('passes raw text through as the calendar it claims to be', () => {
		const stored = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
		const served = renderVariant(raw(stored), context(1));
		expect(decoder.decode(served.bytes)).toBe(stored);
		expect(served.headers['content-type']).toBe(
			'text/calendar; charset=utf-8',
		);
	});
});
