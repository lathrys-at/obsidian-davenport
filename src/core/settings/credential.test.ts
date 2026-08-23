/**
 * The text that the secret store holds for one account.
 *
 * The point of these cases is the form of each credential type. An app
 * password is the password itself. An OAuth credential is one JSON
 * document that states each of its three values.
 *
 * The reader takes the type from the account. A store can hold a text that
 * another version of the plugin wrote, and a user can write that text by
 * hand into the data file, so the reader refuses a text of another shape.
 */

import { describe, expect, it } from 'vitest';
import { decodeCredential, encodeCredential } from './credential';

const PASSWORD = 'correct-horse-battery-staple';

const TOKENS = {
	clientId: 'client-id-value',
	clientSecret: 'client-secret-value',
	refreshToken: 'refresh-token-value',
};

describe('the text of a credential', () => {
	it('holds the app password itself', () => {
		expect(
			encodeCredential({ type: 'app-password', password: PASSWORD }),
		).toBe(PASSWORD);
	});

	it('states the three values of an OAuth credential', () => {
		const text = encodeCredential({ type: 'oauth', tokens: TOKENS });
		expect(JSON.parse(text)).toEqual(TOKENS);
	});

	it('writes the three values in one order', () => {
		const first = encodeCredential({ type: 'oauth', tokens: TOKENS });
		const again = encodeCredential({
			type: 'oauth',
			tokens: {
				refreshToken: TOKENS.refreshToken,
				clientSecret: TOKENS.clientSecret,
				clientId: TOKENS.clientId,
			},
		});
		expect(again).toBe(first);
	});
});

describe('the credential that a text states', () => {
	it('reads an app password back', () => {
		expect(decodeCredential('app-password', PASSWORD)).toEqual({
			type: 'app-password',
			password: PASSWORD,
		});
	});

	it('states no app password for a text with no characters', () => {
		expect(decodeCredential('app-password', '')).toBeNull();
	});

	it('reads the three OAuth values back', () => {
		expect(
			decodeCredential(
				'oauth',
				encodeCredential({ type: 'oauth', tokens: TOKENS }),
			),
		).toEqual({ type: 'oauth', tokens: TOKENS });
	});

	it('states no credential for a text that is not JSON', () => {
		expect(decodeCredential('oauth', PASSWORD)).toBeNull();
	});

	it('states no credential for JSON that is not a set of named values', () => {
		expect(decodeCredential('oauth', '"a string"')).toBeNull();
		expect(decodeCredential('oauth', 'null')).toBeNull();
	});

	it.each(['clientId', 'clientSecret', 'refreshToken'])(
		'states no credential where the text holds no %s',
		(missing) => {
			const held = Object.fromEntries(
				Object.entries(TOKENS).filter(([key]) => key !== missing),
			);
			expect(decodeCredential('oauth', JSON.stringify(held))).toBeNull();
		},
	);

	it('states no credential where one value is not text', () => {
		expect(
			decodeCredential(
				'oauth',
				JSON.stringify({ ...TOKENS, refreshToken: 7 }),
			),
		).toBeNull();
	});
});
