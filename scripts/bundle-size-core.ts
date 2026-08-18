/**
 * The decisions behind the bundle-size check:
 *
 * - what the metafile of the build says about the output files;
 * - which module gets the bytes of each part of an output file;
 * - what the measurement of the built files adds up to;
 * - how much growth past the baseline the check accepts;
 * - what grew, and what got smaller.
 *
 * No function here reads a file, and no function compresses anything. The
 * caller reads the metafile, reads the built files, compresses them, and
 * gives the numbers to these functions. Therefore a test can exercise every
 * decision directly. `bundle-size.mjs` finds the files, measures them,
 * prints the report, and sets the exit status. `bundle-size-text.ts` holds
 * the wording that the check prints.
 *
 * This check is an instrument for attribution, and it is not a budget. The
 * report is the point. The report says which module cost how many bytes, and
 * it gives each output file a line of its own. A chunk that loads lazily is
 * an output file of its own. Therefore a claim about lazy loading is
 * checkable here. The comparison fails on growth of the order of magnitude,
 * and `stepFor` states that limit in bytes. The comparison also fails on an
 * output file that the baseline holds and the build no longer makes, because
 * a payload that stops loading lazily can keep the total the same.
 *
 * A build that gives this module nothing to measure is a fault, and the
 * check fails on it. A metafile that does not describe the files on disk is
 * also a fault. Such a change never leaves a check that measures nothing and
 * reports success.
 */

/** A value that the text gave, or the reason that the text cannot give it. */
export type Reading<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly reason: string };

/** The name that the report gives to the bytes that no module accounts for. */
export const OVERHEAD = '(build overhead)';

/** The smallest growth that fails this check, in bytes. */
const STEP_FLOOR = 51_200;

/** The part of the baseline that the check accepts as growth. */
const STEP_SHARE = 0.5;

/**
 * The growth past the baseline that the check accepts. The step is the
 * larger of 50 kB and half of the baseline, because half of a large bundle
 * is many kilobytes of intended growth, while 50 kB beside a bundle of a few
 * hundred bytes is the accident of the order of magnitude that this check
 * exists to find.
 */
export function stepFor(baseline: number): number {
	return Math.max(STEP_FLOOR, Math.floor(baseline * STEP_SHARE));
}

/** How an output file gets into the running plugin. */
export type OutputKind = 'entry' | 'chunk';

/** One module, and the count of bytes that the module holds. */
export interface ModuleShare {
	readonly name: string;
	readonly bytes: number;
}

/** One output file, as the metafile describes it. */
export interface OutputMeta {
	readonly path: string;
	readonly kind: OutputKind;
	readonly bytes: number;
	readonly modules: readonly ModuleShare[];
}

/** What the metafile of the build says about the output files. */
export interface Metafile {
	readonly outputs: readonly OutputMeta[];
}

/**
 * The output files that the metafile describes. A source map is not an
 * output file here, because a release carries no source map.
 */
export function readMetafile(text: string): Reading<Metafile> {
	const parsed = parseJson(text);
	if (!parsed.ok) {
		return { ok: false, reason: `the metafile ${parsed.reason}` };
	}
	if (!isRecord(parsed.value)) {
		return { ok: false, reason: 'the metafile is not a JSON object' };
	}
	const outputs = parsed.value.outputs;
	if (!isRecord(outputs)) {
		return { ok: false, reason: 'the metafile has no outputs object' };
	}
	const found: OutputMeta[] = [];
	for (const [path, value] of Object.entries(outputs)) {
		if (path.endsWith('.map')) {
			continue;
		}
		const output = readOutput(path, value);
		if (!output.ok) {
			return output;
		}
		found.push(output.value);
	}
	if (found.length === 0) {
		return { ok: false, reason: 'the metafile declares no output file' };
	}
	return { ok: true, value: { outputs: found } };
}

