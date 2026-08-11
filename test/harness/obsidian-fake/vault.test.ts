import { describe, expect, it } from 'vitest';
import type { VaultFileEvent } from '../../../src/core/ports/vault';
import { NOTE_FIXTURES, noteFixture } from '../fixtures/note-corpus';
import {
	FakeVault,
	FrontmatterError,
	readFrontmatter,
	splitNote,
} from './index';

const leaveUnchanged = (): void => {
	/* an identity update */
};

function recordEvents(vault: FakeVault): VaultFileEvent[] {
	const events: VaultFileEvent[] = [];
	vault.onFileEvent((event) => {
		events.push(event);
	});
	return events;
}

describe('fake vault files', () => {
	it('seeds without emitting anything', () => {
		const vault = new FakeVault({ 'a.md': 'one', 'b.md': 'two' });
		const events = recordEvents(vault);
		expect(vault.paths()).toEqual(['a.md', 'b.md']);
		expect(events).toEqual([]);
	});

	it('reads back what was written', async () => {
		const vault = new FakeVault();
		await vault.write('notes/a.md', 'one');
		expect(await vault.read('notes/a.md')).toBe('one');
		expect(await vault.exists('notes/a.md')).toBe(true);
		expect(await vault.exists('notes/b.md')).toBe(false);
	});

	it('moves a file on rename and takes it out of the vault on trash', async () => {
		const vault = new FakeVault({ 'a.md': 'one' });
		await vault.rename('a.md', 'b.md');
		expect(vault.paths()).toEqual(['b.md']);
		expect(await vault.read('b.md')).toBe('one');
		await vault.trash('b.md');
		expect(vault.paths()).toEqual([]);
	});

	it('refuses operations that have no sound answer', async () => {
		const vault = new FakeVault({ 'a.md': 'one', 'b.md': 'two' });
		await expect(vault.read('missing.md')).rejects.toThrow(/no file at/);
		await expect(vault.trash('missing.md')).rejects.toThrow(/no file at/);
		await expect(vault.rename('missing.md', 'c.md')).rejects.toThrow(
			/no file at/,
		);
		await expect(vault.rename('a.md', 'b.md')).rejects.toThrow(
			/target exists/,
		);
		await expect(vault.rename('a.md', 'a.md')).rejects.toThrow(/same path/);
		await expect(vault.write('', 'x')).rejects.toThrow(/path is empty/);
		await expect(vault.write('/a.md', 'x')).rejects.toThrow(
			/not vault-relative/,
		);
		expect(vault.paths()).toEqual(['a.md', 'b.md']);
	});

	it('sorts a snapshot by path and frames each file', () => {
		const vault = new FakeVault({ 'b.md': 'two', 'a.md': 'one' });
		expect(vault.snapshot()).toBe(
			'=== a.md (3 chars) ===\none\n=== b.md (3 chars) ===\ntwo',
		);
	});
});

describe('fake vault events', () => {
	it('names creation, modification, rename, and deletion in operation order', async () => {
		const vault = new FakeVault();
		const events = recordEvents(vault);
		await vault.write('a.md', 'one');
		await vault.write('a.md', 'one');
		await vault.write('a.md', 'two');
		await vault.rename('a.md', 'b.md');
		await vault.trash('b.md');
		expect(events).toEqual([
			{ kind: 'created', path: 'a.md' },
			{ kind: 'modified', path: 'a.md' },
			{ kind: 'modified', path: 'a.md' },
			{ kind: 'renamed', path: 'b.md', oldPath: 'a.md' },
			{ kind: 'deleted', path: 'b.md' },
		]);
	});

	it('delivers before the operation settles', async () => {
		const vault = new FakeVault();
		const events = recordEvents(vault);
		const pending = vault.write('a.md', 'one');
		expect(events).toHaveLength(1);
		await pending;
	});

	it('emits nothing for an operation that fails', async () => {
		const vault = new FakeVault({ 'a.md': 'one' });
		const events = recordEvents(vault);
		await expect(vault.trash('missing.md')).rejects.toThrow();
		await expect(
			vault.updateFrontmatter('missing.md', leaveUnchanged),
		).rejects.toThrow();
		expect(events).toEqual([]);
	});

	it('runs handlers in subscription order and stops on unsubscribe', async () => {
		const vault = new FakeVault();
		const log: string[] = [];
		const stopFirst = vault.onFileEvent(() => log.push('first'));
		vault.onFileEvent(() => log.push('second'));
		await vault.write('a.md', 'one');
		stopFirst();
		stopFirst();
		await vault.write('a.md', 'two');
		expect(log).toEqual(['first', 'second', 'second']);
	});

	it('withholds an event from a handler that unsubscribes during delivery', async () => {
		const vault = new FakeVault();
		const log: string[] = [];
		let stopSecond: (() => void) | null = null;
		vault.onFileEvent(() => {
			log.push('first');
			stopSecond?.();
		});
		stopSecond = vault.onFileEvent(() => log.push('second'));
		await vault.write('a.md', 'one');
		expect(log).toEqual(['first']);
	});

	it('delivers events from an operation a handler starts, before returning', async () => {
		const vault = new FakeVault();
		const log: string[] = [];
		vault.onFileEvent((event) => {
			log.push(`${event.kind}:${event.path}`);
			if (event.path === 'a.md' && event.kind === 'created') {
				void vault.write('b.md', 'from the handler');
			}
		});
		await vault.write('a.md', 'one');
		expect(log).toEqual(['created:a.md', 'created:b.md']);
	});
});

