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

/**
 * An event that declares no UID. The fixture serves this event with no UID
 * line.
 */
const anonymous: FeedEventSpec = {
	id: 'anonymous',
	summary: 'Anonymous',
	start: timedAt(REFERENCE_TIME + 2 * HOUR_MS),
};

describe('calendar bodies that the fixture generates', () => {
	it('serves a complete calendar that contains every event', () => {
		const text = bodyText(events([meeting, standup]), 1);
		expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
		expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
		expect(linesMatching(text, 'BEGIN:VEVENT')).toHaveLength(2);
		expect(text).toContain('UID:meeting@feed.test');
		expect(text).toContain('DTSTART:20260810T120000Z');
		expect(text).toContain('DTEND:20260810T130000Z');
	});

	it('folds long lines and ends every line with CRLF', () => {
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

	it('serves no UID line for an event that declares no UID', () => {
		const text = bodyText(events([anonymous, standup]), 1);
		expect(linesMatching(text, 'UID:')).toEqual(['UID:standup@feed.test']);
	});

	it('serves one UID twice when two events declare the same UID', () => {
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

describe('feeds that misbehave from one poll to the next', () => {
	const feed = events([meeting, standup], { dtstampChurn: true });

	it('writes a new DTSTAMP each poll and changes nothing else', () => {
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

	it('serves the same body each poll when DTSTAMP does not change', () => {
		const steady = events([meeting, standup]);
		expect(bodyText(steady, 7)).toBe(bodyText(steady, 1));
	});

	it('mints new UIDs each poll, and serves no declared UID', () => {
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

	it('mints one UID for two events that declare one UID, each poll', () => {
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

	it('mints no UID for an event that declares no UID', () => {
		const text = bodyText(events([anonymous], { uidReminting: true }), 3);
		expect(linesMatching(text, 'UID:')).toHaveLength(0);
	});
});

describe('bodies that are not a calendar', () => {
	const feed = events([meeting, standup]);

	it('serves the first half of the whole body, and cuts off the end', () => {
		const whole = renderVariant(feed, context(1)).bytes;
		const cut = renderVariant(truncated(feed), context(1)).bytes;
		expect(cut.byteLength).toBe(Math.floor(whole.byteLength / 2));
		expect([...cut]).toEqual([...whole.slice(0, cut.byteLength)]);
		expect(decoder.decode(cut)).not.toContain('END:VCALENDAR');
	});

	it('serves the same octets for a truncated body at the same poll', () => {
		const at = truncated(feed, keepOctets(120));
		expect([...renderVariant(at, context(4)).bytes]).toEqual([
			...renderVariant(at, context(4)).bytes,
		]);
		expect(renderVariant(at, context(4)).bytes.byteLength).toBe(120);
	});

	it('holds the cut point between zero and the length of the body', () => {
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

	it('serves the same login-wall HTML, with status 200, each poll', () => {
		const wall = renderVariant(loginWall(), context(1));
		expect(wall.status).toBe(200);
		expect(wall.headers['content-type']).toBe('text/html; charset=utf-8');
		expect(decoder.decode(wall.bytes)).toBe(LOGIN_WALL_HTML);
		expect([...wall.bytes]).toEqual([
			...renderVariant(loginWall(), context(9)).bytes,
		]);
		expect(decoder.decode(wall.bytes)).not.toContain('BEGIN:VCALENDAR');
	});

	it('serves raw bytes with no change', () => {
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

	it('serves raw text with no change, and labels the body a calendar', () => {
		const stored = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
		const served = renderVariant(raw(stored), context(1));
		expect(decoder.decode(served.bytes)).toBe(stored);
		expect(served.headers['content-type']).toBe(
			'text/calendar; charset=utf-8',
		);
	});
});
