/**
 * The layout of the data file.
 *
 * The point of these cases is the boundary between the two keys of the
 * file. The settings never carry a credential, and a write of one key
 * leaves the other key as it stands. The cases also hold the rule that a
 * write keeps every key that the plugin does not own, because a data file
 * travels between devices and between versions of the plugin.
 */

import { describe, expect, it } from 'vitest';
import { FakePluginData } from '../../test/harness/obsidian-fake';
import type { SyncedSettings } from '../core/model/settings';
import {
	PluginDataStore,
	SECRET_FALLBACK_KEY,
	SETTINGS_KEY,
} from './plugin-data';

const SETTINGS: SyncedSettings = {
	accounts: [
		{
			id: 'caldav-example-com',
			serverUrl: 'https://caldav.example.com/',
			username: 'ren',
			credentialType: 'app-password',
			credentialRef: 'caldav-example-com',
		},
	],
	calendars: [],
};

/** The value of the data file, as a set of named values. */
function documentOf(data: FakePluginData): Record<string, unknown> {
	return data.value as Record<string, unknown>;
}

describe('the settings in the data file', () => {
	it('reads the settings that a write left', async () => {
		const data = new FakePluginData();
		const store = new PluginDataStore(data);
		await store.write(SETTINGS);
		const reading = await store.read();
		expect(reading.settings).toEqual(SETTINGS);
		expect(reading.problems).toEqual([]);
	});

	it('gives the empty settings where the file holds none', async () => {
		const store = new PluginDataStore(new FakePluginData());
		const reading = await store.read();
		expect(reading.settings).toEqual({ accounts: [], calendars: [] });
		expect(reading.problems).toEqual([]);
	});

	it('keeps a key of the file that the plugin does not own', async () => {
		const data = new FakePluginData({ version: 4, notes: ['keep me'] });
		await new PluginDataStore(data).write(SETTINGS);
		const document = documentOf(data);
		expect(document.version).toBe(4);
		expect(document.notes).toEqual(['keep me']);
	});

	it('keeps a field of the settings that the reader does not know', async () => {
		const data = new FakePluginData({
			[SETTINGS_KEY]: { accounts: [], routing: ['later'] },
		});
		const store = new PluginDataStore(data);
		await store.write(SETTINGS);
		const settings = documentOf(data)[SETTINGS_KEY] as Record<
			string,
			unknown
		>;
		expect(settings.routing).toEqual(['later']);
		expect(settings.accounts).toHaveLength(1);
	});

	it('keeps a field of an entry that the reader does not know', async () => {
		const data = new FakePluginData({
			[SETTINGS_KEY]: {
				accounts: [
					{
						...SETTINGS.accounts[0],
						futureField: 'set by a newer plugin version',
					},
				],
				calendars: [],
			},
		});
		const store = new PluginDataStore(data);
		const reading = await store.read();
		await store.write(reading.settings);
		const settings = documentOf(data)[SETTINGS_KEY] as Record<
			string,
			unknown
		>;
		expect(settings.accounts).toEqual([
			{
				...SETTINGS.accounts[0],
				futureField: 'set by a newer plugin version',
			},
		]);
	});

	it('writes the value of the plugin over the value of the file', async () => {
		const data = new FakePluginData({
			[SETTINGS_KEY]: {
				accounts: [
					{ ...SETTINGS.accounts[0], username: 'someone else' },
				],
			},
		});
		const store = new PluginDataStore(data);
		await store.write(SETTINGS);
		const settings = documentOf(data)[SETTINGS_KEY] as Record<
			string,
			unknown
		>;
		expect(settings.accounts).toEqual([SETTINGS.accounts[0]]);
	});

	it('keeps a field of a calendar of the file under the name of that calendar', async () => {
		const calendar = {
			name: 'Work',
			source: 'feed',
			collectionHref: 'https://feed.example.com/work.ics',
			mode: 'remote-owned',
			components: ['VEVENT'],
		};
		const data = new FakePluginData({
			[SETTINGS_KEY]: {
				accounts: [],
				calendars: [{ ...calendar, futureField: 'later' }],
			},
		});
		const store = new PluginDataStore(data);
		const reading = await store.read();
		await store.write(reading.settings);
		const settings = documentOf(data)[SETTINGS_KEY] as Record<
			string,
			unknown
		>;
		expect(settings.calendars).toEqual([
			{ ...calendar, futureField: 'later' },
		]);
	});

	it('writes the entries where the file holds a section of another shape', async () => {
		const data = new FakePluginData({
			[SETTINGS_KEY]: { accounts: { one: 'not a list' } },
		});
		const store = new PluginDataStore(data);
		await store.write(SETTINGS);
		const settings = documentOf(data)[SETTINGS_KEY] as Record<
			string,
			unknown
		>;
		expect(settings.accounts).toEqual([SETTINGS.accounts[0]]);
	});

	it('states the problems that the read of the settings found', async () => {
		const data = new FakePluginData({
			[SETTINGS_KEY]: { accounts: [{ id: 'no-fields' }] },
		});
		const reading = await new PluginDataStore(data).read();
		expect(reading.settings.accounts).toEqual([]);
		expect(reading.problems.length).toBeGreaterThan(0);
	});
});

