import { describe, expect, it } from 'vitest';
import { NOTE_FIXTURES, noteFixture } from '../fixtures/note-corpus';
import {
	FrontmatterError,
	readFrontmatter,
	splitNote,
	writeFrontmatter,
} from './frontmatter';

const leaveUnchanged = (): void => {
	/* The body is empty on purpose: this update makes no change. */
};

describe('splitting a note', () => {
	it('splits a note that starts with a block', () => {
		expect(splitNote('---\ntitle: One\n---\nbody\n')).toEqual({
			yaml: 'title: One\n',
			body: 'body\n',
		});
	});

	it('reads an empty block as an empty block, and not as a missing block', () => {
		expect(splitNote('---\n---\nbody\n')).toEqual({
			yaml: '',
			body: 'body\n',
		});
	});

	it('stops at the first closing --- line and copies the text after that line', () => {
		const note = noteFixture('body-with-dashes').content;
		const split = splitNote(note);
		expect(split.yaml).toBe('title: Thematic breaks\n');
		expect(split.body).toContain('\n---\n');
		expect(`---\n${split.yaml ?? ''}---\n${split.body}`).toBe(note);
	});

	it('gives the full note as the body when there is no opening --- line', () => {
		const note = noteFixture('no-frontmatter').content;
		expect(splitNote(note)).toEqual({ yaml: null, body: note });
		expect(splitNote('no break at all')).toEqual({
			yaml: null,
			body: 'no break at all',
		});
	});

	it('gives the full note as the body when no --- line closes the block', () => {
		const note = '---\ntitle: One\n\nbody without a close\n';
		expect(splitNote(note)).toEqual({ yaml: null, body: note });
	});

	it('accepts --- lines that end with a carriage return', () => {
		expect(splitNote('---\r\ntitle: One\r\n---\r\nbody\r\n')).toEqual({
			yaml: 'title: One\r\n',
			body: 'body\r\n',
		});
	});

	it('accepts a closing --- line that has no line break after it', () => {
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

	it('reads an empty block and a block of only comments as an empty mapping', () => {
		expect(
			readFrontmatter(noteFixture('empty-frontmatter').content),
		).toEqual({ kind: 'mapping', data: {} });
		expect(readFrontmatter('---\n# only a comment\n---\nbody\n')).toEqual({
			kind: 'mapping',
			data: {},
		});
	});

	it('reads a note that has no block as absent', () => {
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

	it('reads each scalar type and each list shape that the corpus holds', () => {
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

describe('the rules of the frontmatter writer', () => {
	it('keeps the keys of the note in place and puts new keys at the end', () => {
		const note = noteFixture('key-order-reverse').content;
		const written = writeFrontmatter(note, (frontmatter) => {
			frontmatter.beta = 'rewritten';
			frontmatter.delta = 'fourth';
		});
		expect(splitNote(written).yaml).toBe(
			'gamma: third\nbeta: rewritten\nalpha: first\ndelta: fourth\n',
		);
	});

	it('removes a key that the update deletes or sets to undefined', () => {
		const written = writeFrontmatter(
			noteFixture('key-order-alpha').content,
			(frontmatter) => {
				delete frontmatter.alpha;
				frontmatter.beta = undefined;
			},
		);
		expect(splitNote(written).yaml).toBe('gamma: third\n');
	});

	it('copies the body byte for byte', () => {
		const note = noteFixture('body-with-dashes').content;
		const written = writeFrontmatter(note, (frontmatter) => {
			frontmatter.added = true;
		});
		expect(splitNote(written).body).toBe(splitNote(note).body);
	});

	it('builds the block again and keeps no comment that the note had', () => {
		const written = writeFrontmatter(
			noteFixture('comments').content,
			leaveUnchanged,
		);
		expect(splitNote(written).yaml).toBe(
			'title: Design review\nattendees:\n  - ren\n  - sam\n',
		);
	});

	it('uses quotes only if plain style cannot hold the value, and never breaks a long line', () => {
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

	it('writes a collection that has items in block style, and an empty collection in flow style', () => {
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

	it('writes a shared value two times and does not write an anchor', () => {
		const shared = { name: 'Ren' };
		const written = writeFrontmatter('---\n---\nbody\n', (frontmatter) => {
			frontmatter.organizer = shared;
			frontmatter.owner = shared;
		});
		expect(splitNote(written).yaml).toBe(
			'organizer:\n  name: Ren\nowner:\n  name: Ren\n',
		);
	});

	it('adds a block to a note that has no block', () => {
		const note = noteFixture('no-frontmatter').content;
		const written = writeFrontmatter(note, (frontmatter) => {
			frontmatter.title = 'Added';
		});
		expect(written).toBe(`---\ntitle: Added\n---\n${note}`);
	});

	it('keeps an empty block when the note had a block, and adds no block when the note had no block', () => {
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

	it('refuses a block that the writer cannot read as a mapping', () => {
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

describe('the writer over the whole corpus', () => {
	it('writes the same bytes for the same input', () => {
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

	it('changes nothing when the writer writes an already written note again', () => {
		for (const note of NOTE_FIXTURES) {
			if (readFrontmatter(note.content).kind === 'invalid') {
				continue;
			}
			const once = writeFrontmatter(note.content, leaveUnchanged);
			expect(writeFrontmatter(once, leaveUnchanged)).toBe(once);
		}
	});
});

describe('the writer and keys that look like integers', () => {
	it('writes keys that look like array indexes first, and in double quotes', () => {
		const note = '---\ntitle: T\nzeta: 1\n---\nbody\n';
		const written = writeFrontmatter(note, (frontmatter) => {
			frontmatter['2026'] = 'year';
			frontmatter['0'] = 'zero';
		});
		expect(written).toBe(
			'---\n"0": zero\n"2026": year\ntitle: T\nzeta: 1\n---\nbody\n',
		);
	});

	it('keeps keys that only look like numbers in the order of insertion', () => {
		const note = '---\ntitle: T\n---\nbody\n';
		const written = writeFrontmatter(note, (frontmatter) => {
			frontmatter['-1'] = 'a';
			frontmatter['1.5'] = 'b';
			frontmatter['01'] = 'c';
		});
		expect(written).toBe(
			'---\ntitle: T\n"-1": a\n"1.5": b\n"01": c\n---\nbody\n',
		);
	});
});

describe('the writer and values that the writer cannot write', () => {
	it('throws a frontmatter error for a value that it cannot write, and not a library error', () => {
		const note = '---\ntitle: T\n---\nbody\n';
		expect(() =>
			writeFrontmatter(note, (frontmatter) => {
				frontmatter.fn = () => 0;
			}),
		).toThrow(FrontmatterError);
	});
});
