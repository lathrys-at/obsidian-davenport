/**
 * The rules of the fuzzing lane. The lane runs on request and outside the
 * required check. These cases run inside the required check, because they
 * hold the rules that decide what a finding is, which findings are already
 * filed, and when a run fails.
 *
 * The cases that drive the real engine against a filed defect state the
 * behaviour of that defect today. The change that repairs the defect takes
 * the entry out of the ledger, and it takes these cases with it.
 */

import { describe, expect, it } from 'vitest';
import { runCampaign, runFails } from '../scripts/fuzz-ics-campaign';
import type { Finding, IcsEngine } from '../scripts/fuzz-ics-core';
import { driveInput, reducible, reduceInput } from '../scripts/fuzz-ics-core';
import {
	BYTE_MUTATIONS,
	WIDENINGS,
	modelInput,
	textInput,
} from '../scripts/fuzz-ics-inputs';
import { KNOWN_FINDINGS, knownFinding } from '../scripts/fuzz-ics-ledger';
import {
	failureLines,
	reportLines,
	seedFileName,
} from '../scripts/fuzz-ics-text';
import { samples } from './harness/arbitraries/seed';
import type { JCalComponent } from '../src/core/ics/jcal';
import type { IcsParseResult } from '../src/core/ics/parse';
import { parseIcs } from '../src/core/ics/parse';
import { serializeCalendar } from '../src/core/ics/serializer';

const engine: IcsEngine = { parseIcs, serializeCalendar };

const EMPTY_CALENDAR = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';

/** A calendar that holds the one line under test. */
function calendar(line: string): string {
	return ['BEGIN:VCALENDAR', 'VERSION:2.0', line, 'END:VCALENDAR', ''].join(
		'\r\n',
	);
}

/** The kind of finding that one text gives, or null. */
function kindOf(text: string, model?: JCalComponent): string | null {
	const found = driveInput(engine, {
		text,
		promise: model === undefined ? 'any' : 'accepted',
		...(model === undefined ? {} : { model }),
	});
	return found === null ? null : found.kind;
}

/** The finding that a drive gives. The helper throws where it gives none. */
function findingFor(text: string, model?: JCalComponent): Finding {
	const found = driveInput(engine, {
		text,
		promise: model === undefined ? 'any' : 'accepted',
		...(model === undefined ? {} : { model }),
	});
	if (found === null) {
		throw new Error(`the drive found nothing in ${JSON.stringify(text)}`);
	}
	return found;
}

/** An engine whose parse and serializer the case decides. */
function fakeEngine(parts: Partial<IcsEngine>): IcsEngine {
	return { parseIcs, serializeCalendar, ...parts };
}

const ONE_CALENDAR: JCalComponent = ['vcalendar', [], []];
const accepts = (): IcsParseResult => ({ ok: true, calendar: ONE_CALENDAR });

