/**
 * One run of the fuzzing lane.
 *
 * A run is a series of passes. Each pass draws inputs from one arm, under
 * one seed, and it stops when it has drawn its count of inputs or when the
 * budget of the run runs out. The arms take turns, so a short run covers
 * both of them and a long run covers each of them further.
 *
 * The seed of a pass is the seed of the run plus the number of the pass.
 * The seed of the run is the constant that the property tests use, unless
 * the caller names another one. Two runs of one commit with one seed and
 * one budget therefore draw the same inputs. A longer budget draws more
 * passes, and those passes reach further into the space.
 *
 * A finding that the ledger recognises is counted and set aside, and the
 * pass goes on. A finding that no entry of the ledger recognises ends the
 * pass. The generator then makes the input smaller, the run reduces the
 * text further where the rule of the finding permits it, and the run
 * records the finding. The next pass starts under the next seed.
 *
 * A run ends on three conditions: the budget is spent, the passes are
 * spent, or the count of new findings reaches the limit. The limit exists
 * because one defect can answer to many inputs, and a run that reports a
 * thousand of them says no more than a run that reports twenty.
 */

import fc from 'fast-check';
import type {
	Finding,
	FindingKind,
	FindingStage,
	IcsEngine,
} from './fuzz-ics-core.ts';
import { driveInput, reduceInput } from './fuzz-ics-core.ts';
import type { FuzzInput } from './fuzz-ics-inputs.ts';
import { modelInput, textInput } from './fuzz-ics-inputs.ts';
import type { KnownFinding } from './fuzz-ics-ledger.ts';
import { KNOWN_FINDINGS, knownFinding } from './fuzz-ics-ledger.ts';

/** What one run needs to know. */
export interface CampaignOptions {
	readonly engine: IcsEngine;
	/** The seed of the first pass. */
	readonly seed: number;
	/** How long the run may take, in milliseconds. Zero states no limit. */
	readonly budgetMs: number;
	/** How many inputs one pass draws. */
	readonly runsPerPass: number;
	/** How many passes the run may make. */
	readonly passLimit: number;
	/** How many new findings the run may collect. */
	readonly findingLimit: number;
	/** The clock that measures the run. */
	readonly now: () => number;
	/**
	 * The defects that are already filed. An empty ledger makes the run
	 * report every finding, and a person uses that to see the known ones.
	 */
	readonly ledger?: readonly KnownFinding[];
}

/** One new finding of a run. */
export interface RunFinding {
	readonly kind: FindingKind;
	readonly stage: FindingStage;
	readonly detail: string;
	/** Which arm drew the input, and what the arm did to it. */
	readonly recipe: string;
	/** The seed of the pass that found it. */
	readonly seed: number;
	/** The path that repeats the draw under that seed. */
	readonly path: string | null;
	/** The input as the generator left it. */
	readonly input: string;
	/** The smallest input that the run found for this finding. */
	readonly minimized: string;
	/**
	 * How many times the run met this finding again, with the same kind and
	 * the same smallest input. The limit of the run counts the findings and
	 * not these repeats.
	 */
	readonly repeats: number;
}

/** One entry of the ledger, and how often the run met it. */
export interface KnownTally {
	readonly issue: number;
	readonly name: string;
	readonly count: number;
	/** One input that gave the finding. */
	readonly example: string;
}

/** What a run has to say. */
export interface RunReport {
	readonly seed: number;
	readonly budgetMs: number;
	readonly elapsedMs: number;
	readonly examined: number;
	readonly passes: number;
	readonly shrinks: number;
	readonly known: readonly KnownTally[];
	readonly findings: readonly RunFinding[];
	/** True when the run stopped because it reached its limit of findings. */
	readonly capped: boolean;
}

/** True when the run must fail the lane. */
export function runFails(report: RunReport): boolean {
	return report.findings.length > 0 || report.examined === 0;
}