describe('the credentials in the data file', () => {
	it('writes a credential under its own key, and not under the settings', async () => {
		const data = new FakePluginData();
		const store = new PluginDataStore(data);
		await store.write(SETTINGS);
		await store.writeSecret('caldav-example-com', 'hunter2');
		const document = documentOf(data);
		expect(document[SECRET_FALLBACK_KEY]).toEqual({
			'caldav-example-com': 'hunter2',
		});
		expect(JSON.stringify(document[SETTINGS_KEY])).not.toContain('hunter2');
	});

	it('leaves the credentials where a write of the settings lands', async () => {
		const data = new FakePluginData();
		const store = new PluginDataStore(data);
		await store.writeSecret('caldav-example-com', 'hunter2');
		await store.write(SETTINGS);
		expect(await store.readSecret('caldav-example-com')).toBe('hunter2');
	});

	it('gives null back for a reference that the file does not hold', async () => {
		const store = new PluginDataStore(new FakePluginData());
		expect(await store.readSecret('nothing')).toBeNull();
	});

	it('gives null back where the value of a reference is not text', async () => {
		const data = new FakePluginData({
			[SECRET_FALLBACK_KEY]: { one: 12 },
		});
		expect(await new PluginDataStore(data).readSecret('one')).toBeNull();
	});

	it('takes the key of a credential away, and the key of the last one', async () => {
		const data = new FakePluginData();
		const store = new PluginDataStore(data);
		await store.writeSecret('one', 'first');
		await store.writeSecret('two', 'second');
		await store.removeSecret('one');
		expect(documentOf(data)[SECRET_FALLBACK_KEY]).toEqual({
			two: 'second',
		});
		await store.removeSecret('two');
		expect(SECRET_FALLBACK_KEY in documentOf(data)).toBe(false);
	});

	it('writes nothing for a removal of a reference that the file does not hold', async () => {
		const data = new FakePluginData();
		const store = new PluginDataStore(data);
		await store.writeSecret('one', 'first');
		await store.removeSecret('two');
		expect(data.writes).toHaveLength(1);
	});

	it('keeps the change of a call that runs beside another call', async () => {
		const data = new FakePluginData();
		const store = new PluginDataStore(data);
		await Promise.all([
			store.write(SETTINGS),
			store.writeSecret('caldav-example-com', 'hunter2'),
		]);
		const document = documentOf(data);
		expect(
			(document[SETTINGS_KEY] as Record<string, unknown>).accounts,
		).toHaveLength(1);
		expect(document[SECRET_FALLBACK_KEY]).toEqual({
			'caldav-example-com': 'hunter2',
		});
	});

	it('runs each call of a set of calls, in the order of the calls', async () => {
		const data = new FakePluginData();
		const store = new PluginDataStore(data);
		await Promise.all([
			store.writeSecret('one', 'first'),
			store.writeSecret('two', 'second'),
			store.writeSecret('three', 'third'),
			store.removeSecret('two'),
		]);
		expect(documentOf(data)[SECRET_FALLBACK_KEY]).toEqual({
			one: 'first',
			three: 'third',
		});
	});

	it('runs the call after a call that failed', async () => {
		const data = new FakePluginData();
		const store = new PluginDataStore(data);
		const failing = new PluginDataStore({
			loadData: () => Promise.reject(new Error('the file went away')),
			saveData: () => Promise.resolve(),
		});
		await expect(failing.read()).rejects.toThrow('the file went away');
		await store.writeSecret('one', 'first');
		expect(documentOf(data)[SECRET_FALLBACK_KEY]).toEqual({
			one: 'first',
		});
	});

	it('starts from an empty file where the file holds another shape', async () => {
		const data = new FakePluginData('this file is a text');
		const store = new PluginDataStore(data);
		await store.writeSecret('one', 'first');
		expect(documentOf(data)).toEqual({
			[SECRET_FALLBACK_KEY]: { one: 'first' },
		});
	});
});
