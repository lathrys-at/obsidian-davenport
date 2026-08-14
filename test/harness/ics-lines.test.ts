import { describe, expect, it } from 'vitest';
import {
	LEADING_CONTINUATION,
	icsLineParts,
	icsLogicalLines,
	icsPhysicalLines,
	isFoldedContinuation,
	readIcsLogicalLines,
} from './ics-lines';

const FOLDED = ['SUMMARY:a long su', ' mmary'];

describe('splitting text into lines', () => {
	it.each([
		['CRLF', '\r\n'],
		['a lone LF', '\n'],
		['a lone CR', '\r'],
	])('reads %s as a line ending', (_name, ending) => {
		const text = `BEGIN:VCALENDAR${ending}END:VCALENDAR${ending}`;
		expect(icsPhysicalLines(text)).toEqual([
			'BEGIN:VCALENDAR',
			'END:VCALENDAR',
		]);
	});

	it('reads a text that mixes its line endings', () => {
		expect(icsPhysicalLines('ONE\r\nTWO\nTHREE\rFOUR')).toEqual([
			'ONE',
			'TWO',
			'THREE',
			'FOUR',
		]);
	});

	it('closes the last line and does not start an empty line', () => {
		expect(icsPhysicalLines('ONE\r\n')).toEqual(['ONE']);
		expect(icsPhysicalLines('')).toEqual([]);
	});

	it('keeps the empty piece that a final line break makes, for a caller that rewrites one line', () => {
		const text = 'ONE\r\nTWO\r\n';
		expect(icsLineParts(text)).toEqual(['ONE', 'TWO', '']);
		expect(icsLineParts(text).join('\r\n')).toBe(text);
	});

	it('splits a text with no final line break and joins the pieces back into the same text', () => {
		expect(icsLineParts('ONE\nTWO').join('\n')).toBe('ONE\nTWO');
	});
});

describe('reading logical lines', () => {
	it('joins a continuation line to the line that it continues', () => {
		expect(icsLogicalLines(FOLDED)).toEqual(['SUMMARY:a long summary']);
	});

	it('removes exactly one leading white-space character from a continuation line and keeps a second white-space character', () => {
		expect(icsLogicalLines(['SUMMARY:a', '  spaced value'])).toEqual([
			'SUMMARY:a spaced value',
		]);
	});

	it('marks a line as a continuation when the line starts with a space or a tab, and marks no other line', () => {
		expect(isFoldedContinuation(' one')).toBe(true);
		expect(isFoldedContinuation('\tone')).toBe(true);
		expect(isFoldedContinuation('SUMMARY:one')).toBe(false);
	});

	it('reports no problem for text that is well formed', () => {
		expect(readIcsLogicalLines(FOLDED)).toEqual({
			lines: ['SUMMARY:a long summary'],
			problem: null,
		});
	});

	it('reads the lines after a continuation line that has no line to continue', () => {
		const reading = readIcsLogicalLines([' orphaned', 'SUMMARY:one']);
		expect(reading.problem).toBe(LEADING_CONTINUATION);
		expect(reading.lines).toEqual([' orphaned', 'SUMMARY:one']);
	});

	it('reports the leading continuation as the problem one time, whatever lines follow the continuation', () => {
		const reading = readIcsLogicalLines([' one', ' two']);
		expect(reading.problem).toBe(LEADING_CONTINUATION);
		expect(reading.lines).toEqual([' onetwo']);
	});

	it('throws when the reading reports a problem', () => {
		expect(() => icsLogicalLines([' orphaned'])).toThrow(
			LEADING_CONTINUATION,
		);
	});
});