describe('the drive of one input', () => {
	it('finds nothing in a calendar that the engine reads and writes', () => {
		expect(kindOf(EMPTY_CALENDAR)).toBeNull();
	});

	it('finds nothing when the boundary refuses arbitrary bytes', () => {
		expect(kindOf('not a calendar at all')).toBeNull();
	});

	it('reports a refusal of a text that the caller promised', () => {
		const found = driveInput(engine, {
			text: 'not a calendar at all',
			promise: 'accepted',
		});
		expect(found?.kind).toBe('refused');
	});

	it('reports a refusal that names a problem the boundary does not state', () => {
		const broken = fakeEngine({
			parseIcs: () => ({
				ok: false,
				failure: { problem: 'gone' as never, message: 'a message' },
			}),
		});
		expect(
			driveInput(broken, { text: EMPTY_CALENDAR, promise: 'any' })?.kind,
		).toBe('illegible-refusal');
	});

	it('reports a refusal that carries no message', () => {
		const silent = fakeEngine({
			parseIcs: () => ({
				ok: false,
				failure: { problem: 'structure', message: '   ' },
			}),
		});
		expect(
			driveInput(silent, { text: EMPTY_CALENDAR, promise: 'any' })?.kind,
		).toBe('illegible-refusal');
	});

	it('reports a parse that throws', () => {
		const throws = fakeEngine({
			parseIcs: () => {
				throw new Error('no');
			},
		});
		const found = driveInput(throws, {
			text: EMPTY_CALENDAR,
			promise: 'any',
		});
		expect(found?.kind).toBe('crash');
		expect(found?.stage).toBe('parse');
	});

	it('reports a serializer that throws', () => {
		const throws = fakeEngine({
			serializeCalendar: () => {
				throw new Error('no');
			},
		});
		const found = driveInput(throws, {
			text: EMPTY_CALENDAR,
			promise: 'any',
		});
		expect(found?.kind).toBe('crash');
		expect(found?.stage).toBe('serialize');
	});

	it('reports a canonical text that the boundary refuses', () => {
		let seen = 0;
		const drifts = fakeEngine({
			parseIcs: (text) => {
				seen += 1;
				return seen === 1
					? accepts()
					: {
							ok: false,
							failure: { problem: 'structure', message: text },
						};
			},
		});
		expect(
			driveInput(drifts, { text: EMPTY_CALENDAR, promise: 'any' })?.kind,
		).toBe('refused-own-text');
	});

	it('reports a canonical text that moves on the second trip', () => {
		let written = 0;
		const drifts = fakeEngine({
			parseIcs: accepts,
			serializeCalendar: () => {
				written += 1;
				return `BEGIN:VCALENDAR\r\nX-A:${'a'.repeat(written)}\r\nEND:VCALENDAR\r\n`;
			},
		});
		expect(
			driveInput(drifts, { text: EMPTY_CALENDAR, promise: 'any' })?.kind,
		).toBe('not-a-fixed-point');
	});

	it('reports a calendar that the canonical text does not carry', () => {
		let read = 0;
		const loses = fakeEngine({
			parseIcs: () => {
				read += 1;
				return {
					ok: true,
					calendar: [
						'vcalendar',
						[['x-a', {}, 'text', String(read)]],
						[],
					],
				};
			},
			serializeCalendar: () => EMPTY_CALENDAR,
		});
		expect(
			driveInput(loses, { text: EMPTY_CALENDAR, promise: 'any' })?.kind,
		).toBe('value-divergence');
	});

	it('reports a calendar that came back other than it went in', () => {
		const model: JCalComponent = [
			'vcalendar',
			[
				['version', {}, 'text', '2.0'],
				['categories', {}, 'text', 'a\\', 'b'],
			],
			[],
		];
		expect(kindOf(serializeCalendar(model), model)).toBe(
			'model-divergence',
		);
	});
});

describe('the reduction of a finding', () => {
	it('makes an input small and keeps the finding', () => {
		const text = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'SUMMARY:filler',
			'DESCRIPTION:more filler',
			'X-A;VALUE=^^^:x',
			'COMMENT:yet more filler',
			'END:VCALENDAR',
			'',
		].join('\r\n');
		const found = findingFor(text);
		const small = reduceInput(engine, found);
		expect(small.length).toBeLessThan(text.length);
		expect(kindOf(small)).toBe(found.kind);
	});

	it('leaves a finding alone when the rule of it reads the calendar', () => {
		expect(reducible('model-divergence')).toBe(false);
		expect(reducible('refused')).toBe(false);
		const found: Finding = {
			kind: 'model-divergence',
			stage: 'compare',
			detail: 'a detail',
			input: EMPTY_CALENDAR,
			model: ONE_CALENDAR,
		};
		expect(reduceInput(engine, found)).toBe(EMPTY_CALENDAR);
	});

	it('leaves an input alone when the input gives no finding by itself', () => {
		const found: Finding = {
			kind: 'crash',
			stage: 'serialize',
			detail: 'a detail',
			input: '{"not":"a calendar"}',
			model: ONE_CALENDAR,
		};
		expect(reduceInput(engine, found)).toBe('{"not":"a calendar"}');
	});
});

