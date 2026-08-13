import { describe, expect, it } from 'vitest';
import { declineMerge, lineMergeMangler, type MergeInputs } from './index';

const BASE = [
	'uid: event-1',
	'summary: Weekly sync',
	'start: 2026-03-04T09:00',
	'checksum: aaaa',
	'',
].join('\n');

const LOCAL = [
	'uid: event-1',
	'summary: Weekly catch-up',
	'start: 2026-03-04T09:00',
	'checksum: bbbb',
	'',
].join('\n');

const INCOMING = [
	'uid: event-1',
	'summary: Weekly sync',
	'start: 2026-03-04T10:00',
	'checksum: cccc',
	'',
].join('\n');

function inputs(overrides: Partial<MergeInputs> = {}): MergeInputs {
	return {
		path: 'records/abc123.md',
		base: BASE,
		local: LOCAL,
		incoming: INCOMING,
		...overrides,
	};
}

describe('line merge mangling', () => {
	it('produces a file that neither device wrote', () => {
		const merged = lineMergeMangler()(inputs());
		expect(merged).toBe(
			[
				'uid: event-1',
				'summary: Weekly catch-up',
				'start: 2026-03-04T10:00',
				'checksum: cccc',
				'',
			].join('\n'),
		);
		expect(merged).not.toBe(LOCAL);
		expect(merged).not.toBe(INCOMING);
	});

	it('takes the local side of a line that both sides changed, when the rule is take-local', () => {
		expect(
			lineMergeMangler({ onBothChanged: 'take-local' })(inputs()),
		).toContain('checksum: bbbb');
	});

	it('writes conflict markers around a line that both sides changed, when the rule is markers', () => {
		const merged = lineMergeMangler({ onBothChanged: 'markers' })(inputs());
		expect(merged).toContain('<<<<<<< local\nchecksum: bbbb');
		expect(merged).toContain('=======\nchecksum: cccc\n>>>>>>> incoming');
	});

	it('takes the changed side when only one side changed the line', () => {
		const merger = lineMergeMangler();
		expect(merger(inputs({ local: BASE }))).toBe(INCOMING);
		expect(merger(inputs({ incoming: BASE }))).toBe(LOCAL);
		expect(merger(inputs({ local: INCOMING }))).toBe(INCOMING);
	});

	it('keeps the extra line when one side has more lines than the other', () => {
		expect(
			lineMergeMangler()({
				path: 'records/abc123.md',
				base: 'one\ntwo',
				local: 'one\ntwo\nthree',
				incoming: 'one\nTWO',
			}),
		).toBe('one\nTWO\nthree');
	});

	it('declines to merge when the two sides share no base', () => {
		expect(lineMergeMangler()(inputs({ base: null }))).toBeNull();
		expect(declineMerge(inputs())).toBeNull();
	});

	it('produces the same merged content every time for the same inputs', () => {
		const merger = lineMergeMangler();
		const first = merger(inputs());
		for (let run = 0; run < 20; run += 1) {
			expect(merger(inputs())).toBe(first);
			expect(lineMergeMangler()(inputs())).toBe(first);
		}
	});
});
