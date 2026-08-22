/**
 * The rules of the fuzzing lane. The lane runs on request and outside the
 * required check. These cases run inside the required check, because they
 * hold the rules that decide what a finding is, which findings are already
 * filed, and when a run fails.
 *
 * The ledger of the filed defects is empty. The parse boundary refuses every
 * shape that an entry of it named, and each entry left the ledger together
 * with the change that repaired its defect. The rule of the ledger stays in
 * use, because the next defect that somebody files needs it.
 *
 * The rule recognises a finding by a repair that removes it. A case of that
 * rule therefore needs an engine with a defect that a repair can remove. The
 * boundary holds no such defect. Each case below drives an engine that
 * carries one defect of its own, and it gives the rule an entry that names
 * that defect. Those entries belong to the case and not to the lane, and the
 * lane reads none of them.
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
import type { KnownFinding } from '../scripts/fuzz-ics-ledger';
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

/** The finding that a drive of one engine gives, or null. */
function findingBy(
	driven: IcsEngine,
	text: string,
	model?: JCalComponent,
): Finding | null {
	return driveInput(driven, {
		text,
		promise: model === undefined ? 'any' : 'accepted',
		...(model === undefined ? {} : { model }),
	});
}

/** The finding that a drive gives. The helper throws where it gives none. */
function findingFor(
	text: string,
	model?: JCalComponent,
	driven: IcsEngine = engine,
): Finding {
	const found = findingBy(driven, text, model);
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

/**
 * An engine that writes one more tilde and one more number sign on every
 * trip. A calendar that holds one of those characters therefore has no
 * canonical text that stands still, and the drive reports it. The two
 * characters are apart from each other, so a text can carry two defects that
 * one repair does not remove together.
 */
const marksEngine: IcsEngine = fakeEngine({
	serializeCalendar: (component) =>
		serializeCalendar(component).replace('~', '~~').replace('#', '##'),
});

/**
 * An engine whose parse throws on a text that holds a fold and a tilde. The
 * construct of this defect is a byte of the framing of the text. A reader
 * that rebuilds the text from its logical lines writes the framing again and
 * takes the fold away, so an entry for this defect reads the whole text.
 */
const foldEngine: IcsEngine = fakeEngine({
	parseIcs: (text) => {
		if (text.includes('\r\n ') && text.includes('~')) {
			throw new Error('this engine cannot read a fold');
		}
		return parseIcs(text);
	},
});

/**
 * An engine that writes one more tilde on every trip, and that throws on a
 * calendar which holds no tilde. The repair of the tilde therefore gives a
 * calendar that the serializer cannot write.
 */
const brittleEngine: IcsEngine = fakeEngine({
	serializeCalendar: (component) => {
		const text = serializeCalendar(component);
		if (!text.includes('~')) {
			throw new Error('this engine writes no calendar without a tilde');
		}
		return text.replace('~', '~~');
	},
});

/** One entry of a case, with the text and the value that its repairs must change. */
interface EntryCase {
	readonly entry: KnownFinding;
	readonly text: string;
	readonly value: string;
}

const TILDE: EntryCase = {
	entry: {
		issue: 9001,
		name: 'a value that holds a tilde',
		// A text that carries the tilde gives a canonical text that moves.
		// A calendar that carries it comes back from its own text with one
		// more of them, so the model arm reports the difference first.
		kinds: ['not-a-fixed-point', 'model-divergence'],
		pattern: /~/,
		site: 'value',
		repairValue: (value) => value.replaceAll('~', 'a'),
		frame: 'logical-lines',
		repairText: (line) => line.replaceAll('~', 'a'),
	},
	text: 'X-A:~',
	value: 'a~b',
};

const NUMBER_SIGN: EntryCase = {
	entry: {
		issue: 9002,
		name: 'a value that holds a number sign',
		kinds: ['not-a-fixed-point'],
		pattern: /#/,
		site: 'value',
		repairValue: (value) => value.replaceAll('#', 'a'),
		frame: 'logical-lines',
		repairText: (line) => line.replaceAll('#', 'a'),
	},
	text: 'X-B:#',
	value: 'a#b',
};

const FOLD: EntryCase = {
	entry: {
		issue: 9003,
		name: 'a fold in a line that holds a tilde',
		kinds: ['crash'],
		pattern: /~/,
		site: 'value',
		repairValue: (value) => value.replaceAll('~', 'a'),
		frame: 'whole-text',
		repairText: (text) => text.replaceAll('\r\n ', ''),
	},
	text: 'X-A:~\r\n b',
	value: 'a~b',
};

const ENTRY_CASES: readonly EntryCase[] = [TILDE, NUMBER_SIGN, FOLD];

/** The ledger that one case gives to the rule. */
function ledgerOf(...cases: readonly EntryCase[]): readonly KnownFinding[] {
	return cases.map((one) => one.entry);
}

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
			[['version', {}, 'text', '2.0']],
			[],
		];
		const other: JCalComponent = [
			'vcalendar',
			[['version', {}, 'text', '2.1']],
			[],
		];
		const drifts = fakeEngine({
			parseIcs: () => ({ ok: true, calendar: other }),
		});
		expect(
			driveInput(drifts, {
				text: serializeCalendar(model),
				promise: 'accepted',
				model,
			})?.kind,
		).toBe('model-divergence');
	});

	it('reports a refusal of the text of a calendar that no text states', () => {
		// The serializer writes a value that ends with a backslash as two
		// backslashes, which is the encoding that the format states. The
		// library reads that pair and the separator after it as one escape,
		// so it reports one value where the text states two, and the
		// boundary refuses the text. Such a calendar can be built and it
		// cannot be parsed, so it lies outside the range of the boundary.
		// The drive states that the boundary refuses the text, and it does
		// not say that the boundary is wrong to do so.
		const model: JCalComponent = [
			'vcalendar',
			[
				['version', {}, 'text', '2.0'],
				['categories', {}, 'text', 'a\\', 'b'],
			],
			[],
		];
		expect(kindOf(serializeCalendar(model), model)).toBe('refused');
	});
});

