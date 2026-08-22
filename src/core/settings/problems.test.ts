/**
 * The words that state a problem of the settings to the user.
 *
 * The point of these cases is the pair that each message carries: the
 * entry that the plugin refused, and the field that holds the wrong value.
 * A user who reads one of these messages must know where to look, because
 * the plugin corrects nothing by itself.
 */

import { describe, expect, it } from 'vitest';
import type { FieldFault, SettingsProblem } from './problems';
import {
	describeFieldFault,
	describeSettingsProblem,
	nameFieldFault,
} from './problems';

const FAULTS: readonly FieldFault[] = [
	{ kind: 'missing', field: 'serverUrl' },
	{ kind: 'not-text', field: 'username' },
	{ kind: 'empty', field: 'password' },
	{ kind: 'not-a-list', field: 'components' },
	{
		kind: 'unknown-value',
		field: 'mode',
		value: 'read-only',
		permitted: ['vault-owned', 'remote-owned'],
	},
	{
		kind: 'not-a-web-address',
		field: 'serverUrl',
		value: 'ftp://example.com/',
	},
	{ kind: 'alphabet', field: 'id', value: 'CalDAV' },
	{ kind: 'repeated', field: 'name', value: 'Work' },
	{ kind: 'credentials-in-address', field: 'serverUrl' },
	{ kind: 'feed-mode', field: 'mode', value: 'bidirectional' },
];

describe('the words of a fault of a field', () => {
	it('name the field of every fault', () => {
		expect(FAULTS.map(describeFieldFault)).toEqual([
			'The entry has no field "server URL". Add that field.',
			'The field "username" holds a value that is not text. Write text there.',
			'The field "app password" holds no characters. Give that field a value.',
			'The field "component types" holds a value that is not a list. Write a list there.',
			'The field "ownership mode" holds "read-only". That field takes one of these values: vault-owned, remote-owned.',
			'The field "server URL" holds "ftp://example.com/". Write a web address that starts with https:// or http://.',
			'The field "account id" holds "CalDAV". That field takes lowercase letters, digits, and dashes.',
			'The field "name" holds "Work". Another entry holds that value. Give each entry a value of its own.',
			'The field "server URL" holds a username or a password before the name of the server. Write the address of the server alone. Give the username in the field "username". Give the app password in the field "app password".',
			'The field "ownership mode" holds "bidirectional". A calendar of a feed takes the mode "remote-owned" alone, because Davenport writes to no feed.',
		]);
	});

	it('quote no part of an address that carries a credential', () => {
		const address = 'https://ren:planted-app-password-8f3c1d@dav.test/';
		const message = describeFieldFault({
			kind: 'credentials-in-address',
			field: 'serverUrl',
		});
		expect(message).not.toContain('planted-app-password-8f3c1d');
		expect(message).not.toContain(address);
	});

	it('name each field of an account and of a calendar', () => {
		const fields: readonly FieldFault[] = [
			{ kind: 'missing', field: 'credentialType' },
			{ kind: 'missing', field: 'credentialRef' },
			{ kind: 'missing', field: 'accountId' },
			{ kind: 'missing', field: 'source' },
			{ kind: 'missing', field: 'collectionHref' },
			{ kind: 'missing', field: 'defaultTimezone' },
			{ kind: 'missing', field: 'color' },
		];
		expect(fields.map(describeFieldFault)).toEqual([
			'The entry has no field "credential type". Add that field.',
			'The entry has no field "credential reference". Add that field.',
			'The entry has no field "account". Add that field.',
			'The entry has no field "source". Add that field.',
			'The entry has no field "collection address". Add that field.',
			'The entry has no field "default timezone". Add that field.',
			'The entry has no field "color". Add that field.',
		]);
	});
});

describe('the name of a fault, for the log', () => {
	it('holds the field and the kind, and holds no value', () => {
		expect(FAULTS.map(nameFieldFault)).toEqual([
			'serverUrl missing',
			'username not-text',
			'password empty',
			'components not-a-list',
			'mode unknown-value',
			'serverUrl not-a-web-address',
			'id alphabet',
			'name repeated',
			'serverUrl credentials-in-address',
			'mode feed-mode',
		]);
	});

	it('states no value that a user typed', () => {
		const password = 'planted-app-password-8f3c1d';
		expect(
			nameFieldFault({
				kind: 'not-a-web-address',
				field: 'serverUrl',
				value: password,
			}),
		).toBe('serverUrl not-a-web-address');
	});
});

describe('the words of a problem of the settings', () => {
	it('state that the plugin starts again where the settings are of another shape', () => {
		expect(describeSettingsProblem({ kind: 'not-a-map' })).toBe(
			'The data file holds settings of another shape. The plugin starts with empty settings. Davenport writes the settings again and does not keep that value.',
		);
	});

	it('name the section that is not a list', () => {
		const problems: readonly SettingsProblem[] = [
			{ kind: 'section-not-a-list', section: 'accounts' },
			{ kind: 'section-not-a-list', section: 'calendars' },
		];
		expect(problems.map(describeSettingsProblem)).toEqual([
			'The settings hold the accounts as a value that is not a list. The plugin reads no entry there. Davenport writes this section again and does not keep that value.',
			'The settings hold the calendars as a value that is not a list. The plugin reads no entry there. Davenport writes this section again and does not keep that value.',
		]);
	});

	it('count the entry from one where the entry states no name', () => {
		expect(
			describeSettingsProblem({
				kind: 'entry-not-a-map',
				section: 'accounts',
				index: 1,
			}),
		).toBe(
			'Davenport did not read entry 2 of the accounts. That entry is not a set of fields.',
		);
	});

	it('name the entry where the entry states a name', () => {
		expect(
			describeSettingsProblem({
				kind: 'entry-field',
				section: 'calendars',
				index: 0,
				name: 'Work',
				fault: { kind: 'empty', field: 'collectionHref' },
			}),
		).toBe(
			'Davenport did not read the calendar "Work". The field "collection address" holds no characters. Give that field a value.',
		);
	});

	it('count the entry from one where the field of the name holds a fault', () => {
		expect(
			describeSettingsProblem({
				kind: 'entry-field',
				section: 'accounts',
				index: 2,
				name: null,
				fault: { kind: 'missing', field: 'id' },
			}),
		).toBe(
			'Davenport did not read entry 3 of the accounts. The entry has no field "account id". Add that field.',
		);
	});
});
