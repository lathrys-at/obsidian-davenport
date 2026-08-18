/**
 * Tests for the two decisions that the results module of the probe makes.
 * The first decision is how the module puts a thrown value into words. The
 * owner of the vault reads these words. The second decision is the name
 * that a results file takes when a file of that name is already there.
 * That name decides what a second run keeps.
 *
 * Both functions are pure: the caller supplies everything that the
 * functions read, and the functions touch no platform. Therefore these
 * tests call the functions directly. The probe run around the functions
 * exists only inside a vault.
 */

import { describe, expect, it } from 'vitest';
import {
	NAME_ATTEMPTS,
	describeError,
	resultsPath,
} from '../tools/frontmatter-probe/results';

const NOW = new Date('2026-08-12T09:14:03.500Z');

describe('putting a thrown value into words', () => {
	it('keeps a name in front of the message when the name tells which writer refused', () => {
		const error = new Error('no end to the flow sequence');
		error.name = 'YAMLParseError';
		expect(describeError(error)).toBe(
			'YAMLParseError: no end to the flow sequence',
		);
	});

	// The notice already says that the probe failed. Thus the bare name
	// Error in front of the message adds nothing, and the reader must look
	// past that name.
	it('drops the bare name Error and keeps only the message', () => {
		expect(describeError(new Error('the folder is a note'))).toBe(
			'the folder is a note',
		);
	});

	it('gives the name when the error has no message', () => {
		expect(describeError(new Error(''))).toBe('Error');
	});

	it('gives back a thrown string without a change', () => {
		expect(describeError('a rejection with no error')).toBe(
			'a rejection with no error',
		);
	});

	it('names the type when the thrown value is not an error and not a string', () => {
		expect(describeError({ code: 7 })).toBe('a thrown object');
		expect(describeError(undefined)).toBe('a thrown undefined');
	});
});

describe('naming the results file', () => {
	const never = (): boolean => false;

	it('names the file for the instant when the run finished', () => {
		expect(resultsPath('probe', NOW, never)).toBe(
			'probe/emission-samples-20260812-091403Z.json',
		);
	});

	it('steps past a name that another run in the same second already took', () => {
		const taken = new Set(['probe/emission-samples-20260812-091403Z.json']);
		expect(resultsPath('probe', NOW, (path) => taken.has(path))).toBe(
			'probe/emission-samples-20260812-091403Z-2.json',
		);
	});

	it('keeps stepping while each new name is also taken', () => {
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

	it('throws instead of overwriting a file when every name is taken', () => {
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