describe('fake vault frontmatter', () => {
	it('reads a mapping, and nothing where there is none to read', async () => {
		const vault = new FakeVault({
			'minimal.md': noteFixture('minimal').content,
			'none.md': noteFixture('no-frontmatter').content,
			'broken.md': noteFixture('unparseable').content,
			'list.md': noteFixture('non-mapping').content,
			'empty.md': noteFixture('empty-frontmatter').content,
		});
		expect(await vault.frontmatter('minimal.md')).toEqual({
			title: 'Weekly sync',
			start: '2026-03-04T09:00',
		});
		expect(await vault.frontmatter('none.md')).toBeNull();
		expect(await vault.frontmatter('broken.md')).toBeNull();
		expect(await vault.frontmatter('list.md')).toBeNull();
		expect(await vault.frontmatter('empty.md')).toEqual({});
	});

	it('updates through the writer and reports a modification', async () => {
		const vault = new FakeVault({
			'minimal.md': noteFixture('minimal').content,
		});
		const events = recordEvents(vault);
		await vault.updateFrontmatter('minimal.md', (frontmatter) => {
			frontmatter['davenport-uid'] = 'uid-1';
		});
		expect(await vault.frontmatter('minimal.md')).toEqual({
			title: 'Weekly sync',
			start: '2026-03-04T09:00',
			'davenport-uid': 'uid-1',
		});
		expect(events).toEqual([{ kind: 'modified', path: 'minimal.md' }]);
	});

	it('leaves a note it refuses exactly as it found it', async () => {
		const note = noteFixture('unparseable').content;
		const vault = new FakeVault({ 'broken.md': note });
		await expect(
			vault.updateFrontmatter('broken.md', (frontmatter) => {
				frontmatter.title = 'Fixed';
			}),
		).rejects.toBeInstanceOf(FrontmatterError);
		expect(await vault.read('broken.md')).toBe(note);
	});

	it('round-trips every fixture in the corpus', async () => {
		for (const note of NOTE_FIXTURES) {
			const vault = new FakeVault({ 'note.md': note.content });
			const before = await vault.frontmatter('note.md');
			if (readFrontmatter(note.content).kind === 'invalid') {
				await expect(
					vault.updateFrontmatter('note.md', leaveUnchanged),
				).rejects.toBeInstanceOf(FrontmatterError);
				expect(await vault.read('note.md')).toBe(note.content);
				continue;
			}
			await vault.updateFrontmatter('note.md', leaveUnchanged);
			const once = await vault.read('note.md');
			expect(await vault.frontmatter('note.md')).toEqual(before);
			expect(splitNote(once).body).toBe(splitNote(note.content).body);
			await vault.updateFrontmatter('note.md', leaveUnchanged);
			expect(await vault.read('note.md')).toBe(once);
		}
	});
});

interface ScriptRun {
	readonly snapshot: string;
	readonly events: readonly VaultFileEvent[];
	readonly outcomes: readonly string[];
}

async function runCorpusScript(): Promise<ScriptRun> {
	const vault = new FakeVault();
	const events = recordEvents(vault);
	const outcomes: string[] = [];
	for (const note of NOTE_FIXTURES) {
		const path = `notes/${note.fileName}`;
		await vault.write(path, note.content);
		try {
			await vault.updateFrontmatter(path, (frontmatter) => {
				frontmatter['davenport-uid'] = `uid-${note.id}`;
				delete frontmatter.title;
				frontmatter.trail = { seen: [1, 2], by: note.id };
			});
			outcomes.push(`updated ${note.id}`);
		} catch (error) {
			const name = error instanceof Error ? error.name : 'unknown';
			outcomes.push(`refused ${note.id} with ${name}`);
		}
	}
	await vault.rename('notes/minimal.md', 'notes/renamed.md');
	await vault.trash('notes/lists.md');
	return { snapshot: vault.snapshot(), events, outcomes };
}

describe('fake vault determinism', () => {
	it('produces the same bytes, events, and outcomes for the same operations', async () => {
		const first = await runCorpusScript();
		const second = await runCorpusScript();
		expect(second.snapshot).toBe(first.snapshot);
		expect(second.events).toEqual(first.events);
		expect(second.outcomes).toEqual(first.outcomes);
		expect(first.outcomes).toContain(
			'refused unparseable with FrontmatterError',
		);
		expect(first.outcomes).toContain(
			'refused non-mapping with FrontmatterError',
		);
		expect(first.snapshot).toContain('notes/renamed.md');
		expect(first.snapshot).not.toContain('notes/lists.md');
	});
});
