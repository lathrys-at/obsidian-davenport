import { describe, expect, it } from 'vitest';
import { FakeVault } from './obsidian-fake';
import { RecordingVault } from './recording-vault';

function vault(files: Readonly<Record<string, string>> = {}): RecordingVault {
	return new RecordingVault(new FakeVault(files));
}

describe('the vault that counts writes', () => {
	it('counts no write before a caller writes', () => {
		expect(vault().written).toEqual([]);
	});

	it('counts one write for each call, in order', async () => {
		const counted = vault();
		await counted.write('a.md', 'one');
		await counted.write('b.md', 'two');
		expect(counted.written).toEqual([
			{ path: 'a.md', content: 'one' },
			{ path: 'b.md', content: 'two' },
		]);
		expect(counted.writtenPaths).toEqual(['a.md', 'b.md']);
	});

	it('lets the write reach the vault below', async () => {
		const counted = vault();
		await counted.write('a.md', 'one');
		expect(await counted.read('a.md')).toBe('one');
		expect(await counted.exists('a.md')).toBe(true);
	});

	it('counts a move to the trash', async () => {
		const counted = vault({ 'a.md': 'one' });
		await counted.trash('a.md');
		expect(counted.trashedPaths).toEqual(['a.md']);
		expect(await counted.exists('a.md')).toBe(false);
	});

	it('counts no write for a rename', async () => {
		const counted = vault({ 'a.md': 'one' });
		await counted.rename('a.md', 'b.md');
		expect(counted.written).toEqual([]);
		expect(await counted.read('b.md')).toBe('one');
	});

	it('forgets what it counted', async () => {
		const counted = vault();
		await counted.write('a.md', 'one');
		counted.forget();
		expect(counted.written).toEqual([]);
	});

	it('reads the frontmatter of the vault below', async () => {
		const counted = vault({ 'a.md': '---\nuid: one\n---\n' });
		expect(await counted.frontmatter('a.md')).toEqual({ uid: 'one' });
	});

	it('changes the frontmatter through the vault below', async () => {
		const counted = vault({ 'a.md': '---\nuid: one\n---\n' });
		await counted.updateFrontmatter('a.md', (frontmatter) => {
			frontmatter.state = 'ready';
		});
		expect(await counted.frontmatter('a.md')).toEqual({
			uid: 'one',
			state: 'ready',
		});
	});

	it('passes the file events of the vault below on', async () => {
		const counted = vault();
		const seen: string[] = [];
		const stop = counted.onFileEvent((event) => seen.push(event.kind));
		await counted.write('a.md', 'one');
		stop();
		await counted.write('b.md', 'two');
		expect(seen).toEqual(['created']);
	});
});
