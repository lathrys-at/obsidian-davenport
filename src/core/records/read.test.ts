import { describe, expect, it } from 'vitest';
import { WebCryptoDigest } from '../../adapters/digest';
import { parseIcs } from '../ics/parse';
import { NORMALIZATION_VERSIONS } from '../ics/stamp';
import type { RecordData } from '../model/record';
import { RECORD_GOLDEN_CASES } from '../../../test/harness/fixtures/record-goldens';
import { buildRecord } from './build';
import { renderRecord } from './canonical';
import { sealRecord } from './checksum';
import type { RecordReadProblem } from './read';
import { readRecord } from './read';

const digest = new WebCryptoDigest();

function built(index: number): RecordData {
	const entry = RECORD_GOLDEN_CASES[index];
	if (entry === undefined) {
		throw new Error('the gate holds no case at that place');
	}
	const parsed = parseIcs(entry.ics);
	if (!parsed.ok) {
		throw new Error(parsed.failure.message);
	}
	return buildRecord(NORMALIZATION_VERSIONS, {
		...entry.state,
		calendar: parsed.calendar,
	}).data;
}

function refusal(text: string): RecordReadProblem {
	const read = readRecord(text);
	if (read.ok) {
		throw new Error('the reader took a file that it must refuse');
	}
	return read.failure.problem;
}

function edited(text: string, from: string, to: string): string {
	if (!text.includes(from)) {
		throw new Error(`the text holds no ${from}`);
	}
	return text.replace(from, to);
}

describe('the read of a record that the writer wrote', () => {
	it.each(
		RECORD_GOLDEN_CASES.map((entry, index) => ({ id: entry.id, index })),
	)('gives the same record back for $id', async ({ index }) => {
		const data = built(index);
		const text = await sealRecord(digest, data);
		const read = readRecord(text);
		expect(read.ok).toBe(true);
		if (read.ok) {
			expect(renderRecord(read.data)).toBe(text);
		}
	});

	it('gives the checksum of the file back', async () => {
		const text = await sealRecord(digest, built(0));
		const read = readRecord(text);
		expect(read.ok && read.data.checksum).toMatch(/^[0-9a-f]{64}$/);
	});

	it('gives the base snapshot back with the pairs of the format', async () => {
		const text = await sealRecord(digest, built(0));
		const read = readRecord(text);
		expect(read.ok && read.data.baseIcs.includes('\r\n')).toBe(true);
	});
});

