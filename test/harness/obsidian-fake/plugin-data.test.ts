/**
 * The data file of a plugin, in memory.
 *
 * The point of these cases is the text. The fake keeps what a write put in
 * the file, so a test reads the bytes and not the object that the caller
 * passed. The fake also keeps the text of every write, so a value that a
 * later write took out is still evidence.
 */

import { describe, expect, it } from 'vitest';
import { FakePluginData } from './plugin-data';

describe('the data file in memory', () => {
	it('holds no file before the first write', async () => {
		const data = new FakePluginData();
		expect(await data.loadData()).toBeNull();
		expect(data.document).toBeNull();
		expect(data.writes).toEqual([]);
	});

	it('starts from the value that the caller gives', async () => {
		const data = new FakePluginData({ settings: { accounts: [] } });
		expect(await data.loadData()).toEqual({ settings: { accounts: [] } });
		expect(data.writes).toEqual([]);
	});

	it('reads back the value that a write left', async () => {
		const data = new FakePluginData();
		await data.saveData({ one: 1 });
		expect(await data.loadData()).toEqual({ one: 1 });
		expect(data.document).toBe('{"one":1}');
	});

	it('gives a fresh value to each read', async () => {
		const data = new FakePluginData();
		await data.saveData({ list: [1] });
		const first = (await data.loadData()) as { list: number[] };
		first.list.push(2);
		expect(await data.loadData()).toEqual({ list: [1] });
	});

	it('keeps the text of every write', async () => {
		const data = new FakePluginData();
		await data.saveData({ password: 'hunter2' });
		await data.saveData({ password: 'gone' });
		expect(data.writes).toEqual([
			'{"password":"hunter2"}',
			'{"password":"gone"}',
		]);
		expect(data.document).toBe('{"password":"gone"}');
	});
});
