/**
 * The text that the secret store holds for one account.
 *
 * The point of these cases is the way back: the text that the store held
 * gives the same credential again. The cases also hold the rule that no
 * message about a credential quotes the credential.
 */

import { describe, expect, it } from 'vitest';
import type { CredentialFault } from './credential';
import {
	decodeCredential,
	describeCredentialFault,
	encodeCredential,
} from './credential';

const PASSWORD = 'correct-horse-battery-staple';

const TOKENS = {
	clientId: 'client-id-value',
	clientSecret: 'client-secret-value',
	refreshToken: 'refresh-token-value',
};

/** The fault of a reading, or a failure where the reading succeeded. */
function faultOf(
	type: 'app-password' | 'oauth',
	text: string,
): CredentialFault {
	const reading = decodeCredential(type, text);
	if (reading.ok) {
		throw new Error('the reading states no fault');
	}
	return reading.fault;
}

describe('the credential of an app password', () => {
	it('holds the password itself', () => {
		expect(
			encodeCredential({ type: 'app-password', password: PASSWORD }),
		).toBe(PASSWORD);
	});

	it('reads the password back', () => {
		expect(decodeCredential('app-password', PASSWORD)).toEqual({
			ok: true,
			credential: { type: 'app-password', password: PASSWORD },
		});
	});

	it('states a fault for a text with no characters', () => {
		expect(faultOf('app-password', '')).toEqual({ kind: 'empty' });
	});
});

describe('the credential of an OAuth account', () => {
	it('reads the three values back', () => {
		const text = encodeCredential({ type: 'oauth', tokens: TOKENS });
		expect(decodeCredential('oauth', text)).toEqual({
			ok: true,
			credential: { type: 'oauth', tokens: TOKENS },
		});
	});

	it('states a fault for a text that is not a JSON document', () => {
		expect(faultOf('oauth', 'not a document')).toEqual({
			kind: 'not-a-document',
		});
		expect(faultOf('oauth', '["one"]')).toEqual({ kind: 'not-a-document' });
		expect(faultOf('oauth', 'null')).toEqual({ kind: 'not-a-document' });
	});

	it('names the field that the document does not hold', () => {
		expect(faultOf('oauth', JSON.stringify({}))).toEqual({
			kind: 'field',
			field: 'clientId',
		});
		expect(
			faultOf('oauth', JSON.stringify({ ...TOKENS, clientSecret: '' })),
		).toEqual({ kind: 'field', field: 'clientSecret' });
		expect(
			faultOf('oauth', JSON.stringify({ ...TOKENS, refreshToken: 12 })),
		).toEqual({ kind: 'field', field: 'refreshToken' });
	});
});

describe('the words of a fault of a credential', () => {
	it('name the field and quote no value', () => {
		const messages = [
			describeCredentialFault({ kind: 'empty' }),
			describeCredentialFault({ kind: 'not-a-document' }),
			describeCredentialFault({ kind: 'field', field: 'refreshToken' }),
		];
		expect(messages[2]).toContain('refresh token');
		for (const message of messages) {
			expect(message).not.toContain(PASSWORD);
			expect(message).not.toContain(TOKENS.refreshToken);
		}
	});
});
