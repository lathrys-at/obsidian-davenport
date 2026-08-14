import { describe, expect, it } from 'vitest';
import { DEFAULT_START_TIME } from '../clock';
import {
	DEFAULT_SYNC_PROFILE,
	SYNC_TOOL_PROFILES,
	formatTimestamp,
	incomingWins,
	renderConflictPath,
	splitPath,
	syncToolProfile,
	type ConflictCopyContext,
} from './index';

const CONTEXT: ConflictCopyContext = {
	path: 'records/abc123.md',
	device: 'laptop',
	at: DEFAULT_START_TIME + 3_723_000,
	counter: 2,
};

describe('conflict-copy patterns and profile lookup', () => {
	it('fills the pattern of each profile that makes conflict copies', () => {
		const rendered = SYNC_TOOL_PROFILES.filter(
			(profile) => profile.conflictCopyPattern !== null,
		).map((profile) =>
			renderConflictPath(profile.conflictCopyPattern ?? '', CONTEXT),
		);
		expect(rendered).toEqual([
			'records/abc123 (conflicted copy 20260101-010203).md',
			'records/abc123.sync-conflict-20260101-010203-laptop.md',
			'records/abc123 2.md',
		]);
	});

	it('fills the pattern of the default profile', () => {
		expect(
			renderConflictPath(
				DEFAULT_SYNC_PROFILE.conflictCopyPattern ?? '',
				CONTEXT,
			),
		).toBe('records/abc123 (conflict 2).md');
	});

	it('fills a pattern for a file at the vault root and for a file with no extension', () => {
		const pattern = '{dir}{stem} {counter}{ext}';
		expect(
			renderConflictPath(pattern, { ...CONTEXT, path: 'note.md' }),
		).toBe('note 2.md');
		expect(
			renderConflictPath(pattern, { ...CONTEXT, path: 'folder/plain' }),
		).toBe('folder/plain 2');
	});

	it('throws when the pattern holds an unknown placeholder', () => {
		expect(() => renderConflictPath('{dir}{name}{ext}', CONTEXT)).toThrow(
			/unknown placeholder \{name\}/,
		);
	});

	it('names the tools in the corpus when the corpus holds no profile for the given tool', () => {
		expect(() => syncToolProfile('dropbox')).toThrow(
			/corpus holds obsidian-sync, syncthing, icloud-drive, git/,
		);
	});
});

describe('divergence winner', () => {
	const EARLY = { author: 'b', at: DEFAULT_START_TIME };
	const LATE = { author: 'a', at: DEFAULT_START_TIME + 1 };

	it('gives the path to the side that wrote last', () => {
		expect(incomingWins('newest', LATE, EARLY)).toBe(true);
		expect(incomingWins('newest', EARLY, LATE)).toBe(false);
	});

	it('breaks a tie on the author id, and the earlier id wins', () => {
		const tied = { author: 'b', at: LATE.at };
		expect(incomingWins('newest', LATE, tied)).toBe(true);
		expect(incomingWins('newest', tied, LATE)).toBe(false);
	});

	it('follows each one-sided rule, whatever the two sides hold', () => {
		expect(incomingWins('incoming', EARLY, LATE)).toBe(true);
		expect(incomingWins('local', LATE, EARLY)).toBe(false);
	});
});

describe('path parts and timestamps', () => {
	it('splits a path into the directory, the stem, and the extension', () => {
		expect(splitPath('a/b/c.md')).toEqual({
			dir: 'a/b/',
			stem: 'c',
			ext: '.md',
		});
		expect(splitPath('c.md')).toEqual({ dir: '', stem: 'c', ext: '.md' });
		expect(splitPath('a/c')).toEqual({ dir: 'a/', stem: 'c', ext: '' });
		expect(splitPath('a/.hidden')).toEqual({
			dir: 'a/',
			stem: '.hidden',
			ext: '',
		});
	});

	it('formats a time in UTC at a fixed width', () => {
		expect(formatTimestamp(DEFAULT_START_TIME)).toBe('20260101-000000');
		expect(formatTimestamp(Date.UTC(2026, 10, 9, 8, 7, 6))).toBe(
			'20261109-080706',
		);
	});
});
