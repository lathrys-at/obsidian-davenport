/**
 * What the fuzzing lane counts as a finding, and how it makes a finding
 * small.
 *
 * A feed subscription points at any location that the user names. The parse
 * boundary therefore receives every byte that a generator, a proxy or an
 * attacker sends. On arbitrary bytes the boundary must give a calendar, or
 * it must refuse the bytes and name the reason. The boundary must never
 * throw.
 *
 * The drive below sends one input through the boundary and then through the
 * canonical serializer, and it sends the canonical text back through the
 * boundary. The rules that the drive holds:
 *
 * - No call throws. A throw is a finding, whichever call threw.
 * - A refusal names one of the problems that the boundary states, and it
 *   carries a message. A refusal that names nothing is a finding.
 * - Text that the serializer wrote comes back through the boundary. A
 *   refusal of such a text is a finding.
 * - The canonical text is a fixed point. The serializer reads its own
 *   output and writes the same bytes again. Other bytes are a finding.
 * - The canonical text holds the calendar that went into it. A trip from
 *   the calendar to the canonical text and back gives another calendar, and
 *   a difference in the content of the two is a finding.
 * - A caller that knows which calendar the input states gives that calendar
 *   to the drive. The calendar that comes back must hold the same content.
 *   A difference is a finding. Only the arm that builds the text from a
 *   model knows this, so only that arm gives the calendar.
 *
 * The reduction takes a finding and looks for a smaller input that gives a
 * finding of the same kind. It removes lines, and then it removes runs of
 * characters. The reduction reads the text alone, so it does not apply to a
 * finding whose rule reads the calendar that went in: a cut text no longer
 * states that calendar.
 */

import { contentOf } from '../test/harness/ics-content.ts';
import type { JCalComponent } from '../src/core/ics/jcal.ts';
import type {
	IcsParseFailure,
	IcsParseProblem,
	IcsParseResult,
} from '../src/core/ics/parse.ts';

/** The part of the engine that the lane drives. */
export interface IcsEngine {
	readonly parseIcs: (text: string) => IcsParseResult;
	readonly serializeCalendar: (calendar: JCalComponent) => string;
}

/** What is wrong with the input, or with what the engine did with it. */
export type FindingKind =
	/** A call threw an error. */
	| 'crash'
	/** The boundary refused the input, and the refusal names nothing. */
	| 'illegible-refusal'
	/** The boundary refused an input that it must accept. */
	| 'refused'
	/** The boundary refused the canonical text of an input that it read. */
	| 'refused-own-text'
	/** The canonical text of the canonical text holds other bytes. */
	| 'not-a-fixed-point'
	/** The canonical text gives back a calendar with other content. */
	| 'value-divergence'
	/** The calendar that came back is not the calendar that went in. */
	| 'model-divergence';

/** Where in the drive the finding arose. */
export type FindingStage =
	'parse' | 'serialize' | 'reparse' | 'reserialize' | 'compare';

/** One finding, with the input that gives it. */
export interface Finding {
	readonly kind: FindingKind;
	readonly stage: FindingStage;
	/** One sentence that states what the drive saw. */
	readonly detail: string;
	/** The input that gives the finding. */
	readonly input: string;
	/**
	 * The calendar that the caller built the input from, where the caller
	 * knows it. A finding from arbitrary bytes carries nothing here.
	 */
	readonly model: JCalComponent | undefined;
}

/**
 * Whether the boundary must accept the input. The text of a serializer must
 * come back through the boundary, and so must a text that a change which
 * keeps the meaning made from such a text. Arbitrary bytes carry no such
 * promise: a refusal of those is the correct answer.
 */
export type InputPromise = 'accepted' | 'any';

/** What the caller knows about an input before the drive reads it. */
export interface DriveRequest {
	readonly text: string;
	readonly promise: InputPromise;
	/**
	 * The calendar that the text states, where the caller built the text
	 * from that calendar. The drive compares the calendar that comes back
	 * against this one.
	 */
	readonly model?: JCalComponent;
}

/**
 * The problems that the parse boundary states. A refusal names one of them.
 * The type of the record holds one key for each problem of the boundary, so
 * a problem that the boundary adds later stops the build here.
 */
const PARSE_PROBLEMS: Readonly<Record<IcsParseProblem, true>> = {
	unreadable: true,
	'no-calendar': true,
	'many-calendars': true,
	'not-jcal': true,
	structure: true,
	value: true,
};

/** The same problems, as the names that a comparison reads. */
const PROBLEM_NAMES: readonly string[] = Object.keys(PARSE_PROBLEMS);

/**
 * Drives one input through the boundary and the serializer, and gives the
 * first finding that the input makes. An input that meets every rule gives
 * nothing back.
 */