describe('the ledger of the filed defects', () => {
	it('recognises a colon inside a quoted parameter value', () => {
		const found = findingFor(calendar('X-A;MEMBER="a","b:c":v'));
		expect(found.kind).toBe('not-a-fixed-point');
		expect(knownFinding(engine, found)?.issue).toBe(230);
	});

	it('recognises a value that ends with an escaped backslash', () => {
		const model: JCalComponent = [
			'vcalendar',
			[
				['version', {}, 'text', '2.0'],
				['categories', {}, 'text', 'a\\', 'b'],
			],
			[],
		];
		const found = findingFor(serializeCalendar(model), model);
		expect(knownFinding(engine, found)?.issue).toBe(231);
	});

	it('reports a defect that stands beside a filed one', () => {
		// The line carries the construct of the filed defect, and the text
		// carries a second defect that the repair of that construct leaves
		// where it is. The finding is therefore new.
		const found = findingFor(
			'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-A;MEMBER="a","b:c":v\r\r\n w\r\nEND:VCALENDAR\r\n',
		);
		expect(knownFinding(engine, found)).toBeNull();
	});

	it('recognises no finding of a kind that the entry does not state', () => {
		const found: Finding = {
			kind: 'crash',
			stage: 'parse',
			detail: 'a detail',
			input: calendar('X-A;MEMBER="a","b:c":v'),
			model: undefined,
		};
		expect(knownFinding(engine, found)).toBeNull();
	});

	it('gives every entry an issue, a pattern and two repairs', () => {
		for (const entry of KNOWN_FINDINGS) {
			expect(entry.issue).toBeGreaterThan(0);
			expect(entry.kinds.length).toBeGreaterThan(0);
			expect(entry.repairValue('a:b"c\\')).not.toBe('a:b"c\\');
			expect(typeof entry.repairLine('X-A;P="a:b":v')).toBe('string');
		}
	});
});

describe('the inputs of the lane', () => {
	it('draws a calendar for each widening, and changes one that fits', () => {
		const drawn = samples(modelInput(), 60);
		const recipes = new Set(drawn.map((input) => input.recipe));
		for (const widening of WIDENINGS) {
			expect(
				[...recipes].some((recipe) => recipe.includes(widening.name)),
			).toBe(true);
		}
	});

	it('writes every calendar of the model arm as a text', () => {
		for (const input of samples(modelInput(), 40)) {
			expect(input.arm).toBe('model');
			if (input.arm === 'model') {
				expect(typeof serializeCalendar(input.model)).toBe('string');
			}
		}
	});

	it('draws texts that carry the changes of the bytes', () => {
		const drawn = samples(textInput(engine), 200);
		const recipes = drawn.map((input) => input.recipe).join('\n');
		for (const mutation of BYTE_MUTATIONS) {
			expect(recipes).toContain(mutation.name);
		}
		expect(recipes).toContain('the corpus fixture');
		expect(recipes).toContain('a feed of ordinary shape');
		expect(recipes).toContain('noise');
	});
});

describe('one run of the lane', () => {
	const options = {
		engine,
		seed: 20260821,
		budgetMs: 0,
		runsPerPass: 25,
		passLimit: 2,
		findingLimit: 5,
		now: () => 0,
	};

	it('examines the inputs of both arms and states the count', () => {
		const report = runCampaign(options);
		expect(report.passes).toBe(2);
		expect(report.examined).toBeGreaterThan(0);
		expect(runFails(report)).toBe(report.findings.length > 0);
		expect(reportLines(report)[0]).toContain(String(report.examined));
	});

	it('collects a finding of an engine that always throws', () => {
		const report = runCampaign({
			...options,
			engine: fakeEngine({
				serializeCalendar: () => {
					throw new Error('no');
				},
			}),
		});
		expect(report.findings.length).toBeGreaterThan(0);
		expect(report.findings[0]?.kind).toBe('crash');
		expect(runFails(report)).toBe(true);
		expect(failureLines(report).join('\n')).toContain(
			String(report.examined),
		);
	});

	it('fails a run that examined nothing', () => {
		const report = runCampaign({ ...options, passLimit: 0 });
		expect(report.examined).toBe(0);
		expect(runFails(report)).toBe(true);
		expect(failureLines(report)[0]).toContain('examined no input');
	});

	it('stops at the limit of new findings', () => {
		const report = runCampaign({
			...options,
			passLimit: 40,
			findingLimit: 2,
			engine: fakeEngine({
				serializeCalendar: () => {
					throw new Error('no');
				},
			}),
		});
		expect(report.findings.length).toBe(2);
		expect(report.capped).toBe(true);
	});

	it('names the seed file of a finding after the kind of it', () => {
		expect(
			seedFileName(3, {
				kind: 'crash',
				stage: 'parse',
				detail: 'a detail',
				recipe: 'a recipe',
				seed: 1,
				path: null,
				input: '',
				minimized: '',
				repeats: 0,
			}),
		).toBe('finding-03-crash.ics');
	});
});
