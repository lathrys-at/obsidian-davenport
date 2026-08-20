import type { FileManager, TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import type { FrontmatterWriter } from './note-frontmatter';
import { writeNoteFrontmatter } from './note-frontmatter';

/** The file that the double takes. The real method takes a file of the vault. */
interface Note {
	readonly path: string;
}

const FILE: Note = { path: 'note.md' };

/** A writer that answers with the given promise and keeps what it saw. */
function writerThat(answer: () => Promise<void>): {
	readonly writer: FrontmatterWriter<Note>;
	readonly seen: Record<string, unknown>[];
} {
	const seen: Record<string, unknown>[] = [];
	return {
		seen,
		writer: {
			processFrontMatter(_file: Note, update): Promise<void> {
				const frontmatter: Record<string, unknown> = {
					start: '2026-03-14T09:00',
				};
				update(frontmatter);
				seen.push(frontmatter);
				return answer();
			},
		},
	};
}

describe('the write of frontmatter through the platform', () => {
	it('gives the change to the platform in one call', async () => {
		const { writer, seen } = writerThat(() => Promise.resolve());
		const result = await writeNoteFrontmatter(writer, FILE, {
			set: [['date', '2026-03-14']],
			remove: ['start'],
		});
		expect(result).toEqual({ ok: true });
		expect(seen).toEqual([{ date: '2026-03-14' }]);
	});

	it('gives the reason of an error of the platform', async () => {
		const { writer } = writerThat(() =>
			Promise.reject(new Error('the block does not parse')),
		);
		expect(
			await writeNoteFrontmatter(writer, FILE, { set: [], remove: [] }),
		).toEqual({ ok: false, reason: 'the block does not parse' });
	});

	it('gives the words of a refusal that is not an error object', async () => {
		const { writer } = writerThat(() =>
			// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- The platform stands outside this codebase, and a promise of it can refuse with a value of any type. This test states what this module does with such a value.
			Promise.reject('the file is gone'),
		);
		expect(
			await writeNoteFrontmatter(writer, FILE, { set: [], remove: [] }),
		).toEqual({ ok: false, reason: 'the file is gone' });
	});

	it('takes the file manager of the platform, which takes a file of the vault', () => {
		const manager = undefined as unknown as FileManager;
		const writer: FrontmatterWriter<TFile> = manager;
		expect(writer).toBeUndefined();
	});
});
