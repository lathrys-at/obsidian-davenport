import { describe, expect, it } from 'vitest';
import { ICS_LINE_OCTET_LIMIT, octetLength } from '../ics-octets';
import {
	escapeIcsText,
	foldIcsLine,
	icsDateStamp,
	icsText,
	icsUtcStamp,
} from './ics-text';

/** The physical lines of an iCalendar text, their CRLF terminators removed. */
function physicalLines(text: string): string[] {
	expect(text.endsWith('\r\n')).toBe(true);
	return text.slice(0, -2).split('\r\n');
}

/** Rejoins folded lines by dropping the one space each continuation opens. */
function unfold(lines: readonly string[]): string[] {
	const logical: string[] = [];
	for (const line of lines) {
		const opened = logical[logical.length - 1];
		if (line.startsWith(' ') && opened !== undefined) {
			logical[logical.length - 1] = opened + line.slice(1);
			continue;
		}
		logical.push(line);
	}
	return logical;
}

describe('iCalendar text writing', () => {
	it('terminates every physical line with CRLF and nothing else', () => {
		const text = icsText([
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'END:VCALENDAR',
		]);
		expect(text).toBe(
			'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n',
		);
		expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
	});

	it('folds long lines within the 75-octet limit', () => {
		const line = `SUMMARY:${'a'.repeat(300)}`;
		const folded = foldIcsLine(line);
		expect(folded.length).toBeGreaterThan(1);
		for (const physical of folded) {
			expect(octetLength(physical)).toBeLessThanOrEqual(
				ICS_LINE_OCTET_LIMIT,
			);
		}
		expect(folded.slice(1).every((part) => part.startsWith(' '))).toBe(
			true,
		);
		expect(unfold(folded)).toEqual([line]);
	});

	it('leaves a line that fits unfolded', () => {
		const line = `SUMMARY:${'a'.repeat(ICS_LINE_OCTET_LIMIT - 8)}`;
		expect(octetLength(line)).toBe(ICS_LINE_OCTET_LIMIT);
		expect(foldIcsLine(line)).toEqual([line]);
	});

	it('folds between characters, never inside a multi-byte sequence', () => {
		const line = `SUMMARY:${'\u{1f600}é中'.repeat(30)}`;
		const folded = foldIcsLine(line);
		for (const physical of folded) {
			expect(octetLength(physical)).toBeLessThanOrEqual(
				ICS_LINE_OCTET_LIMIT,
			);
		}
		expect(unfold(folded)).toEqual([line]);
		expect(folded.join('')).not.toContain('�');
	});

	it('folds through the whole text, recoverable line by line', () => {
		const lines = [
			'BEGIN:VEVENT',
			`SUMMARY:${'z'.repeat(200)}`,
			'END:VEVENT',
		];
		const text = icsText(lines);
		for (const physical of physicalLines(text)) {
			expect(octetLength(physical)).toBeLessThanOrEqual(
				ICS_LINE_OCTET_LIMIT,
			);
		}
		expect(unfold(physicalLines(text))).toEqual(lines);
	});

	it('escapes the characters iCalendar reserves in a text value', () => {
		expect(escapeIcsText('a;b,c\\d')).toBe('a\\;b\\,c\\\\d');
		expect(escapeIcsText('one\r\ntwo\nthree')).toBe('one\\ntwo\\nthree');
	});

	it('formats stamps from an explicit epoch, in UTC', () => {
		const epochMs = Date.UTC(2026, 7, 10, 9, 30, 5);
		expect(icsUtcStamp(epochMs)).toBe('20260810T093005Z');
		expect(icsDateStamp(epochMs)).toBe('20260810');
		expect(icsUtcStamp(Date.UTC(999, 0, 2, 3, 4, 5))).toBe(
			'09990102T030405Z',
		);
	});
});
