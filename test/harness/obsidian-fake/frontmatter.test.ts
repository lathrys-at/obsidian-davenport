import { describe, expect, it } from 'vitest';
import { NOTE_FIXTURES, noteFixture } from '../fixtures/note-corpus';
import {
	FrontmatterError,
	readFrontmatter,
	splitNote,
	writeFrontmatter,
} from './frontmatter';

const leaveUnchanged = (): void => {
	/* an identity update */
};

describe('splitting a note', () => {
	it('splits a note that opens with a block', () => {
		expect(splitNote('---\ntitle: One\n---\nbody\n')).toEqual({
			yaml: 'title: One\n',
			body: 'body\n',
		});
	});

	it('reads an empty block as an empty block, not as absent', () => {
		expect(splitNote('---\n---\nbody\n')).toEqual({
			yaml: '',
			body: 'body\n',
		});
	});

	it('stops at the first closing delimiter and copies the rest', () => {
		const note = noteFixture('body-with-dashes').content;
		const split = splitNote(note);
		expect(split.yaml).toBe('title: Thematic breaks\n');
		expect(split.body).toContain('\n---\n');
		expect(`---\n${split.yaml ?? ''}---\n${split.body}`).toBe(note);
	});

	it('treats a note without an opening delimiter as all body', () => {
		const note = noteFixture('no-frontmatter').content;
		expect(splitNote(note)).toEqual({ yaml: null, body: note });
		expect(splitNote('no break at all')).toEqual({
			yaml: null,
			body: 'no break at all',
		});
	});

	it('treats an unterminated block as all body', () => {
		const note = '---\ntitle: One\n\nbody without a close\n';
		expect(splitNote(note)).toEqual({ yaml: null, body: note });
	});

	it('accepts delimiters that end with a carriage return', () => {
		expect(splitNote('---\r\ntitle: One\r\n---\r\nbody\r\n')).toEqual({
			yaml: 'title: One\r\n',
			body: 'body\r\n',
		});
	});

	it('accepts a closing delimiter on the last line without a break', () => {
		expect(splitNote('---\ntitle: One\n---')).toEqual({
			yaml: 'title: One\n',
			body: '',
		});
	});
});

describe('reading frontmatter', () => {
	it('reads a mapping', () => {
		expect(readFrontmatter(noteFixture('minimal').content)).toEqual({
			kind: 'mapping',
			data: { title: 'Weekly sync', start: '2026-03-04T09:00' },
		});
	});

	it('reads a block holding nothing as an empty mapping', () => {
		expect(
			readFrontmatter(noteFixture('empty-frontmatter').content),
		).toEqual({ kind: 'mapping', data: {} });
		expect(readFrontmatter('---\n# only a comment\n---\nbody\n')).toEqual({
			kind: 'mapping',
			data: {},
		});
	});

	it('reads a missing block as absent', () => {
		expect(readFrontmatter(noteFixture('no-frontmatter').content)).toEqual({
			kind: 'absent',
		});
	});

	it('reads a block that is not a mapping as invalid', () => {
		const read = readFrontmatter(noteFixture('non-mapping').content);
		expect(read.kind).toBe('invalid');
	});

	it('reads a block that does not parse as invalid', () => {
		const read = readFrontmatter(noteFixture('unparseable').content);
		expect(read.kind).toBe('invalid');
	});

	it('keeps the shapes the corpus was built from', () => {
		const scalars = readFrontmatter(noteFixture('scalars').content);
		expect(scalars).toEqual({
			kind: 'mapping',
			data: {
				truthy: true,
				falsy: false,
				'yes-word': 'yes',
				number: 42,
				negative: -7,
				float: 1.5,
				padded: '007',
				nullish: null,
				tilde: null,
				'date-like': '2026-03-04',
				'timestamp-like': '2026-03-04T09:00:00Z',
				wikilink: '[[Weekly sync]]',
				percent: '100%',
				'at-sign': '@mention',
			},
		});
		const lists = readFrontmatter(noteFixture('lists').content);
		expect(lists).toEqual({
			kind: 'mapping',
			data: {
				tags: ['calendar', 'davenport'],
				attendees: [
					{ name: 'Ren', role: 'chair' },
					{ name: 'Sam', role: 'member' },
				],
				flow: ['alpha', 'beta', 'gamma'],
				'empty-list': [],
				'nested-lists': [[1, 2], [3]],
			},
		});
	});
});

