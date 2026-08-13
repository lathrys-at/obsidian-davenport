import { describe, expect, it } from 'vitest';
import {
	LIVE_PROVIDERS,
	type LiveProvider,
	availableProviders,
	lookupCredentials,
	requireCredentials,
	variableNames,
} from './credentials';

const complete = {
	DAVENPORT_TEST_RADICALE_URL: 'http://localhost:5232/',
	DAVENPORT_TEST_RADICALE_USERNAME: 'davenport',
	DAVENPORT_TEST_RADICALE_SECRET: 'davenport',
};

function namesOf(provider: LiveProvider): string[] {
	const names = variableNames(provider);
	return [names.url, names.username, names.secret];
}

describe('names of the live credential variables', () => {
	it('gives each provider three variable names under one prefix', () => {
		expect(variableNames('baikal')).toStrictEqual({
			url: 'DAVENPORT_TEST_BAIKAL_URL',
			username: 'DAVENPORT_TEST_BAIKAL_USERNAME',
			secret: 'DAVENPORT_TEST_BAIKAL_SECRET',
		});
		const everyName = LIVE_PROVIDERS.flatMap(namesOf);
		expect(new Set(everyName).size).toBe(LIVE_PROVIDERS.length * 3);
	});
});

describe('lookup of live credentials', () => {
	it('returns the credentials of a provider when all three variables are set', () => {
		expect(lookupCredentials('radicale', complete)).toStrictEqual({
			available: true,
			credentials: {
				provider: 'radicale',
				url: 'http://localhost:5232/',
				username: 'davenport',
				secret: 'davenport',
			},
		});
	});

	it('reports every provider as unavailable in an empty environment, and does not throw', () => {
		for (const provider of LIVE_PROVIDERS) {
			const lookup = lookupCredentials(provider, {});
			expect(lookup.available).toBe(false);
			expect(lookup).toStrictEqual({
				available: false,
				missing: namesOf(provider),
			});
		}
		expect(availableProviders({})).toStrictEqual([]);
	});

	it('treats a variable that holds only whitespace as unset', () => {
		expect(
			lookupCredentials('radicale', {
				...complete,
				DAVENPORT_TEST_RADICALE_SECRET: '   ',
			}),
		).toStrictEqual({
			available: false,
			missing: ['DAVENPORT_TEST_RADICALE_SECRET'],
		});
	});

	it('trims the url and the username, and keeps the secret unchanged', () => {
		const lookup = lookupCredentials('radicale', {
			DAVENPORT_TEST_RADICALE_URL: ' http://localhost:5232/\n',
			DAVENPORT_TEST_RADICALE_USERNAME: '\tdavenport ',
			DAVENPORT_TEST_RADICALE_SECRET: ' pass phrase ',
		});
		expect(lookup).toStrictEqual({
			available: true,
			credentials: {
				provider: 'radicale',
				url: 'http://localhost:5232/',
				username: 'davenport',
				secret: ' pass phrase ',
			},
		});
	});

	it('ignores a value that an environment record inherits', () => {
		const inherited = Object.create(complete) as Record<string, string>;
		expect(availableProviders(inherited)).toStrictEqual([]);
		expect(lookupCredentials('radicale', inherited)).toStrictEqual({
			available: false,
			missing: namesOf('radicale'),
		});
	});

	it('reads only the variables of the provider that the caller names', () => {
		const shared = {
			...complete,
			DAVENPORT_TEST_BAIKAL_URL: 'http://localhost:8801/dav.php/',
			DAVENPORT_TEST_BAIKAL_USERNAME: 'davenport',
		};
		expect(availableProviders(shared)).toStrictEqual(['radicale']);
		expect(lookupCredentials('baikal', shared)).toStrictEqual({
			available: false,
			missing: ['DAVENPORT_TEST_BAIKAL_SECRET'],
		});
	});
});

describe('live credentials that a caller requires', () => {
	it('names the variables that are not set, and puts no value in the error', () => {
		const secret = 'super-secret-value';
		const attempt = (): unknown =>
			requireCredentials('icloud', {
				DAVENPORT_TEST_ICLOUD_SECRET: secret,
			});
		expect(attempt).toThrow(
			'The environment has no live credentials for icloud. Set these variables: DAVENPORT_TEST_ICLOUD_URL, DAVENPORT_TEST_ICLOUD_USERNAME',
		);
		expect(attempt).not.toThrow(secret);
	});

	it('returns the credentials and does not throw when all three variables are set', () => {
		expect(requireCredentials('radicale', complete).username).toBe(
			'davenport',
		);
	});
});
