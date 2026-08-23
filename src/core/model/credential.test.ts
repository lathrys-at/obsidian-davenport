/**
 * The alphabet that an HTTP Basic header can carry.
 *
 * The header holds the username and the password as base64, and that
 * encoding takes one octet for each character. The CalDAV library reads
 * the same alphabet and throws for a character outside it. These cases
 * therefore state the same answer that the library gives, and the settings
 * refuse a value at entry in the place of a throw at a request.
 */

import { describe, expect, it } from 'vitest';
import { CREDENTIAL_TYPES, fitsBasicAuth } from './credential';

/** The character of one code unit. */
function unit(code: number): string {
	return String.fromCharCode(code);
}

describe('the two credential types', () => {
	it('stand in the order that the settings screen shows', () => {
		expect(CREDENTIAL_TYPES).toEqual(['app-password', 'oauth']);
	});
});

describe('the alphabet of the sign-in header', () => {
	it.each([
		['a text with no characters', ''],
		['the letters and the digits of a keyboard', 'abcXYZ0189'],
		['the marks of a keyboard', '!"#$%&()*+,-./:;<=>?@[]^_{|}~'],
		['a space', 'a b'],
		['the accented letters of the Latin alphabet', 'pässwörd-café-ñ'],
		['the last character of the alphabet', 'ÿ'],
	])('carries %s', (_name, text) => {
		expect(fitsBasicAuth(text)).toBe(true);
	});

	it('carries a control character, as the library does', () => {
		expect(fitsBasicAuth(`a${unit(9)}b`)).toBe(true);
		expect(fitsBasicAuth(unit(0))).toBe(true);
	});

	it.each([
		['the first character above the alphabet', 'Ā'],
		['a letter of another writing system', 'пароль'],
		['a character of a writing system without letters', '密码'],
		['an emoji', 'a😀'],
	])('does not carry %s', (_name, text) => {
		expect(fitsBasicAuth(text)).toBe(false);
	});

	it('does not carry a lone half of a character pair', () => {
		expect(fitsBasicAuth(`a${unit(0xd800)}`)).toBe(false);
	});

	it('reads the whole text, and not the first character alone', () => {
		expect(fitsBasicAuth('abcdefghijĀ')).toBe(false);
	});
});