describe('what the reader of a record refuses in the layout', () => {
	it('refuses a file that opens with no frontmatter mark', () => {
		expect(refusal('uid: "a"\n')).toBe('layout');
	});

	it('refuses a file whose frontmatter does not close', () => {
		expect(refusal('---\nuid: "a"\n')).toBe('layout');
	});

	it('refuses a file with no empty line after the frontmatter', async () => {
		const text = await sealRecord(digest, built(0));
		expect(refusal(edited(text, '---\n\n```ics', '---\n```ics'))).toBe(
			'layout',
		);
	});

	it('refuses a file with no fenced block', async () => {
		const text = await sealRecord(digest, built(0));
		expect(refusal(edited(text, '```ics', '```json'))).toBe('layout');
	});

	it('refuses a file whose fenced block does not close', async () => {
		const text = await sealRecord(digest, built(0));
		expect(refusal(text.replace(/```\n$/, ''))).toBe('layout');
	});

	it('refuses a file that holds text after the fenced block', async () => {
		const text = await sealRecord(digest, built(0));
		expect(refusal(`${text}a note from a person\n`)).toBe('layout');
	});
});

describe('what the reader of a record refuses in the frontmatter', () => {
	it('refuses a frontmatter that a merge damaged', async () => {
		const text = await sealRecord(digest, built(0));
		expect(refusal(edited(text, 'uid: "minimal"', 'uid: minimal'))).toBe(
			'frontmatter',
		);
	});

	it('refuses a key that the schema does not hold', async () => {
		const text = await sealRecord(digest, built(0));
		expect(refusal(edited(text, 'uid: "minimal"', 'device: "phone"'))).toBe(
			'schema',
		);
	});

	it('refuses a record that states no pair', async () => {
		const text = await sealRecord(digest, built(0));
		expect(refusal(edited(text, 'uid: "minimal"', 'etag: "x"'))).toBe(
			'schema',
		);
	});

	it('refuses a value outside the set that its key permits', async () => {
		const text = await sealRecord(digest, built(0));
		expect(refusal(edited(text, 'type: "event"', 'type: "meeting"'))).toBe(
			'schema',
		);
	});

	it('refuses a record that carries no normalization stamp', async () => {
		const text = await sealRecord(digest, built(0));
		expect(refusal(edited(text, 'normalization:\n  core: 1\n', ''))).toBe(
			'schema',
		);
	});

	it('refuses a stamp that states no core component', async () => {
		const text = await sealRecord(digest, built(0));
		expect(refusal(edited(text, '  core: 1', '  timezone: 1'))).toBe(
			'schema',
		);
	});

	it('refuses a stamp component that is not a whole number', async () => {
		const text = await sealRecord(digest, built(0));
		expect(refusal(edited(text, '  core: 1', '  core: "1"'))).toBe(
			'schema',
		);
	});

	it('refuses a field that holds a map where the schema states a text', async () => {
		const text = await sealRecord(digest, built(0));
		expect(refusal(edited(text, 'uid: "minimal"', 'uid: {}'))).toBe(
			'schema',
		);
	});

	it('refuses a record whose fields are not a map', async () => {
		const text = await sealRecord(digest, built(0));
		expect(
			refusal(
				edited(text, 'fields:\n  type: "event"', 'fields: "event"'),
			),
		).toBe('schema');
	});

	it('refuses a record that states no fields', async () => {
		const text = await sealRecord(digest, built(0));
		expect(refusal(edited(text, 'fields:\n  type: "event"\n', ''))).toBe(
			'schema',
		);
	});

	it('refuses a tombstone that states no type', async () => {
		const text = await sealRecord(digest, built(6));
		expect(refusal(edited(text, '  type: "local-intent"\n', ''))).toBe(
			'schema',
		);
	});

	it('refuses an annotation that names no successor', async () => {
		const text = await sealRecord(digest, built(6));
		expect(
			refusal(
				edited(
					text,
					'    successor:\n      collection: "https://dav.example.com/calendars/ren/home/"\n      uid: "tombstone-moved"\n',
					'',
				),
			),
		).toBe('schema');
	});

	it('refuses a schedule that states no kind', async () => {
		const text = await sealRecord(digest, built(1));
		expect(refusal(edited(text, '    kind: "all-day"\n', ''))).toBe(
			'schema',
		);
	});

	it('refuses a timed schedule that states no start', async () => {
		const text = await sealRecord(digest, built(2));
		expect(
			refusal(edited(text, '    start: "2026-03-02T09:00:00"\n', '')),
		).toBe('schema');
	});

	it('refuses an all-day schedule that carries a key of the timed shape', async () => {
		const text = await sealRecord(digest, built(1));
		expect(
			refusal(edited(text, '    date: "2026-03-02"', '    start: "x"')),
		).toBe('schema');
	});

	it('refuses a venue that states no path', async () => {
		const text = await sealRecord(digest, built(5));
		expect(
			refusal(edited(text, '  path: "Meetings/Retrospective.md"\n', '')),
		).toBe('schema');
	});
});

/**
 * The text with the block under one line replaced by one value. The
 * caller gives the exact line that opens the block, with its indent.
 */
function flattened(text: string, opener: string, value: string): string {
	const lines = text.split('\n');
	const at = lines.indexOf(opener);
	if (at === -1) {
		throw new Error(`the text holds no line ${opener}`);
	}
	const inside = ' '.repeat(opener.length - opener.trimStart().length + 2);
	let stop = at + 1;
	while (stop < lines.length && (lines[stop] ?? '').startsWith(inside)) {
		stop += 1;
	}
	return [
		...lines.slice(0, at),
		`${opener} ${value}`,
		...lines.slice(stop),
	].join('\n');
}

describe('what the reader of a record refuses in a block of the schema', () => {
	it('refuses a venue that is not a map', async () => {
		const text = await sealRecord(digest, built(5));
		expect(refusal(flattened(text, 'venue:', '"a.md"'))).toBe('schema');
	});

	it('refuses a key that the venue does not hold', async () => {
		const text = await sealRecord(digest, built(5));
		expect(
			refusal(edited(text, '  section: "Notes"', '  heading: "Notes"')),
		).toBe('schema');
	});

	it('refuses a materialization map that is not a map', async () => {
		const text = await sealRecord(digest, built(5));
		expect(refusal(flattened(text, 'materialization:', '"x"'))).toBe(
			'schema',
		);
	});

	it('refuses an entry of the materialization map that is not a map', async () => {
		const text = await sealRecord(digest, built(5));
		expect(
			refusal(
				flattened(text, '  "2026-03-09":', '"Daily/2026-03-09.md"'),
			),
		).toBe('schema');
	});

	it('refuses render hashes that are not a map', async () => {
		const text = await sealRecord(digest, built(7));
		expect(refusal(flattened(text, 'renderHashes:', '"x"'))).toBe('schema');
	});

	it('refuses a key that the render hashes do not hold', async () => {
		const text = await sealRecord(digest, built(7));
		expect(
			refusal(
				edited(text, '  description: "9f2c1a"', '  body: "9f2c1a"'),
			),
		).toBe('schema');
	});

	it('refuses a tombstone that is not a map', async () => {
		const text = await sealRecord(digest, built(6));
		expect(refusal(flattened(text, 'tombstone:', '"gone"'))).toBe('schema');
	});

	it('refuses a key that the tombstone does not hold', async () => {
		const text = await sealRecord(digest, built(6));
		expect(
			refusal(
				edited(text, '  type: "local-intent"', '  reason: "moved"'),
			),
		).toBe('schema');
	});

	it('refuses an annotation that is not a map', async () => {
		const text = await sealRecord(digest, built(6));
		expect(refusal(flattened(text, '  annotation:', '"moved"'))).toBe(
			'schema',
		);
	});

	it('refuses a key that the annotation does not hold', async () => {
		const text = await sealRecord(digest, built(6));
		expect(
			refusal(edited(text, '    kind: "moved"', '    why: "moved"')),
		).toBe('schema');
	});

	it('refuses an annotation that states no kind', async () => {
		const text = await sealRecord(digest, built(6));
		expect(refusal(edited(text, '    kind: "moved"\n', ''))).toBe('schema');
	});

	it('refuses a successor that is not a map', async () => {
		const text = await sealRecord(digest, built(6));
		expect(refusal(flattened(text, '    successor:', '"home"'))).toBe(
			'schema',
		);
	});

	it('refuses a key that the successor does not hold', async () => {
		const text = await sealRecord(digest, built(6));
		expect(
			refusal(
				edited(text, '      uid: "tombstone-moved"', '      id: "x"'),
			),
		).toBe('schema');
	});

	it('refuses a normalization stamp that is not a map', async () => {
		const text = await sealRecord(digest, built(0));
		expect(refusal(flattened(text, 'normalization:', '"1"'))).toBe(
			'schema',
		);
	});

	it('refuses a key that the normalization stamp does not hold', async () => {
		const text = await sealRecord(digest, built(0));
		expect(refusal(edited(text, '  core: 1', '  engine: 1'))).toBe(
			'schema',
		);
	});

	it('refuses a key that the fields do not hold', async () => {
		const text = await sealRecord(digest, built(0));
		expect(
			refusal(edited(text, '  type: "event"', '  colour: "red"')),
		).toBe('schema');
	});

	it('refuses a schedule that is not a map', async () => {
		const text = await sealRecord(digest, built(1));
		expect(refusal(flattened(text, '  schedule:', '"all-day"'))).toBe(
			'schema',
		);
	});

	it('refuses a schedule whose kind is not a text', async () => {
		const text = await sealRecord(digest, built(1));
		expect(
			refusal(edited(text, '    kind: "all-day"', '    kind: 4')),
		).toBe('schema');
	});

	it('refuses a key that the timed schedule does not hold', async () => {
		const text = await sealRecord(digest, built(2));
		expect(refusal(edited(text, '    end: "', '    finish: "'))).toBe(
			'schema',
		);
	});

	it('refuses a key that the all-day schedule does not hold', async () => {
		const text = await sealRecord(digest, built(1));
		expect(refusal(edited(text, '    endDate: "', '    last: "'))).toBe(
			'schema',
		);
	});

	it('refuses a list where the schema states a text', async () => {
		const text = await sealRecord(digest, built(7));
		expect(
			refusal(
				edited(
					text,
					'  location: "Room 3"',
					'  location:\n    - "Room 3"',
				),
			),
		).toBe('schema');
	});

	it('refuses a text where the schema states a list', async () => {
		const text = await sealRecord(digest, built(7));
		expect(refusal(flattened(text, '  categories:', '"work"'))).toBe(
			'schema',
		);
	});
});

describe('what the reader of a record refuses in the base snapshot', () => {
	it('refuses a block that holds no calendar', async () => {
		const text = await sealRecord(digest, built(0));
		expect(refusal(edited(text, 'BEGIN:VCALENDAR', 'BEGIN:VNOTHING'))).toBe(
			'base-ics',
		);
	});
});
