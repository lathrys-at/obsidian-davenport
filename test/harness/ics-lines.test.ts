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
		['LF', '\n'],
		['a lone CR', '\r'],
	])('reads %s as a line ending', (_name, ending) => {
		const text = `BEGIN:VCALENDAR${ending}END:VCALENDAR${ending}`;
		expect(icsPhysicalLines(text)).toEqual([
			'BEGIN:VCALENDAR',
			'END:VCALENDAR',
		]);
	});

	it('reads a text whose endings disagree with each other', () => {
		expect(icsPhysicalLines('ONE\r\nTWO\nTHREE\rFOUR')).toEqual([
			'ONE',
			'TWO',
			'THREE',
			'FOUR',
		]);
	});

	it('ends the last line rather than opening an empty one', () => {
		expect(icsPhysicalLines('ONE\r\n')).toEqual(['ONE']);
		expect(icsPhysicalLines('')).toEqual([]);
	});

	it('keeps the empty piece a terminator opens, for a caller rewriting one', () => {
		const text = 'ONE\r\nTWO\r\n';
		expect(icsLineParts(text)).toEqual(['ONE', 'TWO', '']);
		expect(icsLineParts(text).join('\r\n')).toBe(text);
	});

	it('keeps a text with no terminator whole through a round trip', () => {
		expect(icsLineParts('ONE\nTWO').join('\n')).toBe('ONE\nTWO');
	});
});

describe('reading logical lines', () => {
	it('joins a continuation to the line it continues', () => {
		expect(icsLogicalLines(FOLDED)).toEqual(['SUMMARY:a long summary']);
	});

	it('gives up one white-space character and keeps the second', () => {
		expect(icsLogicalLines(['SUMMARY:a', '  spaced value'])).toEqual([
			'SUMMARY:a spaced value',
		]);
	});

	it('marks a continuation however it is opened', () => {
		expect(isFoldedContinuation(' one')).toBe(true);
		expect(isFoldedContinuation('\tone')).toBe(true);
		expect(isFoldedContinuation('SUMMARY:one')).toBe(false);
	});

	it('reports nothing wrong with text that is well formed', () => {
		expect(readIcsLogicalLines(FOLDED)).toEqual({
			lines: ['SUMMARY:a long summary'],
			problem: null,
		});
	});

	it('reads on past a continuation with nothing to continue', () => {
		const reading = readIcsLogicalLines([' orphaned', 'SUMMARY:one']);
		expect(reading.problem).toBe(LEADING_CONTINUATION);
		expect(reading.lines).toEqual([' orphaned', 'SUMMARY:one']);
	});

	it('reports the leading continuation once, whatever follows it', () => {
		const reading = readIcsLogicalLines([' one', ' two']);
		expect(reading.problem).toBe(LEADING_CONTINUATION);
		expect(reading.lines).toEqual([' onetwo']);
	});

	it('throws where the reading reports a problem', () => {
		expect(() => icsLogicalLines([' orphaned'])).toThrow(
			LEADING_CONTINUATION,
		);
	});
});
