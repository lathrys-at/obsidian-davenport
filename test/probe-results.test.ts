/**
 * The two parts of the probe's results module that decide what the owner
 * reads and what a second run keeps: how a thrown value is worded, and the
 * name a results file takes when one is already there.
 *
 * Both are pure, so they are testable here even though the run around them
 * only exists inside a vault.
 */

import { describe, expect, it } from 'vitest';
import {
	NAME_ATTEMPTS,
	describeError,
	resultsPath,
} from '../tools/a11-probe/results';

const NOW = new Date('2026-08-12T09:14:03.500Z');

describe('saying what went wrong', () => {
	it('keeps a name that says which writer refused', () => {
		const error = new Error('no end to the flow sequence');
		error.name = 'YAMLParseError';
		expect(describeError(error)).toBe(
			'YAMLParseError: no end to the flow sequence',
		);
	});

	// The notice already says the probe failed, so a bare Error in front of
	// its own message is a word the reader has to look past.
	it('drops the bare word Error in front of its own message', () => {
		expect(describeError(new Error('the folder is a note'))).toBe(
			'the folder is a note',
		);
	});

	it('falls back to the name when there is no message', () => {
		expect(describeError(new Error(''))).toBe('Error');
	});

	it('takes a thrown string as it is', () => {
		expect(describeError('a rejection with no error')).toBe(
			'a rejection with no error',
		);
	});

	it('says what it was handed when it was not an error at all', () => {
		expect(describeError({ code: 7 })).toBe('a thrown object');
		expect(describeError(undefined)).toBe('a thrown undefined');
	});
});

describe('naming the results file', () => {
	const never = (): boolean => false;

	it('names it for the instant the run finished', () => {
		expect(resultsPath('probe', NOW, never)).toBe(
			'probe/emission-samples-20260812-091403Z.json',
		);
	});

	it('steps past a name a run in the same second already took', () => {
		const taken = new Set(['probe/emission-samples-20260812-091403Z.json']);
		expect(resultsPath('probe', NOW, (path) => taken.has(path))).toBe(
			'probe/emission-samples-20260812-091403Z-2.json',
		);
	});

	it('keeps stepping while the names are taken', () => {
		let free = '';
		const path = resultsPath('probe', NOW, (candidate) => {
			free = candidate;
			return (
				candidate !== 'probe/emission-samples-20260812-091403Z-7.json'
			);
		});
		expect(path).toBe('probe/emission-samples-20260812-091403Z-7.json');
		expect(free).toBe(path);
	});

	it('gives up rather than overwriting when every name is taken', () => {
		const tried: string[] = [];
		expect(() =>
			resultsPath('probe', NOW, (candidate) => {
				tried.push(candidate);
				return true;
			}),
		).toThrow('already holds every name this run tried');
		expect(tried).toHaveLength(NAME_ATTEMPTS);
	});
});
