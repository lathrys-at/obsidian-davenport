import { describe, expect, it } from 'vitest';
import { FakeFileManager } from './file-manager';
import { readFrontmatter } from './frontmatter';

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

	it('throws for a note that it does not hold', () => {
		expect(() => new FakeFileManager().note('missing.md')).toThrow(
			'holds no note at missing.md',
		);
	});

	// The real method takes a file object of the vault, so it cannot reach
	// a path that the vault does not hold. A double that made the note
	// would pass a test that throws in the real editor.
	it('refuses a write to a note that it does not hold', async () => {
		const manager = new FakeFileManager();
		await expect(
			manager.processFrontMatter(manager.file('new.md'), () => {
				throw new Error('the update function never runs');
			}),
		).rejects.toThrow('holds no note at new.md');
	});

	// The dialect decides the type of each value that the update function
	// receives. A note that holds a day with no quotation marks gives a
	// date value under the timestamp dialect, and text under the core
	// dialect. The parser family that the note editor bundles reads the
	// first way under its default configuration.
	it.each([
		['timestamp', 'Date'],
		['core', 'string'],
	] as const)(
		'gives a day the type %s under the %s dialect',
		(dialect, expected) => {
			const manager = new FakeFileManager(
				{
					'note.md': ['---', 'date: 2026-03-14', '---', ''].join(
						'\n',
					),
				},
				dialect,
			);
			let seen: unknown = null;
			return manager
				.processFrontMatter(manager.file('note.md'), (frontmatter) => {
					seen = frontmatter.date;
				})
				.then(() => {
					expect(seen instanceof Date ? 'Date' : typeof seen).toBe(
						expected,
					);
				});
		},
	);

	it('writes a day that a string states back as a string', async () => {
		const manager = new FakeFileManager({ 'note.md': NOTE }, 'timestamp');
		await manager.processFrontMatter(
			manager.file('note.md'),
			(frontmatter) => {
				frontmatter.date = '2026-03-14';
			},
		);
		const read = readFrontmatter(manager.note('note.md'), 'timestamp');
		if (read.kind === 'mapping') {
			expect(read.data.date).toBe('2026-03-14');
		}
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
