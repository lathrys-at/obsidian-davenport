/**
 * The read of the settings out of the data of the file.
 *
 * The point of these cases is the pair of rules that the reader keeps. The
 * reader gives a value back for every input, and it names the entry and
 * the field of every fault. A user who sees one of these problems must see
 * which entry to correct.
 */

import { describe, expect, it } from 'vitest';
import type { SyncedSettings } from '../model/settings';
import { describeSettingsProblem } from './problems';
import { DEFAULT_SETTINGS, readSettings, settingsDocument } from './read';

const ACCOUNT = {
	id: 'caldav-example-com',
	serverUrl: 'https://caldav.example.com/',
	username: 'ren',
	credentialType: 'app-password',
	credentialRef: 'caldav-example-com',
};

const CALENDAR = {
	name: 'Work',
	source: 'caldav',
	accountId: 'caldav-example-com',
	collectionHref: '/dav/calendars/work/',
	mode: 'remote-owned',
	components: ['VEVENT'],
	defaultTimezone: 'Europe/London',
	color: '#336699',
};

/** The words of the first problem of a reading. */
function firstMessage(value: unknown): string {
	const problem = readSettings(value).problems[0];
	if (problem === undefined) {
		throw new Error('the reading states no problem');
	}
	return describeSettingsProblem(problem);
}

describe('the settings of a data file with nothing in it', () => {
	it('gives the empty settings for a file that holds no value', () => {
		expect(readSettings(undefined)).toEqual({
			settings: DEFAULT_SETTINGS,
			problems: [],
		});
		expect(readSettings(null).settings).toEqual(DEFAULT_SETTINGS);
	});

	it('gives the empty settings for a value of another shape', () => {
		const reading = readSettings('the settings');
		expect(reading.settings).toEqual(DEFAULT_SETTINGS);
		expect(reading.problems).toEqual([{ kind: 'not-a-map' }]);
	});

	it('gives an empty list for a section that the settings leave out', () => {
		const reading = readSettings({});
		expect(reading.settings).toEqual(DEFAULT_SETTINGS);
		expect(reading.problems).toEqual([]);
	});
});

describe('the settings that a write left', () => {
	it('reads back the accounts and the calendars of a write', () => {
		const settings: SyncedSettings = readSettings({
			accounts: [ACCOUNT],
			calendars: [CALENDAR],
		}).settings;
		const again = readSettings(settingsDocument(settings));
		expect(again.settings).toEqual(settings);
		expect(again.problems).toEqual([]);
	});

	it('states each field of an account, and no other value', () => {
		const document = settingsDocument({
			accounts: [
				{
					id: 'one',
					serverUrl: 'https://caldav.example.com/',
					username: 'ren',
					credentialType: 'app-password',
					credentialRef: 'one',
				},
			],
			calendars: [],
		});
		expect(document).toEqual({
			accounts: [
				{
					id: 'one',
					serverUrl: 'https://caldav.example.com/',
					username: 'ren',
					credentialType: 'app-password',
					credentialRef: 'one',
				},
			],
			calendars: [],
		});
	});

	it('leaves out a field of a calendar that the entry does not hold', () => {
		const document = settingsDocument({
			accounts: [],
			calendars: [
				{
					name: 'Work',
					source: 'feed',
					collectionHref: 'https://feed.example.com/work.ics',
					mode: 'remote-owned',
					components: ['VEVENT'],
				},
			],
		});
		expect(JSON.stringify(document)).not.toContain('accountId');
		expect(JSON.stringify(document)).not.toContain('color');
	});

	it('passes over a field of the settings that it does not know', () => {
		const reading = readSettings({ accounts: [], routing: ['later'] });
		expect(reading.problems).toEqual([]);
		expect(reading.settings.accounts).toEqual([]);
	});
});

