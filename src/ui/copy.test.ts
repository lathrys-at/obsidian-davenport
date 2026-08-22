/**
 * The words that the settings screen shows.
 *
 * The point of these cases is the text that states where a password goes.
 * The screen shows that text beside the field that takes the password, and
 * the text changes with the storage that holds the passwords.
 */

import { describe, expect, it } from 'vitest';
import {
	DATA_FILE_WARNING,
	SECRET_STORAGE_NOTE,
	removeQuestion,
	tierNote,
	tierWarning,
} from './copy';

describe('the text beside the field of the password', () => {
	it('names the secret storage of Obsidian', () => {
		expect(tierNote('secret-storage')).toBe(SECRET_STORAGE_NOTE);
	});

	it('warns where the data file holds the passwords', () => {
		expect(tierNote('data-json')).toBe(DATA_FILE_WARNING);
	});

	it('gives the warning of the section for that storage alone', () => {
		expect(tierWarning('data-json')).toBe(DATA_FILE_WARNING);
		expect(tierWarning('secret-storage')).toBeNull();
	});

	it('names the version of Obsidian that holds the secret storage', () => {
		expect(DATA_FILE_WARNING).toContain('1.11.4');
	});
});

describe('the question before a removal', () => {
	it('names the account and states what the removal takes', () => {
		const question = removeQuestion('ren', 'https://caldav.example.com/');
		expect(question).toContain('"ren"');
		expect(question).toContain('https://caldav.example.com/');
		expect(question).toContain('app password');
		expect(question).toContain('changes nothing on the server');
	});
});
