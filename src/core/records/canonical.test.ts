import { describe, expect, it } from 'vitest';
import { icsCorpus } from '../../../test/harness/fixtures/ics-corpus';
import { serializeIcs } from '../ics/serializer';
import type { RecordData } from '../model/record';
import {
	checksumSite,
	renderRecord,
	withChecksum,
	withLineFeeds,
	withLinePairs,
} from './canonical';

const HASH = 'a'.repeat(64);

function record(overrides: Partial<RecordData> = {}): RecordData {
	return {
		identity: { collectionHref: 'https://dav/c/', uid: 'one' },
		fields: { type: 'event' },
		baseIcs: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
		normalizationVersion: { core: 1 },
		checksum: '',
		...overrides,
	};
}

describe('the layout of a record file', () => {
	it('writes the frontmatter, one empty line, and one fenced block', () => {
		expect(renderRecord(record())).toBe(
			[
				'---',
				'collection: "https://dav/c/"',
				'uid: "one"',
				'fields:',
				'  type: "event"',
				'normalization:',
				'  core: 1',
				'checksum: ""',
				'---',
				'',
				'```ics',
				'BEGIN:VCALENDAR',
				'END:VCALENDAR',
				'```',
				'',
			].join('\n'),
		);
	});

	it('ends the file with one line feed', () => {
		const text = renderRecord(record());
		expect(text.endsWith('```\n')).toBe(true);
	});

	it('writes no carriage return', () => {
		expect(renderRecord(record())).not.toContain('\r');
	});

	it('writes the checksum on the last line of the frontmatter', () => {
		const text = renderRecord(record({ checksum: HASH }));
		const lines = text.split('\n');
		expect(lines[lines.indexOf('---', 1) - 1]).toBe(`checksum: "${HASH}"`);
	});

	it('refuses a record whose snapshot holds no line', () => {
		// An empty block reads as damage, so a file of this shape would
		// quarantine on the next read of any device. The writer refuses to
		// make one.
		expect(() => renderRecord(record({ baseIcs: '' }))).toThrow(
			/no base snapshot/,
		);
		expect(() => renderRecord(record({ baseIcs: '\r\n' }))).toThrow(
			/no base snapshot/,
		);
	});
});

describe('the fence of the block that holds the snapshot', () => {
	it('holds three back quotes for a snapshot that starts no line with one', () => {
		expect(renderRecord(record())).toContain('```ics\n');
	});

	it('grows past the longest run of back quotes that starts a line', () => {
		const text = renderRecord(record({ baseIcs: 'a\r\n```\r\nb\r\n' }));
		expect(text).toContain('````ics\n');
		expect(text.endsWith('````\n')).toBe(true);
	});

	it('reads over the spaces that a reader of markdown allows', () => {
		const text = renderRecord(record({ baseIcs: '   `````\r\n' }));
		expect(text).toContain('``````ics\n');
	});

	it('passes over a run of back quotes that stands inside a line', () => {
		const text = renderRecord(record({ baseIcs: 'a ``` b\r\n' }));
		expect(text).toContain('```ics\n');
	});

	it('passes over a run that stands four spaces from the left margin', () => {
		const text = renderRecord(record({ baseIcs: '    ```\r\n' }));
		expect(text).toContain('```ics\n');
	});
});

describe('the line endings of the snapshot', () => {
	it('writes one line feed in the place of a pair', () => {
		expect(withLineFeeds('a\r\nb\r\n')).toBe('a\nb\n');
	});

	it('writes one line feed in the place of a lone carriage return', () => {
		expect(withLineFeeds('a\rb')).toBe('a\nb');
	});

	it('writes a pair in the place of each line feed', () => {
		expect(withLinePairs('a\nb\n')).toBe('a\r\nb\r\n');
	});

	it('changes no byte of a text that already holds pairs', () => {
		expect(withLinePairs('a\r\nb\r\n')).toBe('a\r\nb\r\n');
	});

	it('gives the canonical text back for every file of the corpus', () => {
		for (const fixture of icsCorpus()) {
			const canonical = serializeIcs(fixture.content);
			expect(canonical.ok).toBe(true);
			if (canonical.ok) {
				expect(withLinePairs(withLineFeeds(canonical.text))).toBe(
					canonical.text,
				);
			}
		}
	});
});

describe('the place of the checksum in one record text', () => {
	it('reads the value and blanks the line', () => {
		const text = renderRecord(record({ checksum: HASH }));
		const site = checksumSite(text);
		expect(site.ok).toBe(true);
		if (site.ok) {
			expect(site.site.value).toBe(HASH);
			expect(site.site.blanked).toBe(renderRecord(record()));
		}
	});

	it('reads an empty value from a record that carries none yet', () => {
		const site = checksumSite(renderRecord(record()));
		expect(site.ok && site.site.value).toBe('');
	});

	it('passes over a line of the body that looks like the checksum line', () => {
		const text = renderRecord(
			record({
				checksum: HASH,
				baseIcs: `X-A:1\r\nchecksum: "${'b'.repeat(64)}"\r\n`,
			}),
		);
		const site = checksumSite(text);
		expect(site.ok && site.site.value).toBe(HASH);
	});

	it('refuses a text that opens with no frontmatter mark', () => {
		expect(checksumSite('a\n---\n')).toEqual({
			ok: false,
			problem: 'no-frontmatter',
		});
	});

	it('refuses a text whose frontmatter does not close', () => {
		expect(checksumSite('---\nchecksum: ""\n')).toEqual({
			ok: false,
			problem: 'no-frontmatter',
		});
	});

	it('refuses a text whose frontmatter carries no checksum line', () => {
		expect(checksumSite('---\nuid: "a"\n---\n')).toEqual({
			ok: false,
			problem: 'no-checksum',
		});
	});

	it('refuses a text whose frontmatter carries two checksum lines', () => {
		expect(checksumSite('---\nchecksum: ""\nchecksum: ""\n---\n')).toEqual({
			ok: false,
			problem: 'many-checksums',
		});
	});

	it('refuses a checksum value that is not a hexadecimal text', () => {
		expect(checksumSite('---\nchecksum: "zz"\n---\n')).toEqual({
			ok: false,
			problem: 'no-checksum',
		});
	});

	it('refuses a checksum line that stands further right', () => {
		expect(checksumSite('---\n  checksum: ""\n---\n')).toEqual({
			ok: false,
			problem: 'no-checksum',
		});
	});
});

describe('the write of a checksum into one record text', () => {
	it('puts the value on the checksum line', () => {
		expect(withChecksum(renderRecord(record()), HASH)).toBe(
			renderRecord(record({ checksum: HASH })),
		);
	});

	it('refuses a text that carries no checksum line', () => {
		expect(() => withChecksum('---\nuid: "a"\n---\n', HASH)).toThrow(
			'no checksum line',
		);
	});
});

describe('a record whose line endings a tool converted', () => {
	it('names the line endings, and does not report a missing frontmatter', () => {
		const text = renderRecord(record({ checksum: HASH })).replace(
			/\n/g,
			'\r\n',
		);
		const site = checksumSite(text);
		expect(site.ok).toBe(false);
		expect(!site.ok && site.problem).toBe('line-endings');
	});

	it('reports a missing frontmatter for a text that opens with something else', () => {
		const site = checksumSite('# a note\n');
		expect(site.ok).toBe(false);
		expect(!site.ok && site.problem).toBe('no-frontmatter');
	});
});
