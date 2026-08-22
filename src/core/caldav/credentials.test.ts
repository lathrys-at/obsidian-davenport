/**
 * The headers that sign a request to a calendar server.
 *
 * The header of an app password carries the username and the password in
 * an alphabet of one octet for each character. A user can hold a password
 * that this alphabet cannot carry, because the plugin took that password
 * before it held this rule. These cases state what happens then: the
 * plugin names the condition, and it builds no header.
 */

import { describe, expect, it } from 'vitest';
import { basicHeaders, bearerHeaders, signRequests } from './credentials';

const TOKENS = {
	clientId: 'client',
	clientSecret: 'secret',
	refreshToken: 'refresh',
};

describe('the headers of one credential', () => {
	it('writes the username and the password as one Basic header', () => {
		expect(basicHeaders('user', 'password')).toEqual({
			authorization: 'Basic dXNlcjpwYXNzd29yZA==',
		});
	});

	it('writes an access token as one Bearer header', () => {
		expect(bearerHeaders('token-value')).toEqual({
			authorization: 'Bearer token-value',
		});
	});
});

describe('the signing of one account', () => {
	it('signs an app-password account with a Basic header', () => {
		const signing = signRequests('user', {
			type: 'app-password',
			password: 'password',
		});
		expect(signing).toEqual({
			ok: true,
			headers: { authorization: 'Basic dXNlcjpwYXNzd29yZA==' },
		});
	});

	it('signs a password of accented letters, which the alphabet holds', () => {
		const signing = signRequests('user', {
			type: 'app-password',
			password: 'pässwörd',
		});
		expect(signing.ok).toBe(true);
	});

	it('names the alphabet where the password stands outside it', () => {
		expect(
			signRequests('user', { type: 'app-password', password: 'пароль' }),
		).toEqual({ ok: false, gap: 'credential-alphabet' });
	});

	it('names the alphabet where the username stands outside it', () => {
		expect(
			signRequests('пользователь', {
				type: 'app-password',
				password: 'password',
			}),
		).toEqual({ ok: false, gap: 'credential-alphabet' });
	});

	it('names the alphabet for a character above the two-octet forms', () => {
		expect(
			signRequests('user', {
				type: 'app-password',
				password: 'a\u{1f600}',
			}),
		).toEqual({ ok: false, gap: 'credential-alphabet' });
	});

	it('names the missing token flow for an OAuth account', () => {
		expect(signRequests('user', { type: 'oauth', tokens: TOKENS })).toEqual(
			{
				ok: false,
				gap: 'no-token-flow',
			},
		);
	});

	it('builds no header where it names a gap', () => {
		const signing = signRequests('user', {
			type: 'app-password',
			password: 'пароль',
		});
		expect('headers' in signing).toBe(false);
	});
});
