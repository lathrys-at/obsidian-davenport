import { describe, expect, it } from 'vitest';
import { FakeFileManager } from './file-manager';

const NOTE = ['---', 'summary: Design review', '---', '', 'The body.', ''].join(
	'\n',
);

describe('the double of the frontmatter writer', () => {
	it('gives the keys of the note to the update function', async () => {
		const manager = new FakeFileManager({ 'note.md': NOTE });
		let seen: Record<string, unknown> = {};
		await manager.processFrontMatter(
			manager.file('note.md'),
			(frontmatter) => {
				seen = { ...frontmatter };
			},
		);
		expect(seen).toEqual({ summary: 'Design review' });
	});

	it('writes the block again and keeps the body', async () => {
		const manager = new FakeFileManager({ 'note.md': NOTE });
		await manager.processFrontMatter(
			manager.file('note.md'),
			(frontmatter) => {
				frontmatter.start = '2026-03-14T09:00';
			},
		);
		expect(manager.note('note.md')).toBe(
			[
				'---',
				'summary: Design review',
				'start: 2026-03-14T09:00',
				'---',
				'',
				'The body.',
				'',
			].join('\n'),
		);
	});

	it('makes a block for a note that has none', async () => {
		const manager = new FakeFileManager({ 'note.md': 'The body.\n' });
		await manager.processFrontMatter(
			manager.file('note.md'),
			(frontmatter) => {
				frontmatter.summary = 'Design review';
			},
		);
		expect(manager.note('note.md')).toBe(
			['---', 'summary: Design review', '---', 'The body.', ''].join(
				'\n',
			),
		);
	});

	it('keeps one call for each call, with the text of each side', async () => {
		const manager = new FakeFileManager({ 'note.md': NOTE });
		await manager.processFrontMatter(
			manager.file('note.md'),
			(frontmatter) => {
				frontmatter.summary = 'Design review 2';
			},
		);
		expect(manager.calls).toHaveLength(1);
		expect(manager.calls[0]?.path).toBe('note.md');
		expect(manager.calls[0]?.before).toBe(NOTE);
		expect(manager.calls[0]?.after).toContain('Design review 2');
	});

	it('starts a note that it does not hold from an empty text', async () => {
		const manager = new FakeFileManager();
		await manager.processFrontMatter(
			manager.file('new.md'),
			(frontmatter) => {
				frontmatter.summary = 'New';
			},
		);
		expect(manager.note('new.md')).toBe(
			['---', 'summary: New', '---', ''].join('\n'),
		);
	});

	it('throws for a note that it does not hold', () => {
		expect(() => new FakeFileManager().note('missing.md')).toThrow(
			'holds no note at missing.md',
		);
	});

	it('throws the error that the test gave it, and takes no call', async () => {
		const manager = new FakeFileManager({ 'note.md': NOTE });
		manager.throwOnWrite(new Error('the block does not parse'));
		await expect(
			manager.processFrontMatter(manager.file('note.md'), () => {
				throw new Error('the update function never runs');
			}),
		).rejects.toThrow('the block does not parse');
		expect(manager.calls).toEqual([]);
		expect(manager.note('note.md')).toBe(NOTE);
	});
});