function readOutput(path: string, value: unknown): Reading<OutputMeta> {
	if (!isRecord(value)) {
		return {
			ok: false,
			reason: `the metafile entry for the output ${path} is not an object`,
		};
	}
	const bytes = countOf(value.bytes);
	if (bytes === undefined) {
		return {
			ok: false,
			reason: `the metafile gives the output ${path} no count of bytes`,
		};
	}
	const inputs = value.inputs;
	if (!isRecord(inputs)) {
		return {
			ok: false,
			reason: `the metafile gives the output ${path} no inputs object`,
		};
	}
	const modules: ModuleShare[] = [];
	for (const [name, share] of Object.entries(inputs)) {
		const held = isRecord(share) ? countOf(share.bytesInOutput) : undefined;
		if (held === undefined) {
			return {
				ok: false,
				reason: `the metafile gives the input ${name} of the output ${path} no count of bytes`,
			};
		}
		modules.push({ name, bytes: held });
	}
	return {
		ok: true,
		value: {
			path,
			kind: typeof value.entryPoint === 'string' ? 'entry' : 'chunk',
			bytes,
			modules,
		},
	};
}

/**
 * The name that the report gives to the bytes of one input. A file under
 * node_modules counts against the package that holds the file, because this
 * report answers the question of what each dependency costs. Any other file
 * counts against its own path.
 */
export function contributorName(input: string): string {
	const marker = 'node_modules/';
	const last = input.lastIndexOf(marker);
	if (last < 0) {
		return input;
	}
	const parts = input.slice(last + marker.length).split('/');
	const first = parts[0] ?? '';
	const second = parts[1];
	if (first.startsWith('@') && second !== undefined && second !== '') {
		return `${first}/${second}`;
	}
	return first;
}

/** One output file, as the caller measured the file on disk. */
export interface Measurement {
	readonly path: string;
	readonly raw: number;
	readonly compressed: number;
}

/** One output file, with the measurement and the kind together. */
export interface OutputSize {
	readonly path: string;
	readonly kind: OutputKind;
	readonly raw: number;
	readonly compressed: number;
}

/** What one build weighs, and where the weight comes from. */
export interface Report {
	readonly raw: number;
	readonly compressed: number;
	readonly outputs: readonly OutputSize[];
	/** Every module that holds bytes in an output file, largest first. */
	readonly modules: readonly ModuleShare[];
	/** The bytes of the output files that no module accounts for. */
	readonly overhead: number;
}

/** The committed record of a build. The record holds the same numbers. */
export type Baseline = Report;

/**
 * What the build weighs. The metafile says which module holds which bytes,
 * and the measurements say what the files on disk weigh. The two must agree
 * about every output file, and about the size of every output file.
 * Therefore a metafile that an older build left behind fails here.
 */
export function measure(
	metafile: Metafile,
	measurements: readonly Measurement[],
): Reading<Report> {
	const measured = new Map(
		measurements.map((measurement) => [measurement.path, measurement]),
	);
	const outputs: OutputSize[] = [];
	const held = new Map<string, number>();
	let raw = 0;
	let compressed = 0;
	let attributed = 0;
	for (const output of metafile.outputs) {
		const measurement = measured.get(output.path);
		if (measurement === undefined) {
			return {
				ok: false,
				reason: `the metafile declares the output ${output.path}, and the check has no measurement of that file`,
			};
		}
		measured.delete(output.path);
		if (measurement.raw !== output.bytes) {
			return {
				ok: false,
				reason: `the metafile gives the output ${output.path} ${String(output.bytes)} bytes, and the file on disk has ${String(measurement.raw)} bytes. The metafile does not describe the built files. Build again.`,
			};
		}
		outputs.push({
			path: output.path,
			kind: output.kind,
			raw: measurement.raw,
			compressed: measurement.compressed,
		});
		raw += measurement.raw;
		compressed += measurement.compressed;
		for (const share of output.modules) {
			const name = contributorName(share.name);
			held.set(name, (held.get(name) ?? 0) + share.bytes);
			attributed += share.bytes;
		}
	}
	const extra = [...measured.keys()].sort();
	const first = extra[0];
	if (first !== undefined) {
		return {
			ok: false,
			reason: `the check measured the file ${first}, and the metafile does not declare that output`,
		};
	}
	return {
		ok: true,
		value: {
			raw,
			compressed,
			outputs: [...outputs].sort(byOutputPath),
			modules: [...held]
				.map(([name, bytes]) => ({ name, bytes }))
				.sort(byBytes),
			overhead: raw - attributed,
		},
	};
}

