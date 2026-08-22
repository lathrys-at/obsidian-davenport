/**
 * The words that the settings screen shows.
 *
 * The point of these cases is the text that states where a password goes.
 * The screen shows that text beside the field that takes the password, and
 * the text changes with the storage that holds the passwords. The warning
 * of the section states what Davenport found, and not a version that
 * Davenport did not read.
 */

import { describe, expect, it } from 'vitest';
import {
	ACCOUNTS_INTRO,
	DATA_FILE_FIELD_NOTE,
	DATA_FILE_WARNING,
	PROBLEMS_NOTE,
	SECRET_STORAGE_FIELD_NOTE,
	removeQuestion,
	tierNote,
	tierWarning,
} from './copy';

describe('the text beside the field of the password', () => {
	it('names the secret storage of Obsidian in one sentence', () => {
		expect(tierNote('secret-storage')).toBe(SECRET_STORAGE_FIELD_NOTE);
		expect(sentences(SECRET_STORAGE_FIELD_NOTE)).toBe(1);
	});

	it('names the data file in one sentence', () => {
		expect(tierNote('data-json')).toBe(DATA_FILE_FIELD_NOTE);
		expect(DATA_FILE_FIELD_NOTE).toContain('plain text');
		expect(sentences(DATA_FILE_FIELD_NOTE)).toBe(1);
	});
});

describe('the warning of the section', () => {
	it('stands for the data file alone', () => {
		expect(tierWarning('data-json')).toBe(DATA_FILE_WARNING);
		expect(tierWarning('secret-storage')).toBeNull();
	});

	it('states what Davenport found, and no version, in its first words', () => {
		expect(
			DATA_FILE_WARNING.startsWith(
				'Davenport found no secret storage in this version of Obsidian.',
			),
		).toBe(true);
	});

	it('names the version of Obsidian in the remedy, under a condition', () => {
		expect(DATA_FILE_WARNING).toContain(
			'If your version of Obsidian is older than 1.11.4, update Obsidian.',
		);
	});
});

describe('the words that ask for an app password', () => {
	it('name the app password in each sentence about it', () => {
		expect(ACCOUNTS_INTRO).toContain('Use an app password.');
		expect(ACCOUNTS_INTRO).toContain(
			'If the app password leaks, you cancel that app password',
		);
	});
});

describe('the words about the entries that Davenport did not read', () => {
	it('state that Davenport keeps each entry and changes none of them', () => {
		expect(PROBLEMS_NOTE).toContain(
			'Davenport keeps each of these entries in the data file, and it changes none of them.',
		);
	});

	it('state no removal of an entry', () => {
		expect(PROBLEMS_NOTE).not.toContain('does not keep');
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

/** The number of sentences of a text. */
function sentences(text: string): number {
	return text.split('. ').length;
}
