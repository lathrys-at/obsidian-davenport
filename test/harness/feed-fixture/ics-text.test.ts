import { describe, expect, it } from 'vitest';
import { ICS_LINE_OCTET_LIMIT, octetLength } from '../ics-octets';
import {
	escapeIcsText,
	foldIcsLine,
	icsDateStamp,
	icsText,
	icsUtcStamp,
} from './ics-text';

/**
 * The physical lines of an iCalendar text, without the CRLF that ends each
 * line. This function also fails the test if the text does not end with CRLF.
 */
function physicalLines(text: string): string[] {
	expect(text.endsWith('\r\n')).toBe(true);
	return text.slice(0, -2).split('\r\n');
}

/**
 * Joins folded lines back into logical lines. Each continuation starts with
 * one space, and this function removes that space.
 */
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

describe('writing iCalendar text', () => {
	it('ends every physical line with CRLF and adds no other line break', () => {
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

	it('folds a long line into physical lines of 75 octets or less', () => {
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

	it('keeps a line that fits the 75-octet limit as one physical line', () => {
		const line = `SUMMARY:${'a'.repeat(ICS_LINE_OCTET_LIMIT - 8)}`;
		expect(octetLength(line)).toBe(ICS_LINE_OCTET_LIMIT);
		expect(foldIcsLine(line)).toEqual([line]);
	});

	it('folds between two characters and never inside a multi-byte character', () => {
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

	it('folds a whole text, and unfolding gives every line back', () => {
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

	it('escapes the characters that iCalendar reserves in a text value', () => {
		expect(escapeIcsText('a;b,c\\d')).toBe('a\\;b\\,c\\\\d');
		expect(escapeIcsText('one\r\ntwo\nthree')).toBe('one\\ntwo\\nthree');
	});

	it('writes the date stamp and the date-time stamp in UTC from the given time', () => {
		const epochMs = Date.UTC(2026, 7, 10, 9, 30, 5);
		expect(icsUtcStamp(epochMs)).toBe('20260810T093005Z');
		expect(icsDateStamp(epochMs)).toBe('20260810');
		expect(icsUtcStamp(Date.UTC(999, 0, 2, 3, 4, 5))).toBe(
			'09990102T030405Z',
		);
	});
});