/** The record that the committed file holds. */
export function readBaseline(text: string): Reading<Baseline> {
	const parsed = parseJson(text);
	if (!parsed.ok) {
		return { ok: false, reason: `the baseline ${parsed.reason}` };
	}
	if (!isRecord(parsed.value)) {
		return { ok: false, reason: 'the baseline is not a JSON object' };
	}
	const raw = countOf(parsed.value.raw);
	const compressed = countOf(parsed.value.compressed);
	const overhead = countOf(parsed.value.overhead);
	if (raw === undefined || compressed === undefined) {
		return {
			ok: false,
			reason: 'the baseline gives no raw size and no compressed size',
		};
	}
	if (overhead === undefined) {
		return { ok: false, reason: 'the baseline gives no build overhead' };
	}
	const outputs = readOutputSizes(parsed.value.outputs);
	if (!outputs.ok) {
		return outputs;
	}
	const modules = readModules(parsed.value.modules);
	if (!modules.ok) {
		return modules;
	}
	return {
		ok: true,
		value: {
			raw,
			compressed,
			overhead,
			outputs: outputs.value,
			modules: modules.value,
		},
	};
}

function readOutputSizes(value: unknown): Reading<readonly OutputSize[]> {
	if (!Array.isArray(value) || value.length === 0) {
		return { ok: false, reason: 'the baseline lists no output file' };
	}
	const sizes: OutputSize[] = [];
	for (const entry of value as readonly unknown[]) {
		const path = isRecord(entry) ? entry.path : undefined;
		const kind = isRecord(entry) ? entry.kind : undefined;
		const raw = isRecord(entry) ? countOf(entry.raw) : undefined;
		const compressed = isRecord(entry)
			? countOf(entry.compressed)
			: undefined;
		if (
			typeof path !== 'string' ||
			(kind !== 'entry' && kind !== 'chunk') ||
			raw === undefined ||
			compressed === undefined
		) {
			return {
				ok: false,
				reason: 'the baseline holds an output file that the check cannot read',
			};
		}
		sizes.push({ path, kind, raw, compressed });
	}
	return { ok: true, value: sizes };
}

function readModules(value: unknown): Reading<readonly ModuleShare[]> {
	if (!Array.isArray(value)) {
		return { ok: false, reason: 'the baseline lists no module' };
	}
	const modules: ModuleShare[] = [];
	for (const entry of value as readonly unknown[]) {
		const name = isRecord(entry) ? entry.name : undefined;
		const bytes = isRecord(entry) ? countOf(entry.bytes) : undefined;
		if (typeof name !== 'string' || bytes === undefined) {
			return {
				ok: false,
				reason: 'the baseline holds a module that the check cannot read',
			};
		}
		modules.push({ name, bytes });
	}
	return { ok: true, value: modules };
}

/** One measured number, and what the number does against the baseline. */
export interface Change {
	readonly baseline: number;
	readonly now: number;
	/** The count of bytes that the build adds. A fall is negative. */
	readonly change: number;
	readonly step: number;
	/** Whether the growth goes past the step. */
	readonly past: boolean;
}

/** One module, and what the module does against the baseline. */
export interface Move {
	readonly name: string;
	readonly baseline: number;
	readonly now: number;
	readonly change: number;
}

/** One output file, and what the file does against the baseline. */
export interface OutputMove {
	readonly path: string;
	readonly kind: OutputKind;
	readonly raw: number;
	readonly compressed: number;
	/** What the baseline holds for this file, if the baseline holds it. */
	readonly was:
		{ readonly raw: number; readonly compressed: number } | undefined;
}

