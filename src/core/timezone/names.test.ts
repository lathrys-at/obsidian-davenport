import { describe, expect, it } from 'vitest';
import {
	checkTimezoneName,
	isKnownTimezoneName,
	knownTimezoneNames,
} from './names';

describe('the check of a timezone name', () => {
	it('takes a name that the bundled table holds', () => {
		expect(checkTimezoneName('Europe/Berlin')).toEqual({
			ok: true,
			name: 'Europe/Berlin',
		});
	});

	it('gives back the name that the caller wrote', () => {
		for (const name of [
			'Asia/Calcutta',
			'Asia/Kolkata',
			'Europe/Kiev',
			'Europe/Kyiv',
			'UTC',
			'Etc/GMT+5',
		]) {
			const result = checkTimezoneName(name);
			expect(result.ok, `the table does not hold ${name}`).toBe(true);
			expect(result.ok && result.name).toBe(name);
		}
	});

	it('refuses a name that the bundled table does not hold', () => {
		expect(checkTimezoneName('Europe/Berlin/')).toEqual({
			ok: false,
			failure: 'unknown',
		});
		expect(checkTimezoneName('europe/berlin')).toEqual({
			ok: false,
			failure: 'unknown',
		});
	});

	it('refuses an empty name', () => {
		expect(checkTimezoneName('')).toEqual({ ok: false, failure: 'empty' });
	});

	it('takes the names that the list of a device leaves out', () => {
		// The list that a device supplies rejects these names, and the
		// database of the release states every one of them.
		for (const name of ['Asia/Calcutta', 'Europe/Kiev', 'UTC', 'GMT']) {
			expect(isKnownTimezoneName(name), name).toBe(true);
		}
	});
});

describe('the list of timezone names', () => {
	it('holds every identifier of the release', () => {
		expect(knownTimezoneNames().length).toBe(598);
	});

	it('holds the names in order and holds no name two times', () => {
		const names = knownTimezoneNames();
		expect([...names].sort()).toEqual([...names]);
		expect(new Set(names).size).toBe(names.length);
	});

	it('takes every name that it holds', () => {
		for (const name of knownTimezoneNames()) {
			expect(isKnownTimezoneName(name), name).toBe(true);
		}
	});
});