describe('the frontmatter writer canon', () => {
	it('holds parsed keys in place and appends what the update adds', () => {
		const note = noteFixture('key-order-reverse').content;
		const written = writeFrontmatter(note, (frontmatter) => {
			frontmatter.beta = 'rewritten';
			frontmatter.delta = 'fourth';
		});
		expect(splitNote(written).yaml).toBe(
			'gamma: third\nbeta: rewritten\nalpha: first\ndelta: fourth\n',
		);
	});

	it('drops a key that is deleted or set to undefined', () => {
		const written = writeFrontmatter(
			noteFixture('key-order-alpha').content,
			(frontmatter) => {
				delete frontmatter.alpha;
				frontmatter.beta = undefined;
			},
		);
		expect(splitNote(written).yaml).toBe('gamma: third\n');
	});

	it('copies the body through byte for byte', () => {
		const note = noteFixture('body-with-dashes').content;
		const written = writeFrontmatter(note, (frontmatter) => {
			frontmatter.added = true;
		});
		expect(splitNote(written).body).toBe(splitNote(note).body);
	});

	it('rebuilds the block without the comments the note carried', () => {
		const written = writeFrontmatter(
			noteFixture('comments').content,
			leaveUnchanged,
		);
		expect(splitNote(written).yaml).toBe(
			'title: Design review\nattendees:\n  - ren\n  - sam\n',
		);
	});

	it('quotes only what plain style cannot hold, and never folds a line', () => {
		const written = writeFrontmatter(
			noteFixture('quote-styles').content,
			leaveUnchanged,
		);
		expect(splitNote(written).yaml).toBe(
			[
				'plain: unquoted value',
				'single: single quoted',
				'double: double quoted',
				'apostrophe: it reads better double quoted',
				'colon: "a value: with a colon"',
				'hash: "a value # with a hash"',
				'empty-string: ""',
				'literal: |',
				'  first line',
				'  second line',
				'folded: |',
				'  folded text that joins into one line',
				'long: A value long enough that a writer folding at the usual width would break it over two lines, which this one never does.',
				'',
			].join('\n'),
		);
	});

	it('writes collections in block style, empty ones in flow style', () => {
		const written = writeFrontmatter(
			noteFixture('lists').content,
			leaveUnchanged,
		);
		expect(splitNote(written).yaml).toBe(
			[
				'tags:',
				'  - calendar',
				'  - davenport',
				'attendees:',
				'  - name: Ren',
				'    role: chair',
				'  - name: Sam',
				'    role: member',
				'flow:',
				'  - alpha',
				'  - beta',
				'  - gamma',
				'empty-list: []',
				'nested-lists:',
				'  - - 1',
				'    - 2',
				'  - - 3',
				'',
			].join('\n'),
		);
	});

	it('repeats a shared value instead of emitting an anchor', () => {
		const shared = { name: 'Ren' };
		const written = writeFrontmatter('---\n---\nbody\n', (frontmatter) => {
			frontmatter.organizer = shared;
			frontmatter.owner = shared;
		});
		expect(splitNote(written).yaml).toBe(
			'organizer:\n  name: Ren\nowner:\n  name: Ren\n',
		);
	});

	it('adds a block to a note that had none', () => {
		const note = noteFixture('no-frontmatter').content;
		const written = writeFrontmatter(note, (frontmatter) => {
			frontmatter.title = 'Added';
		});
		expect(written).toBe(`---\ntitle: Added\n---\n${note}`);
	});

	it('keeps an empty block, and adds none where there was none', () => {
		const kept = writeFrontmatter(
			noteFixture('key-order-alpha').content,
			(frontmatter) => {
				for (const key of Object.keys(frontmatter)) {
					frontmatter[key] = undefined;
				}
			},
		);
		expect(splitNote(kept)).toEqual({
			yaml: '',
			body: '\nThree keys in declaration order.\n',
		});
		const note = noteFixture('no-frontmatter').content;
		expect(writeFrontmatter(note, leaveUnchanged)).toBe(note);
	});

	it('refuses a block it cannot read as a mapping', () => {
		expect(() =>
			writeFrontmatter(
				noteFixture('unparseable').content,
				leaveUnchanged,
			),
		).toThrow(FrontmatterError);
		expect(() =>
			writeFrontmatter(
				noteFixture('non-mapping').content,
				leaveUnchanged,
			),
		).toThrow(FrontmatterError);
	});
});

describe('writer determinism over the corpus', () => {
	it('writes byte-identical output for identical input', () => {
		for (const note of NOTE_FIXTURES) {
			if (readFrontmatter(note.content).kind === 'invalid') {
				continue;
			}
			const update = (frontmatter: Record<string, unknown>): void => {
				frontmatter['davenport-uid'] = `uid-${note.id}`;
				frontmatter.trail = { seen: [1, 2], by: note.id };
			};
			const first = writeFrontmatter(note.content, update);
			const second = writeFrontmatter(note.content, update);
			expect(second).toBe(first);
		}
	});

	it('settles after one write: writing again changes nothing', () => {
		for (const note of NOTE_FIXTURES) {
			if (readFrontmatter(note.content).kind === 'invalid') {
				continue;
			}
			const once = writeFrontmatter(note.content, leaveUnchanged);
			expect(writeFrontmatter(once, leaveUnchanged)).toBe(once);
		}
	});
});
