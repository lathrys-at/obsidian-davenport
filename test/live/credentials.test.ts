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

describe('live credential variable names', () => {
	it('names three variables per provider under one prefix', () => {
		expect(variableNames('baikal')).toStrictEqual({
			url: 'DAVENPORT_TEST_BAIKAL_URL',
			username: 'DAVENPORT_TEST_BAIKAL_USERNAME',
			secret: 'DAVENPORT_TEST_BAIKAL_SECRET',
		});
		const everyName = LIVE_PROVIDERS.flatMap(namesOf);
		expect(new Set(everyName).size).toBe(LIVE_PROVIDERS.length * 3);
	});
});

describe('live credential lookup', () => {
	it('resolves a provider whose three variables are set', () => {
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

	it('reports an empty environment as unavailable, not an error', () => {
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

	it('treats a blank variable as unset', () => {
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

	it('trims the url and username and keeps the secret verbatim', () => {
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

	it('ignores what an environment record inherits', () => {
		const inherited = Object.create(complete) as Record<string, string>;
		expect(availableProviders(inherited)).toStrictEqual([]);
		expect(lookupCredentials('radicale', inherited)).toStrictEqual({
			available: false,
			missing: namesOf('radicale'),
		});
	});

	it('reads only its own provider from a shared environment', () => {
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

describe('required live credentials', () => {
	it('names the unset variables and quotes no value', () => {
		const secret = 'super-secret-value';
		const attempt = (): unknown =>
			requireCredentials('icloud', {
				DAVENPORT_TEST_ICLOUD_SECRET: secret,
			});
		expect(attempt).toThrow(
			'No live credentials for icloud; unset: DAVENPORT_TEST_ICLOUD_URL, DAVENPORT_TEST_ICLOUD_USERNAME',
		);
		expect(attempt).not.toThrow(secret);
	});

	it('returns the credentials when they are all there', () => {
		expect(requireCredentials('radicale', complete).username).toBe(
			'davenport',
		);
	});
});
