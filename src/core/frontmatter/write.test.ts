import { describe, expect, it } from 'vitest';
import { applyPatch } from './write';

describe('the change that a write applies', () => {
	it('sets a key that the note does not hold', () => {
		const frontmatter: Record<string, unknown> = {};
		applyPatch(frontmatter, {
			set: [['summary', 'Design review']],
			remove: [],
		});
		expect(frontmatter).toEqual({ summary: 'Design review' });
	});

	it('writes over a key that the note holds', () => {
		const frontmatter: Record<string, unknown> = { priority: 1 };
		applyPatch(frontmatter, { set: [['priority', 5]], remove: [] });
		expect(frontmatter).toEqual({ priority: 5 });
	});

	it('removes a key that the note holds', () => {
		const frontmatter: Record<string, unknown> = {
			end: '2026-03-14T10:00',
		};
		applyPatch(frontmatter, { set: [], remove: ['end'] });
		expect(Object.keys(frontmatter)).toEqual([]);
	});

	it('takes the key out of the note, and does not leave it with no value', () => {
		const frontmatter: Record<string, unknown> = {
			end: '2026-03-14T10:00',
		};
		applyPatch(frontmatter, { set: [], remove: ['end'] });
		expect('end' in frontmatter).toBe(false);
	});

	it('passes over a key of the change that the note does not hold', () => {
		const frontmatter: Record<string, unknown> = {
			summary: 'Design review',
		};
		applyPatch(frontmatter, { set: [], remove: ['end', 'duration'] });
		expect(frontmatter).toEqual({ summary: 'Design review' });
	});

	it('copies a list, so that the note holds no list of the caller', () => {
		const items = ['work', 'design'];
		const frontmatter: Record<string, unknown> = {};
		applyPatch(frontmatter, { set: [['categories', items]], remove: [] });
		items.push('later');
		expect(frontmatter.categories).toEqual(['work', 'design']);
	});

	it('adds the keys in the order of the change', () => {
		const frontmatter: Record<string, unknown> = {};
		applyPatch(frontmatter, {
			set: [
				['start', '2026-03-14T09:00'],
				['end', '2026-03-14T10:00'],
			],
			remove: [],
		});
		expect(Object.keys(frontmatter)).toEqual(['start', 'end']);
	});

	it('keeps the place of a key that the note already holds', () => {
		const frontmatter: Record<string, unknown> = {
			start: '2026-03-14T08:00',
			summary: 'Design review',
		};
		applyPatch(frontmatter, {
			set: [['start', '2026-03-14T09:00']],
			remove: [],
		});
		expect(Object.keys(frontmatter)).toEqual(['start', 'summary']);
	});
});
