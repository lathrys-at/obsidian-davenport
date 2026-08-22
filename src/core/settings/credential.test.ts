/**
 * The text that the secret store holds for one account.
 *
 * The point of these cases is the form of each credential type. An app
 * password is the password itself. An OAuth credential is one JSON
 * document that states each of its three values.
 */

import { describe, expect, it } from 'vitest';
import { encodeCredential } from './credential';

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