describe('the faults of an account', () => {
	it('names the field that the entry does not hold', () => {
		const reading = readSettings({ accounts: [{ id: 'one' }] });
		expect(reading.settings.accounts).toEqual([]);
		expect(reading.problems).toContainEqual({
			kind: 'entry-field',
			section: 'accounts',
			index: 0,
			name: 'one',
			fault: { kind: 'missing', field: 'serverUrl' },
		});
		expect(firstMessage({ accounts: [{ id: 'one' }] })).toContain(
			'"server URL"',
		);
	});

	it('names a field that holds a value which is not text', () => {
		const reading = readSettings({
			accounts: [{ ...ACCOUNT, username: 12 }],
		});
		expect(reading.problems).toContainEqual({
			kind: 'entry-field',
			section: 'accounts',
			index: 0,
			name: ACCOUNT.id,
			fault: { kind: 'not-text', field: 'username' },
		});
	});

	it('names a field that holds text with no characters', () => {
		const reading = readSettings({
			accounts: [{ ...ACCOUNT, username: '' }],
		});
		expect(reading.problems).toContainEqual({
			kind: 'entry-field',
			section: 'accounts',
			index: 0,
			name: ACCOUNT.id,
			fault: { kind: 'empty', field: 'username' },
		});
	});

	it('refuses an id that holds a character outside its alphabet', () => {
		const reading = readSettings({
			accounts: [{ ...ACCOUNT, id: 'CalDAV Example' }],
		});
		expect(reading.settings.accounts).toEqual([]);
		expect(reading.problems).toContainEqual({
			kind: 'entry-field',
			section: 'accounts',
			index: 0,
			name: 'CalDAV Example',
			fault: { kind: 'alphabet', field: 'id', value: 'CalDAV Example' },
		});
	});

	it('refuses a server address that is not a web address', () => {
		const reading = readSettings({
			accounts: [{ ...ACCOUNT, serverUrl: 'ftp://caldav.example.com/' }],
		});
		expect(reading.settings.accounts).toEqual([]);
		expect(reading.problems).toContainEqual({
			kind: 'entry-field',
			section: 'accounts',
			index: 0,
			name: ACCOUNT.id,
			fault: {
				kind: 'not-a-web-address',
				field: 'serverUrl',
				value: 'ftp://caldav.example.com/',
			},
		});
	});

	it('refuses a server address that carries a username or a password', () => {
		const password = 'planted-app-password-8f3c1d';
		const reading = readSettings({
			accounts: [
				{
					...ACCOUNT,
					serverUrl: `https://ren:${password}@caldav.example.com/`,
				},
			],
		});
		expect(reading.settings.accounts).toEqual([]);
		expect(reading.problems).toEqual([
			{
				kind: 'entry-field',
				section: 'accounts',
				index: 0,
				name: ACCOUNT.id,
				fault: {
					kind: 'credentials-in-address',
					field: 'serverUrl',
				},
			},
		]);
		expect(JSON.stringify(reading.problems)).not.toContain(password);
		expect(
			describeSettingsProblem(
				reading.problems[0] ?? { kind: 'not-a-map' },
			),
		).not.toContain(password);
	});

	it('refuses a credential type that the plugin does not know', () => {
		const reading = readSettings({
			accounts: [{ ...ACCOUNT, credentialType: 'kerberos' }],
		});
		expect(reading.settings.accounts).toEqual([]);
		expect(reading.problems).toContainEqual({
			kind: 'entry-field',
			section: 'accounts',
			index: 0,
			name: ACCOUNT.id,
			fault: {
				kind: 'unknown-value',
				field: 'credentialType',
				value: 'kerberos',
				permitted: ['app-password', 'oauth'],
			},
		});
	});

	it('reads the second account of two, and refuses the first', () => {
		const reading = readSettings({
			accounts: [{ id: 'one' }, { ...ACCOUNT, id: 'two' }],
		});
		expect(reading.settings.accounts.map((held) => held.id)).toEqual([
			'two',
		]);
	});

	it('refuses the second account that holds the id of the first', () => {
		const reading = readSettings({ accounts: [ACCOUNT, ACCOUNT] });
		expect(reading.settings.accounts).toHaveLength(1);
		expect(reading.problems).toContainEqual({
			kind: 'entry-field',
			section: 'accounts',
			index: 1,
			name: ACCOUNT.id,
			fault: { kind: 'repeated', field: 'id', value: ACCOUNT.id },
		});
	});
});

describe('the faults of a section and of an entry', () => {
	it('refuses a section that is not a list', () => {
		const reading = readSettings({ accounts: { one: ACCOUNT } });
		expect(reading.settings.accounts).toEqual([]);
		expect(reading.problems).toEqual([
			{ kind: 'section-not-a-list', section: 'accounts' },
		]);
	});

	it('refuses an entry that is not a set of fields', () => {
		const reading = readSettings({ accounts: ['fastmail'] });
		expect(reading.problems).toEqual([
			{ kind: 'entry-not-a-map', section: 'accounts', index: 0 },
		]);
		expect(firstMessage({ accounts: ['fastmail'] })).toContain('entry 1');
	});
});