/** Runs one campaign and gives the report of it. */
export function runCampaign(options: CampaignOptions): RunReport {
	const { engine, now } = options;
	const ledger = options.ledger ?? KNOWN_FINDINGS;
	const started = now();
	const tallies = new Map<
		string,
		{ entry: KnownFinding; count: number; example: string }
	>();
	const findings: RunFinding[] = [];
	let examined = 0;
	let shrinks = 0;
	let passes = 0;
	let capped = false;

	const remaining = (): number =>
		options.budgetMs === 0
			? Number.POSITIVE_INFINITY
			: options.budgetMs - (now() - started);

	while (passes < options.passLimit && remaining() > 0) {
		if (findings.length >= options.findingLimit) {
			capped = true;
			break;
		}
		const seed = options.seed + passes;
		const arm = passes % 2 === 0 ? modelInput() : textInput(engine);
		const property = fc.property(arm, (input: FuzzInput) => {
			const found = findingOf(engine, input);
			if (found === null) {
				return true;
			}
			const entry = knownFinding(engine, found, ledger);
			if (entry === null) {
				return false;
			}
			tally(tallies, entry, found);
			return true;
		});
		const limit = remaining();
		const details = fc.check(property, {
			seed,
			numRuns: options.runsPerPass,
			...(Number.isFinite(limit)
				? {
						interruptAfterTimeLimit: Math.max(1, Math.floor(limit)),
						markInterruptAsFailure: false,
					}
				: {}),
		});
		examined += details.numRuns;
		shrinks += details.numShrinks;
		passes += 1;
		const counterexample = details.counterexample?.[0];
		if (details.failed && counterexample !== undefined) {
			collect(
				findings,
				recordOf(
					engine,
					counterexample,
					seed,
					details.counterexamplePath,
				),
			);
		}
	}
	return {
		seed: options.seed,
		budgetMs: options.budgetMs,
		elapsedMs: Math.round(now() - started),
		examined,
		passes,
		shrinks,
		known: [...tallies.values()].map(({ entry, count, example }) => ({
			issue: entry.issue,
			name: entry.name,
			count,
			example,
		})),
		findings,
		capped,
	};
}

/**
 * The finding that one input gives, or null. The model arm carries a
 * calendar, and the serializer writes the text of it here. A serializer
 * that throws on such a calendar is a finding of the run.
 */
export function findingOf(engine: IcsEngine, input: FuzzInput): Finding | null {
	if (input.arm === 'text') {
		return driveInput(engine, { text: input.text, promise: 'any' });
	}
	let text: string;
	try {
		text = engine.serializeCalendar(input.model);
	} catch (error) {
		return {
			kind: 'crash',
			stage: 'serialize',
			detail: `the serializer threw on a generated calendar: ${
				error instanceof Error ? error.message : String(error)
			}`,
			input: JSON.stringify(input.model),
			model: input.model,
		};
	}
	return driveInput(engine, {
		text,
		promise: input.promise,
		model: input.model,
	});
}

/**
 * Puts one finding into the list of the run. A finding of the same kind
 * with the same smallest input is the same finding, and it raises the count
 * of repeats of the finding that stands there. One defect answers to many
 * inputs, and a report that names one shape one time is the report that a
 * person can read.
 */
function collect(findings: RunFinding[], found: RunFinding): void {
	const at = findings.findIndex(
		(held) =>
			held.kind === found.kind && held.minimized === found.minimized,
	);
	const held = findings[at];
	if (held === undefined) {
		findings.push(found);
		return;
	}
	findings[at] = { ...held, repeats: held.repeats + 1 };
}

function recordOf(
	engine: IcsEngine,
	input: FuzzInput,
	seed: number,
	path: string | null,
): RunFinding {
	const found = findingOf(engine, input);
	if (found === null) {
		return {
			kind: 'crash',
			stage: 'compare',
			detail: 'the run could not repeat the finding on the input that the generator left; report this run',
			recipe: input.recipe,
			seed,
			path,
			input:
				input.arm === 'text' ? input.text : JSON.stringify(input.model),
			minimized: '',
			repeats: 0,
		};
	}
	return {
		kind: found.kind,
		stage: found.stage,
		detail: found.detail,
		recipe: input.recipe,
		seed,
		path,
		input: found.input,
		minimized: reduceInput(engine, found),
		repeats: 0,
	};
}

function tally(
	tallies: Map<
		string,
		{ entry: KnownFinding; count: number; example: string }
	>,
	entry: KnownFinding,
	found: Finding,
): void {
	const key = `${String(entry.issue)}: ${entry.name}`;
	const held = tallies.get(key);
	if (held === undefined) {
		tallies.set(key, { entry, count: 1, example: found.input });
		return;
	}
	tallies.set(key, { ...held, count: held.count + 1 });
}