/** What the build and the baseline say about each other. */
export interface Comparison {
	readonly raw: Change;
	readonly compressed: Change;
	readonly outputs: readonly OutputMove[];
	/**
	 * The output files that the baseline holds and the build does not make.
	 * Each one fails the check.
	 */
	readonly gone: readonly string[];
	/** Every module that grew, largest growth first. */
	readonly grew: readonly Move[];
	/** Every module that got smaller, largest fall first. */
	readonly shrank: readonly Move[];
	/** Whether the check fails. */
	readonly fails: boolean;
}

/**
 * The comparison of the build against the baseline. Two things fail the
 * check. The first is the raw size or the compressed size of the whole
 * build, and each one gets the step of its own baseline. The second is an
 * output file that the baseline holds and the build no longer makes: a
 * payload that stops loading lazily moves into another output file and
 * leaves the total the same, and only the missing file shows it.
 *
 * Nothing else fails the check. Growth of a single module never fails the
 * check by itself. A new output file never fails the check. A move of bytes
 * between output files that keeps the totals never fails the check. A build
 * that is smaller than the baseline never fails the check. The comparison
 * reports every move that it finds, because the report is what makes the
 * numbers legible.
 */
export function compare(report: Report, baseline: Baseline): Comparison {
	const raw = changeOf(baseline.raw, report.raw);
	const compressed = changeOf(baseline.compressed, report.compressed);
	const before = new Map(
		baseline.outputs.map((output) => [output.path, output]),
	);
	const outputs = report.outputs.map((output) => {
		const was = before.get(output.path);
		return {
			path: output.path,
			kind: output.kind,
			raw: output.raw,
			compressed: output.compressed,
			was:
				was === undefined
					? undefined
					: { raw: was.raw, compressed: was.compressed },
		};
	});
	const made = new Set(report.outputs.map((output) => output.path));
	const moves = movesOf(report, baseline);
	const gone = baseline.outputs
		.map((output) => output.path)
		.filter((path) => !made.has(path));
	return {
		raw,
		compressed,
		outputs,
		gone,
		grew: moves
			.filter((move) => move.change > 0)
			.sort((left, right) => right.change - left.change),
		shrank: moves
			.filter((move) => move.change < 0)
			.sort((left, right) => left.change - right.change),
		fails: raw.past || compressed.past || gone.length > 0,
	};
}

function changeOf(baseline: number, now: number): Change {
	const step = stepFor(baseline);
	return {
		baseline,
		now,
		change: now - baseline,
		step,
		past: now - baseline > step,
	};
}

/** Every module whose count of bytes differs, and the overhead with them. */
function movesOf(report: Report, baseline: Baseline): readonly Move[] {
	const before = new Map(
		baseline.modules.map((module) => [module.name, module.bytes]),
	);
	const moves: Move[] = [];
	for (const module of report.modules) {
		const was = before.get(module.name) ?? 0;
		before.delete(module.name);
		if (was !== module.bytes) {
			moves.push({
				name: module.name,
				baseline: was,
				now: module.bytes,
				change: module.bytes - was,
			});
		}
	}
	for (const [name, was] of before) {
		moves.push({ name, baseline: was, now: 0, change: -was });
	}
	if (report.overhead !== baseline.overhead) {
		moves.push({
			name: OVERHEAD,
			baseline: baseline.overhead,
			now: report.overhead,
			change: report.overhead - baseline.overhead,
		});
	}
	return moves;
}

function byBytes(left: ModuleShare, right: ModuleShare): number {
	return right.bytes - left.bytes || order(left.name, right.name);
}

function byOutputPath(left: OutputSize, right: OutputSize): number {
	if (left.kind !== right.kind) {
		return left.kind === 'entry' ? -1 : 1;
	}
	return order(left.path, right.path);
}

/** The alphabetical order of two names. */
function order(left: string, right: string): number {
	if (left === right) {
		return 0;
	}
	return left < right ? -1 : 1;
}

function parseJson(text: string): Reading<unknown> {
	try {
		return { ok: true, value: JSON.parse(text) as unknown };
	} catch (error) {
		return {
			ok: false,
			reason: `is not JSON: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A count of bytes, or nothing when the value is not a count of bytes. */
function countOf(value: unknown): number | undefined {
	return typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= 0 &&
		Number.isFinite(value)
		? value
		: undefined;
}