describe('the faults of a calendar', () => {
	it('reads an entry of the registry with every field', () => {
		const reading = readSettings({ calendars: [CALENDAR] });
		expect(reading.settings.calendars).toEqual([
			{
				name: 'Work',
				source: 'caldav',
				accountId: 'caldav-example-com',
				collectionHref: '/dav/calendars/work/',
				mode: 'remote-owned',
				components: ['VEVENT'],
				defaultTimezone: 'Europe/London',
				color: '#336699',
			},
		]);
		expect(reading.problems).toEqual([]);
	});

	it('reads an entry that leaves out the fields it can leave out', () => {
		const reading = readSettings({
			calendars: [
				{
					name: 'Feed',
					source: 'feed',
					collectionHref: 'https://feed.example.com/work.ics',
					mode: 'remote-owned',
					components: ['VEVENT', 'VTODO'],
				},
			],
		});
		expect(reading.problems).toEqual([]);
		expect(reading.settings.calendars[0]).toEqual({
			name: 'Feed',
			source: 'feed',
			collectionHref: 'https://feed.example.com/work.ics',
			mode: 'remote-owned',
			components: ['VEVENT', 'VTODO'],
		});
	});

	it('refuses an entry that states no component type', () => {
		const reading = readSettings({
			calendars: [{ ...CALENDAR, components: undefined }],
		});
		expect(reading.problems).toContainEqual({
			kind: 'entry-field',
			section: 'calendars',
			index: 0,
			name: 'Work',
			fault: { kind: 'missing', field: 'components' },
		});
	});

	it('refuses a component type that is not text', () => {
		const reading = readSettings({
			calendars: [{ ...CALENDAR, components: [12] }],
		});
		expect(reading.problems).toContainEqual({
			kind: 'entry-field',
			section: 'calendars',
			index: 0,
			name: 'Work',
			fault: { kind: 'not-text', field: 'components' },
		});
	});

	it('refuses an ownership mode that the plugin does not know', () => {
		const reading = readSettings({
			calendars: [{ ...CALENDAR, mode: 'read-only' }],
		});
		expect(reading.settings.calendars).toEqual([]);
		expect(reading.problems).toContainEqual({
			kind: 'entry-field',
			section: 'calendars',
			index: 0,
			name: 'Work',
			fault: {
				kind: 'unknown-value',
				field: 'mode',
				value: 'read-only',
				permitted: ['vault-owned', 'remote-owned', 'bidirectional'],
			},
		});
	});

	it('refuses component types that are not a list', () => {
		const reading = readSettings({
			calendars: [{ ...CALENDAR, components: 'VEVENT' }],
		});
		expect(reading.problems).toContainEqual({
			kind: 'entry-field',
			section: 'calendars',
			index: 0,
			name: 'Work',
			fault: { kind: 'not-a-list', field: 'components' },
		});
	});

	it('refuses a component type that the plugin does not know', () => {
		const reading = readSettings({
			calendars: [{ ...CALENDAR, components: ['VJOURNAL'] }],
		});
		expect(reading.problems).toContainEqual({
			kind: 'entry-field',
			section: 'calendars',
			index: 0,
			name: 'Work',
			fault: {
				kind: 'unknown-value',
				field: 'components',
				value: 'VJOURNAL',
				permitted: ['VEVENT', 'VTODO'],
			},
		});
	});

	it('refuses a calendar of a feed that holds another mode', () => {
		const reading = readSettings({
			calendars: [
				{
					name: 'Feed',
					source: 'feed',
					collectionHref: 'https://feed.example.com/work.ics',
					mode: 'bidirectional',
					components: ['VEVENT'],
				},
			],
		});
		expect(reading.settings.calendars).toEqual([]);
		expect(reading.problems).toContainEqual({
			kind: 'entry-field',
			section: 'calendars',
			index: 0,
			name: 'Feed',
			fault: {
				kind: 'feed-mode',
				field: 'mode',
				value: 'bidirectional',
			},
		});
	});

	it('takes a calendar of a feed that states the one mode of a feed', () => {
		const reading = readSettings({
			calendars: [
				{
					name: 'Feed',
					source: 'feed',
					collectionHref: 'https://feed.example.com/work.ics',
					mode: 'remote-owned',
					components: ['VEVENT'],
				},
			],
		});
		expect(reading.problems).toEqual([]);
		expect(reading.settings.calendars).toHaveLength(1);
	});

	it('refuses a calendar of a server that names no account', () => {
		const reading = readSettings({
			calendars: [{ ...CALENDAR, accountId: undefined }],
		});
		expect(reading.settings.calendars).toEqual([]);
		expect(reading.problems).toContainEqual({
			kind: 'entry-field',
			section: 'calendars',
			index: 0,
			name: 'Work',
			fault: { kind: 'missing', field: 'accountId' },
		});
	});

	it('refuses a second calendar that holds the name of the first', () => {
		const reading = readSettings({ calendars: [CALENDAR, CALENDAR] });
		expect(reading.settings.calendars).toHaveLength(1);
		expect(reading.problems).toContainEqual({
			kind: 'entry-field',
			section: 'calendars',
			index: 1,
			name: 'Work',
			fault: { kind: 'repeated', field: 'name', value: 'Work' },
		});
	});

	it('refuses an optional field that holds a value which is not text', () => {
		const reading = readSettings({
			calendars: [{ ...CALENDAR, color: 7 }],
		});
		expect(reading.settings.calendars).toEqual([]);
		expect(reading.problems).toContainEqual({
			kind: 'entry-field',
			section: 'calendars',
			index: 0,
			name: 'Work',
			fault: { kind: 'not-text', field: 'color' },
		});
	});
});