describe('the reduction of a finding', () => {
	it('makes an input small and keeps the finding', () => {
		const text = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'SUMMARY:filler',
			'DESCRIPTION:more filler',
			TILDE.text,
			'COMMENT:yet more filler',
			'END:VCALENDAR',
			'',
		].join('\r\n');
		const found = findingFor(text, undefined, marksEngine);
		const small = reduceInput(marksEngine, found);
		expect(small.length).toBeLessThan(text.length);
		expect(findingBy(marksEngine, small)?.kind).toBe(found.kind);
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
	it('holds no entry, because the boundary refuses every shape that it held', () => {
		// Each entry of this ledger left it together with the change that
		// repaired its defect. A run of the lane therefore reports every
		// finding as new. An entry arrives again with the next defect that
		// somebody files.
		expect(KNOWN_FINDINGS).toEqual([]);
	});

	it('recognises a finding whose repair over the lines removes it', () => {
		const found = findingFor(calendar(TILDE.text), undefined, marksEngine);
		expect(found.kind).toBe('not-a-fixed-point');
		expect(knownFinding(marksEngine, found, ledgerOf(TILDE))?.issue).toBe(
			TILDE.entry.issue,
		);
	});

	it('recognises a finding whose repair over the whole text removes it', () => {
		const found = findingFor(calendar(FOLD.text), undefined, foldEngine);
		expect(found.kind).toBe('crash');
		expect(knownFinding(foldEngine, found, ledgerOf(FOLD))?.issue).toBe(
			FOLD.entry.issue,
		);
	});

	it('recognises a finding of a calendar whose repair of a value removes it', () => {
		const model: JCalComponent = [
			'vcalendar',
			[
				['version', {}, 'text', '2.0'],
				['summary', {}, 'text', 'a~b'],
			],
			[],
		];
		const found = findingFor(
			marksEngine.serializeCalendar(model),
			model,
			marksEngine,
		);
		expect(knownFinding(marksEngine, found, ledgerOf(TILDE))?.issue).toBe(
			TILDE.entry.issue,
		);
	});

	it('recognises a finding of a calendar whose repair of a parameter removes it', () => {
		const entry: KnownFinding = { ...TILDE.entry, site: 'parameter' };
		const model: JCalComponent = [
			'vcalendar',
			[
				['version', {}, 'text', '2.0'],
				['summary', { 'x-p': 'a~b' }, 'text', 'v'],
			],
			[],
		];
		const found = findingFor(
			marksEngine.serializeCalendar(model),
			model,
			marksEngine,
		);
		expect(knownFinding(marksEngine, found, [entry])?.issue).toBe(
			entry.issue,
		);
	});

	it('reports a defect that stands beside the construct of an entry', () => {
		// The text carries the construct of the entry and a second defect
		// that the repair of that construct leaves where it is. The finding
		// is therefore new, and the lane reports it. This is the condition
		// that keeps the ledger narrow.
		const text = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			TILDE.text,
			NUMBER_SIGN.text,
			'END:VCALENDAR',
			'',
		].join('\r\n');
		const found = findingFor(text, undefined, marksEngine);
		expect(found.kind).toBe('not-a-fixed-point');
		expect(knownFinding(marksEngine, found, ledgerOf(TILDE))).toBeNull();
		expect(
			knownFinding(marksEngine, found, ledgerOf(NUMBER_SIGN)),
		).toBeNull();
		// The control: each construct on its own is a finding that its entry
		// recognises. The two nulls above therefore come from the second
		// defect and not from an entry that recognises nothing.
		for (const one of [TILDE, NUMBER_SIGN]) {
			const alone = findingFor(
				calendar(one.text),
				undefined,
				marksEngine,
			);
			expect(knownFinding(marksEngine, alone, [one.entry])?.issue).toBe(
				one.entry.issue,
			);
		}
	});

	// Each case below cripples one part of an entry that the case above
	// proved works, and it asks for a null. The whole entry stands beside the
	// crippled one as the control, so the null comes from the part that the
	// case took away.
	it('reports a finding of a kind that the entry does not state', () => {
		const found = findingFor(calendar(TILDE.text), undefined, marksEngine);
		const entry: KnownFinding = { ...TILDE.entry, kinds: ['crash'] };
		expect(knownFinding(marksEngine, found, [entry])).toBeNull();
		expect(
			knownFinding(marksEngine, found, ledgerOf(TILDE)),
		).not.toBeNull();
	});

	it('reports a finding whose construct no logical line carries', () => {
		const found = findingFor(calendar(TILDE.text), undefined, marksEngine);
		const entry: KnownFinding = { ...TILDE.entry, pattern: /zzz/ };
		expect(knownFinding(marksEngine, found, [entry])).toBeNull();
		expect(
			knownFinding(marksEngine, found, ledgerOf(TILDE)),
		).not.toBeNull();
	});

	it('reports a finding that the rebuild of the text removes by itself', () => {
		// The entry reads one logical line at a time, and the runner rebuilds
		// the text from those lines before it repairs one. The rebuild takes
		// the fold away, and the fold is what made the finding. Without the
		// control of the rebuild, that removal would read as a repair that
		// worked. The entry that reads the whole text recognises the same
		// finding, so the frame is the one thing that decides this.
		const found = findingFor(calendar(FOLD.text), undefined, foldEngine);
		const entry: KnownFinding = { ...FOLD.entry, frame: 'logical-lines' };
		expect(knownFinding(foldEngine, found, [entry])).toBeNull();
		expect(knownFinding(foldEngine, found, ledgerOf(FOLD))).not.toBeNull();
	});

	it('reports a finding whose repair changes nothing', () => {
		const found = findingFor(calendar(TILDE.text), undefined, marksEngine);
		const entry: KnownFinding = {
			...TILDE.entry,
			repairText: (line) => line,
		};
		expect(knownFinding(marksEngine, found, [entry])).toBeNull();
		expect(
			knownFinding(marksEngine, found, ledgerOf(TILDE)),
		).not.toBeNull();
	});

	it('reports a finding whose repair gives a text that the boundary refuses', () => {
		const found = findingFor(calendar(TILDE.text), undefined, marksEngine);
		const entry: KnownFinding = {
			...TILDE.entry,
			repairText: () => 'BEGIN:VCALENDAR',
		};
		expect(knownFinding(marksEngine, found, [entry])).toBeNull();
		expect(
			knownFinding(marksEngine, found, ledgerOf(TILDE)),
		).not.toBeNull();
	});

	it('reports a finding of a calendar whose repair changes no text', () => {
		// The site of the entry names the parameters, and the calendar holds
		// its tilde in a value. The repair therefore writes the same text
		// again, and it proves nothing.
		const entry: KnownFinding = { ...TILDE.entry, site: 'parameter' };
		const model: JCalComponent = [
			'vcalendar',
			[
				['version', {}, 'text', '2.0'],
				['summary', {}, 'text', 'a~b'],
			],
			[],
		];
		const found = findingFor(
			marksEngine.serializeCalendar(model),
			model,
			marksEngine,
		);
		expect(knownFinding(marksEngine, found, [entry])).toBeNull();
		expect(
			knownFinding(marksEngine, found, ledgerOf(TILDE)),
		).not.toBeNull();
	});

	it('reports a finding of a calendar that the serializer cannot write again', () => {
		const model: JCalComponent = [
			'vcalendar',
			[
				['version', {}, 'text', '2.0'],
				['summary', {}, 'text', 'a~b'],
			],
			[],
		];
		const found = findingFor(
			brittleEngine.serializeCalendar(model),
			model,
			brittleEngine,
		);
		// The kind and the construct both match, so the null comes from the
		// serializer alone. No entry recognises this finding, because every
		// repair of it gives a calendar that this serializer refuses.
		expect(TILDE.entry.kinds).toContain(found.kind);
		expect(TILDE.entry.pattern.test(found.input)).toBe(true);
		expect(knownFinding(brittleEngine, found, ledgerOf(TILDE))).toBeNull();
	});

	it('gives every entry an issue, a pattern and two repairs', () => {
		// The rule of this case holds for every entry that the ledger ever
		// takes. Each entry states a text that its repair of a text must
		// change, and a value that its repair of a value must change. No
		// entry passes this case with a repair that does nothing.
		for (const one of ENTRY_CASES) {
			expect(one.entry.issue).toBeGreaterThan(0);
			expect(one.entry.kinds.length).toBeGreaterThan(0);
			expect(one.entry.pattern.test(one.text)).toBe(true);
			expect(one.entry.repairText(one.text)).not.toBe(one.text);
			expect(one.entry.repairValue(one.value)).not.toBe(one.value);
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