export function driveInput(
	engine: IcsEngine,
	request: DriveRequest,
): Finding | null {
	const { text, promise } = request;
	const found = (
		kind: FindingKind,
		stage: FindingStage,
		detail: string,
	): Finding => ({ kind, stage, detail, input: text, model: request.model });
	let parsed: IcsParseResult;
	try {
		parsed = engine.parseIcs(text);
	} catch (error) {
		return found('crash', 'parse', `the parse threw ${said(error)}`);
	}
	if (!parsed.ok) {
		const illegible = refusalProblem(parsed.failure);
		if (illegible !== null) {
			return found('illegible-refusal', 'parse', illegible);
		}
		return promise === 'accepted'
			? found(
					'refused',
					'parse',
					`the boundary refused a text that came from the serializer, and it said: ${parsed.failure.message}`,
				)
			: null;
	}
	const calendar = parsed.calendar;
	if (request.model !== undefined) {
		const wanted = contentOf(request.model);
		const given = contentOf(calendar);
		if (wanted !== given) {
			return found(
				'model-divergence',
				'compare',
				`the calendar that went in states ${short(wanted)}, and the calendar that came back states ${short(given)}`,
			);
		}
	}
	let canonical: string;
	try {
		canonical = engine.serializeCalendar(calendar);
	} catch (error) {
		return found(
			'crash',
			'serialize',
			`the serializer threw ${said(error)}`,
		);
	}
	let again: IcsParseResult;
	try {
		again = engine.parseIcs(canonical);
	} catch (error) {
		return found(
			'crash',
			'reparse',
			`the parse of the canonical text threw ${said(error)}`,
		);
	}
	if (!again.ok) {
		return found(
			'refused-own-text',
			'reparse',
			`the boundary refused its own canonical text, and it said: ${again.failure.message}`,
		);
	}
	let twice: string;
	try {
		twice = engine.serializeCalendar(again.calendar);
	} catch (error) {
		return found(
			'crash',
			'reserialize',
			`the serializer threw on its own canonical text: ${said(error)}`,
		);
	}
	if (twice !== canonical) {
		return found(
			'not-a-fixed-point',
			'reserialize',
			`the canonical text holds ${String(canonical.length)} characters, the canonical text of that text holds ${String(twice.length)}, and the first difference stands at ${String(firstDifference(canonical, twice))}`,
		);
	}
	const before = contentOf(calendar);
	const after = contentOf(again.calendar);
	return before === after
		? null
		: found(
				'value-divergence',
				'compare',
				`the calendar states ${short(before)}, and the calendar of the canonical text states ${short(after)}`,
			);
}

/**
 * A smaller input that gives a finding of the same kind, or the input that
 * came in when no smaller input does. The reduction removes whole lines
 * first, because a calendar is a list of lines and a removed line takes a
 * whole property away. Then it removes runs of characters, so a value
 * becomes short and a name becomes short.
 *
 * The reduction drives an input for each candidate, and `limit` states how
 * many drives it may spend. A reduction that reaches the limit gives the
 * smallest input that it found up to that point.
 */
export function reduceInput(
	engine: IcsEngine,
	found: Finding,
	limit = 4000,
): string {
	if (!reducible(found.kind)) {
		return found.input;
	}
	// The reduction keeps the input that still gives this kind of finding.
	// An input that does not give it at the start gives the reduction no
	// ground to stand on. The input of a finding that arose before the
	// drive read the text is one of these.
	const base = driveInput(engine, { text: found.input, promise: 'any' });
	if (base?.kind !== found.kind) {
		return found.input;
	}
	let spent = 0;
	const gives = (candidate: string): boolean => {
		if (spent >= limit || candidate === '') {
			return false;
		}
		spent += 1;
		const result = driveInput(engine, { text: candidate, promise: 'any' });
		return result !== null && result.kind === found.kind;
	};
	return reduceRuns(reduceLines(found.input, gives), gives);
}

/** Removes lines while the finding stays. */
function reduceLines(
	text: string,
	gives: (candidate: string) => boolean,
): string {
	let best = text;
	const ending = best.includes('\r\n') ? '\r\n' : '\n';
	for (let width = 8; width >= 1; width = Math.floor(width / 2)) {
		let changed = true;
		while (changed) {
			changed = false;
			const lines = best.split(ending);
			for (let at = 0; at + width <= lines.length; at += 1) {
				const candidate = [
					...lines.slice(0, at),
					...lines.slice(at + width),
				].join(ending);
				if (gives(candidate)) {
					best = candidate;
					changed = true;
					break;
				}
			}
		}
	}
	return best;
}

/** Removes runs of characters while the finding stays. */
function reduceRuns(
	text: string,
	gives: (candidate: string) => boolean,
): string {
	let best = text;
	for (let width = 32; width >= 1; width = Math.floor(width / 2)) {
		let changed = true;
		while (changed) {
			changed = false;
			for (let at = 0; at + width <= best.length; at += 1) {
				const candidate = best.slice(0, at) + best.slice(at + width);
				if (gives(candidate)) {
					best = candidate;
					changed = true;
					break;
				}
			}
		}
	}
	return best;
}

/**
 * True for a finding that a cut text can still give. Two kinds fall
 * outside. A finding that reads the calendar that went in needs that
 * calendar, and a cut text no longer states it. A refusal is a finding only
 * where the text carries the promise of the serializer, and a cut text
 * carries no such promise.
 */
export function reducible(kind: FindingKind): boolean {
	return kind !== 'model-divergence' && kind !== 'refused';
}

/**
 * Why a refusal names nothing, or null for a refusal that names a problem
 * and carries a message.
 */
function refusalProblem(failure: IcsParseFailure): string | null {
	if (!PROBLEM_NAMES.includes(failure.problem)) {
		return `the boundary refused the text with the problem ${JSON.stringify(failure.problem)}, and the boundary states no such problem`;
	}
	if (failure.message.trim() === '') {
		return 'the boundary refused the text and gave an empty message';
	}
	return null;
}

/** The place of the first character that differs in two texts. */
function firstDifference(left: string, right: string): number {
	const shared = Math.min(left.length, right.length);
	for (let at = 0; at < shared; at += 1) {
		if (left[at] !== right[at]) {
			return at;
		}
	}
	return shared;
}

/**
 * The text, cut short where it is long. A detail line of a report states
 * what the drive saw, and the content of a whole calendar does not fit on
 * such a line. The seed file beside the report holds the whole input.
 */
function short(text: string, limit = 240): string {
	return text.length <= limit
		? text
		: `${text.slice(0, limit)}… (${String(text.length)} characters)`;
}

function said(error: unknown): string {
	return error instanceof Error
		? `${error.name}: ${error.message}`
		: String(error);
}
