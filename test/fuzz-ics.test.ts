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
	seedInput,
	seedText,
	utf8CanCarry,
} from '../scripts/fuzz-ics-text';
import { samples } from './harness/arbitraries/seed';
import type { JCalComponent } from '../src/core/ics/jcal';
import type { IcsParseResult } from '../src/core/ics/parse';
import { parseIcs } from '../src/core/ics/parse';
import { serializeCalendar } from '../src/core/ics/serializer';

const engine: IcsEngine = { parseIcs, serializeCalendar };

const EMPTY_CALENDAR = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';

/**
 * One text for each entry of the ledger, in the order of the ledger. The
 * text carries the construct of that entry and nothing else, so the repair
 * of the entry must change it.
 */
const TEXTS_TO_REPAIR: readonly string[] = [
	'X-A;MEMBER="a:b":v',
	"X-A;MEMBER=^',x",
	'X-A:a\\\\,b',
	'X-A:a\rb',
	'X-A;VALUE=^^^:x',
];

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

	it('recognises a bare carriage return inside a line', () => {
		const found = findingFor(
			'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nSUMMARY:a\r\r\n b\r\nEND:VCALENDAR\r\n',
		);
		expect(found.kind).toBe('refused-own-text');
		expect(knownFinding(engine, found)?.issue).toBe(234);
	});

	it('recognises an escape in the VALUE parameter', () => {
		const found = findingFor(calendar('X-A;VALUE=^^^:x'));
		expect(found.kind).toBe('not-a-fixed-point');
		expect(knownFinding(engine, found)?.issue).toBe(235);
		const quoted = findingFor(calendar('X-A;VALUE="a;b":x'));
		expect(quoted.kind).toBe('refused-own-text');
		expect(knownFinding(engine, quoted)?.issue).toBe(235);
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

	it('reports a bare carriage return that stands beside another defect', () => {
		// The carriage return and the fold make the finding, and the text
		// carries a second defect on another line. The repair of the
		// carriage return leaves that defect where it is, so the finding is
		// not the one that the entry states, and the lane reports it.
		const found = findingFor(
			[
				'BEGIN:VCALENDAR',
				'VERSION:2.0',
				'X-A;MEMBER="a","b:c":v',
				'X-B:q\r',
				' r',
				'END:VCALENDAR',
				'',
			].join('\r\n'),
		);
		expect(found.kind).toBe('refused-own-text');
		expect(knownFinding(engine, found)).toBeNull();
	});

	it('reports a VALUE parameter that stands beside another defect', () => {
		// One line carries the construct of the entry, and the line below it
		// carries a second defect. The repair of the VALUE parameter leaves
		// that defect where it is, so the finding is not the one that the
		// entry states, and the lane reports it.
		const found = findingFor(
			[
				'BEGIN:VCALENDAR',
				'VERSION:2.0',
				'X-A;VALUE=^^^:x',
				'X-B;MEMBER="a","b:c":v',
				'END:VCALENDAR',
				'',
			].join('\r\n'),
		);
		expect(found.kind).toBe('not-a-fixed-point');
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
		// One value carries the construct of every entry, so each repair of
		// a value has something to take away. A repair of a text reads the
		// construct of its own entry alone, so each entry needs a text of
		// its own. No entry passes this case with a repair that does
		// nothing.
		const value = '\r^a:b"c\\';
		expect(TEXTS_TO_REPAIR).toHaveLength(KNOWN_FINDINGS.length);
		for (const [at, entry] of KNOWN_FINDINGS.entries()) {
			const text = TEXTS_TO_REPAIR[at] ?? '';
			expect(entry.issue).toBeGreaterThan(0);
			expect(entry.kinds.length).toBeGreaterThan(0);
			expect(entry.repairValue(value)).not.toBe(value);
			expect(entry.pattern.test(text)).toBe(true);
			expect(entry.repairText(text)).not.toBe(text);
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
		const finding = {
			kind: 'crash',
			stage: 'parse',
			detail: 'a detail',
			recipe: 'a recipe',
			seed: 1,
			path: null,
			input: '',
			minimized: '',
			repeats: 0,
		} as const;
		expect(seedFileName(3, finding)).toBe('finding-03-crash.json');
		expect(seedFileName(3, finding, 'as-drawn')).toBe(
			'finding-03-crash.as-drawn.json',
		);
	});
});

describe('the seed file of a finding', () => {
	// A file holds octets, and this lane writes its files as UTF-8. UTF-8
	// carries no lone surrogate. A seed file that held the input as text
	// therefore held the replacement character in the place of such a code
	// unit. `--graduate` then wrote a fixture that states another input than
	// the finding. The seed file holds one JSON string for that reason.
	//
	// The text below is the smallest input of one finding of a real run. The
	// generator drew a high surrogate with no low surrogate after it.
	const LONE_SURROGATE = 'BEGIN:VCALENDAR\n:\r\r\n \ud83d\nEND:VCALENDAR';

	it('gives back every input, code unit for code unit', () => {
		for (const input of [
			'',
			EMPTY_CALENDAR,
			'X-A:a\rb',
			LONE_SURROGATE,
			'X-A:\udca9',
			'X-A:\ud83d\udca9',
			'X-A:\u0000\u001f\u007f',
			'X-A:"\\\n\t',
		]) {
			expect(seedInput(seedText(input))).toBe(input);
		}
	});

	it('writes a lone surrogate as an escape, and the file keeps it', () => {
		const text = seedText(LONE_SURROGATE);
		expect(text).toContain('\\ud83d');
		// The text of the seed file goes through UTF-8 whole, and the input
		// that the seed file states does not. That difference is the reason
		// for the encoding.
		expect(utf8CanCarry(text)).toBe(true);
		expect(utf8CanCarry(LONE_SURROGATE)).toBe(false);
		expect(seedInput(text)).toBe(LONE_SURROGATE);
	});

	it('reads no input from a text that is not one JSON string', () => {
		for (const text of ['', 'BEGIN:VCALENDAR\r\n', '[1]', 'null', '"a']) {
			expect(seedInput(text)).toBeNull();
		}
	});
});
