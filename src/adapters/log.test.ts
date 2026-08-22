/**
 * The sync log of the session.
 *
 * The point of these cases is the limit. A log that grows without a limit
 * takes memory that a phone does not have, so the oldest entry goes when
 * the log is full.
 */

import { describe, expect, it } from 'vitest';
import type { SyncLogEntry } from '../core/ports/logger';
import { MemoryLog } from './log';

function entry(item: string): SyncLogEntry {
	return { time: 1, action: 'add account', item, outcome: 'success' };
}

describe('the log in memory', () => {
	it('keeps the entries in the order of the calls', () => {
		const log = new MemoryLog();
		log.log(entry('one'));
		log.log(entry('two'));
		expect(log.entries.map((held) => held.item)).toEqual(['one', 'two']);
	});

	it('drops the oldest entry when the log is full', () => {
		const log = new MemoryLog(2);
		log.log(entry('one'));
		log.log(entry('two'));
		log.log(entry('three'));
		expect(log.entries.map((held) => held.item)).toEqual(['two', 'three']);
	});

	it('holds one entry where the caller states a limit below one', () => {
		const log = new MemoryLog(0);
		log.log(entry('one'));
		log.log(entry('two'));
		expect(log.entries.map((held) => held.item)).toEqual(['two']);
	});

	it('gives a list that a caller cannot change', () => {
		const log = new MemoryLog();
		log.log(entry('one'));
		const first = log.entries;
		log.log(entry('two'));
		expect(first).toHaveLength(1);
	});
});
