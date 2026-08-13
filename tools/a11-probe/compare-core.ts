/**
 * Reads results files and compares them.
 *
 * Each function here is a pure function on the parsed files. The script
 * beside this module reads the files from disk and prints the report.
 *
 * The comparison uses the recorded bytes, and not the recorded hashes.
 * The module also checks each recorded hash against the bytes that the
 * file records under that hash. The module reports a hash that does not
 * match. Thus a file that is truncated or edited by hand reports the
 * problem, and does not pass as agreement.
 *
 * The module reports errors, and never compares them. A version that
 * refuses a fixture in every environment behaved consistently. The words
 * of the refusal are not evidence about emitted bytes.
 */

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { MetadataSettling, ProbeResults } from './results';

const KIND: ProbeResults['kind'] = 'frontmatter-emission-samples';
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const DUMP_ROW = 16;
const DUMP_ROWS_BEFORE = 1;
const DUMP_ROWS_AFTER = 1;

/** One results file, with the name that the caller wants in the report. */
export interface LoadedRun {
	/** The short name that the report uses for this environment. */
	readonly label: string;
	/** Where the file came from. The legend shows this text. */
	readonly source: string;
	readonly results: ProbeResults;
}

export type FixtureOutcome =
	'agree' | 'diverge' | 'error' | 'mixed' | 'incomplete';

export type Verdict = 'agree' | 'diverge' | 'incomparable';

/** The environments that emitted exactly the same output. */
export interface OutputGroup {
	readonly hash: string;
	readonly byteLength: number;
	readonly labels: readonly string[];
}

export interface FixtureError {
	readonly label: string;
	readonly message: string;
}

/** Where two outputs start to differ, and what the bytes are there. */
export interface Divergence {
	readonly reference: string;
	readonly other: string;
	readonly offset: number;
	/** Says whether the outputs differ in a byte, or only in length. */
	readonly kind: 'byte' | 'length';
	readonly referenceDump: readonly string[];
	readonly otherDump: readonly string[];
}

export interface FixtureComparison {
	readonly id: string;
	readonly outcome: FixtureOutcome;
	readonly groups: readonly OutputGroup[];
	readonly errors: readonly FixtureError[];
	/** The environments whose results file has no record of this fixture. */
	readonly missing: readonly string[];
	readonly divergences: readonly Divergence[];
	/**
	 * The environments where the wait used all of the metadata timeout
	 * before the probe wrote this fixture. The bytes from such an
	 * environment possibly came from a stale view of the note. In that case
	 * the bytes did not come from the text that the run put in the note.
	 */
	readonly cautions: readonly string[];
	/**
	 * True when this fixture differs and each side of the difference has
	 * an environment whose wait timed out. Such a difference is possibly
	 * a stale read and not a difference in the writer, and these runs
	 * cannot tell the two apart. The difference is evidence of nothing
	 * until each of those environments runs the fixture again.
	 */
	readonly unproven: boolean;
}

/** A results file whose own contents do not agree with each other. */
export interface IntegrityFailure {
	readonly label: string;
	readonly id: string;
	readonly note: string;
}

export interface EnvironmentSummary {
	readonly label: string;
	readonly source: string;
	readonly description: string;
	readonly timestamp: string;
	readonly fixtures: number;
}

export interface ComparisonReport {
	readonly environments: readonly EnvironmentSummary[];
	readonly fixtures: readonly FixtureComparison[];
	/** The fixtures whose input text was not the same in every run. */
	readonly corpusMismatches: readonly string[];
	readonly integrityFailures: readonly IntegrityFailure[];
	/** The conditions that make a comparison of these files impossible. */
	readonly problems: readonly string[];
	/**
	 * The facts that are worth knowing before the verdict. A warning does
	 * not change the verdict.
	 */
	readonly warnings: readonly string[];
	readonly verdict: Verdict;
	readonly agreed: number;
	readonly compared: number;
}

/**
 * Reads a results file. If the file is not a valid results file, the
 * function throws an error that says what is wrong.
 */
export function parseResults(text: string, source: string): ProbeResults {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		const detail = error instanceof Error ? error.message : 'unreadable';
		throw new Error(`${source}: this file is not JSON (${detail})`);
	}
	const root = objectAt(value, 'the file', source);
	if (root.kind !== KIND) {
		throw new Error(
			`${source}: this file is not a results file, because its kind field is not ${KIND}`,
		);
	}
	const platform = objectAt(root.platform, 'platform', source);
	const marker = objectAt(root.marker, 'marker', source);
	const perFixture = root.perFixture;
	if (!Array.isArray(perFixture)) {
		throw new Error(
			`${source}: perFixture is missing, or perFixture is not a list`,
		);
	}
	return {
		kind: KIND,
		timestamp: stringAt(root, 'timestamp', source),
		obsidianVersion: stringAt(root, 'obsidianVersion', source),
		apiVersion: stringAt(root, 'apiVersion', source),
		platform: {
			isDesktop: booleanAt(platform, 'isDesktop', source),
			isMobile: booleanAt(platform, 'isMobile', source),
			isIosApp: booleanAt(platform, 'isIosApp', source),
			isAndroidApp: booleanAt(platform, 'isAndroidApp', source),
			isMacOS: booleanAt(platform, 'isMacOS', source),
			isWin: booleanAt(platform, 'isWin', source),
			isLinux: booleanAt(platform, 'isLinux', source),
			userAgent: stringAt(platform, 'userAgent', source),
		},
		marker: {
			key: stringAt(marker, 'key', source),
			value: stringAt(marker, 'value', source),
		},
		perFixture: perFixture.map((entry: unknown, index: number) =>
			readFixture(entry, index, source),
		),
	};
}

/**
 * The text for this environment in the legend. The text includes the user
 * agent string. Two runs of one Obsidian version on two different builds
 * of an operating system have the same value in every other field. Two
 * runs on a phone and on a tablet also have the same value in every other
 * field.
 */
export function describeEnvironment(results: ProbeResults): string {
	return `${deviceOf(results)}, app ${results.obsidianVersion}, api ${results.apiVersion}, ${results.platform.userAgent}`;
}

/** The device that this run used, as one word. */
function deviceOf(results: ProbeResults): string {
	const { platform } = results;
	if (platform.isIosApp) {
		return 'iOS';
	}
	if (platform.isAndroidApp) {
		return 'Android';
	}
	if (platform.isMobile) {
		return 'mobile';
	}
	if (platform.isMacOS) {
		return 'macOS';
	}
	if (platform.isWin) {
		return 'Windows';
	}
	if (platform.isLinux) {
		return 'Linux';
	}
	return 'desktop';
}

/** Compares every fixture across every run. */
export function compareRuns(runs: readonly LoadedRun[]): ComparisonReport {
	const integrityFailures: IntegrityFailure[] = [];
	const outputs = new Map<string, Map<string, Uint8Array>>();
	const errors = new Map<string, FixtureError[]>();
	const inputHashes = new Map<string, Set<string>>();
	const stale = new Map<string, string[]>();
	const presence = new Map<string, Set<string>>();
	const ids: string[] = [];

	for (const run of runs) {
		const seen = new Set<string>();
		for (const record of run.results.perFixture) {
			if (!ids.includes(record.id)) {
				ids.push(record.id);
			}
			if (seen.has(record.id)) {
				integrityFailures.push({
					label: run.label,
					id: record.id,
					note: 'this file records the fixture more than once',
				});
				continue;
			}
			seen.add(record.id);
			entryOf(presence, record.id, newSet).add(run.label);
			entryOf(inputHashes, record.id, newSet).add(record.inputHash);
			if ('error' in record) {
				entryOf(errors, record.id, newList).push({
					label: run.label,
					message: record.error,
				});
				continue;
			}
			const bytes = decode(record.outputBase64);
			if (bytes === null) {
				integrityFailures.push({
					label: run.label,
					id: record.id,
					note: 'the recorded output is not base64',
				});
				continue;
			}
			const hash = sha256Hex(bytes);
			if (hash !== record.outputHash) {
				integrityFailures.push({
					label: run.label,
					id: record.id,
					note: `the recorded hash ${record.outputHash} is not the hash of the recorded bytes (${hash})`,
				});
			}
			if (record.settledBy === 'timeout') {
				entryOf(stale, record.id, newList).push(run.label);
			}
			entryOf(outputs, record.id, newMap).set(run.label, bytes);
		}
	}

	const labels = runs.map((run) => run.label);
	const fixtures = ids.map((id) =>
		compareFixture(
			id,
			labels,
			outputs.get(id) ?? new Map<string, Uint8Array>(),
			errors.get(id) ?? [],
			stale.get(id) ?? [],
		),
	);
	const corpusMismatches = ids.filter(
		(id) => (inputHashes.get(id)?.size ?? 0) > 1,
	);
	const agreed = fixtures.filter(
		(fixture) => fixture.outcome === 'agree' || fixture.outcome === 'error',
	).length;
	const problems = problemsWith(runs, ids, presence);

	return {
		environments: runs.map((run) => ({
			label: run.label,
			source: run.source,
			description: describeEnvironment(run.results),
			timestamp: run.results.timestamp,
			fixtures: run.results.perFixture.length,
		})),
		fixtures,
		corpusMismatches,
		integrityFailures,
		problems,
		warnings: warningsAbout(runs),
		verdict: verdictFor(
			fixtures,
			corpusMismatches,
			integrityFailures,
			problems,
		),
		agreed,
		compared: fixtures.length,
	};
}

/**
 * The conditions that make a comparison impossible. These conditions are
 * different from the things that the files disagree about. A file that
 * holds no records agrees with every other file. A set of files with no
 * fixture in common also agrees. Without this check, both conditions
 * print as full agreement on the verdict line, and the verdict line is
 * the line that the owner transcribes.
 */
function problemsWith(
	runs: readonly LoadedRun[],
	ids: readonly string[],
	presence: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
	const problems: string[] = [];
	for (const run of runs) {
		if (run.results.perFixture.length === 0) {
			problems.push(`${run.label} records no fixtures at all`);
		}
	}
	const shared = ids.filter((id) => (presence.get(id)?.size ?? 0) > 1);
	if (runs.length > 1 && shared.length === 0) {
		problems.push(
			'no fixture appears in more than one of these files, so there is nothing to compare',
		);
	}
	return problems;
}

/** The facts about the files that are worth knowing before the verdict. */
function warningsAbout(runs: readonly LoadedRun[]): string[] {
	const byFingerprint = new Map<string, string[]>();
	for (const run of runs) {
		const { results } = run;
		const fingerprint = [
			results.timestamp,
			results.obsidianVersion,
			results.apiVersion,
			results.platform.userAgent,
		].join('|');
		entryOf(byFingerprint, fingerprint, newList).push(run.label);
	}
	return [...byFingerprint.values()]
		.filter((labels) => labels.length > 1)
		.map(
			(labels) =>
				`${labels.join(' and ')} carry the same environment and the same timestamp, so they may be one run counted twice`,
		);
}

function compareFixture(
	id: string,
	labels: readonly string[],
	bytesByLabel: ReadonlyMap<string, Uint8Array>,
	errors: readonly FixtureError[],
	cautions: readonly string[],
): FixtureComparison {
	const failed = new Set(errors.map((entry) => entry.label));
	const missing = labels.filter(
		(label) => !bytesByLabel.has(label) && !failed.has(label),
	);

	const grouped = new Map<string, { bytes: Uint8Array; labels: string[] }>();
	for (const label of labels) {
		const bytes = bytesByLabel.get(label);
		if (bytes === undefined) {
			continue;
		}
		const hash = sha256Hex(bytes);
		const group = grouped.get(hash);
		if (group === undefined) {
			grouped.set(hash, { bytes, labels: [label] });
		} else {
			group.labels.push(label);
		}
	}

	const groups = [...grouped].map(([hash, group]) => ({
		hash,
		byteLength: group.bytes.length,
		labels: group.labels,
	}));
	const divergences = divergencesAmong([...grouped.values()]);

	const outcome = outcomeFor(groups.length, errors.length, missing.length);
	return {
		id,
		outcome,
		groups,
		errors,
		missing,
		divergences,
		cautions,
		unproven:
			(outcome === 'diverge' || outcome === 'mixed') &&
			!attested(groups, errors, cautions),
	};
}

/**
 * True when environments that did not time out show the difference. The
 * function puts the environments into sides. Each different output is one
 * side, and a refusal is one more side. A side counts when at least one
 * environment on that side settled by event. The difference holds when
 * two sides count.
 *
 * Two sides that count disagree with each other, whatever the wait on a
 * third environment did. A timeout on an environment that is not on
 * either side of a difference says nothing about that difference. A
 * refusal always counts, because a refusal has no wait that can time out.
 */
function attested(
	groups: readonly OutputGroup[],
	errors: readonly FixtureError[],
	cautions: readonly string[],
): boolean {
	const timedOut = new Set(cautions);
	const sides: readonly (readonly string[])[] = [
		...groups.map((group) => group.labels),
		...(errors.length > 0 ? [errors.map((error) => error.label)] : []),
	];
	const speaking = sides.filter((labels) =>
		labels.some((label) => !timedOut.has(label)),
	);
	return speaking.length > 1;
}

function outcomeFor(
	groups: number,
	errors: number,
	missing: number,
): FixtureOutcome {
	if (missing > 0) {
		return 'incomplete';
	}
	if (groups === 0) {
		return 'error';
	}
	if (errors > 0) {
		return 'mixed';
	}
	return groups === 1 ? 'agree' : 'diverge';
}

/** Compares each other output against the first output, the reference. */
function divergencesAmong(
	groups: readonly { bytes: Uint8Array; labels: string[] }[],
): Divergence[] {
	const [first, ...rest] = groups;
	if (first === undefined) {
		return [];
	}
	return rest.flatMap((group) => {
		const difference = firstDifference(first.bytes, group.bytes);
		if (difference === null) {
			return [];
		}
		return [
			{
				reference: first.labels.join(','),
				other: group.labels.join(','),
				offset: difference.offset,
				kind: difference.kind,
				referenceDump: hexdump(first.bytes, difference.offset),
				otherDump: hexdump(group.bytes, difference.offset),
			},
		];
	});
}

/**
 * The offset where the two outputs start to differ. The result is null
 * when the two outputs are the same.
 */
export function firstDifference(
	left: Uint8Array,
	right: Uint8Array,
): { offset: number; kind: 'byte' | 'length' } | null {
	const shared = Math.min(left.length, right.length);
	for (let offset = 0; offset < shared; offset += 1) {
		if (left[offset] !== right[offset]) {
			return { offset, kind: 'byte' };
		}
	}
	if (left.length !== right.length) {
		return { offset: shared, kind: 'length' };
	}
	return null;
}

/**
 * The rows of bytes around this offset, in the format that the hexdump
 * program uses. The result holds the row that contains the offset, and
 * one row on each side of that row. The text column shows printable ASCII
 * characters only. Thus a dump of bytes with any value stays readable.
 */
export function hexdump(bytes: Uint8Array, offset: number): string[] {
	const row = Math.floor(offset / DUMP_ROW) * DUMP_ROW;
	const from = Math.max(0, row - DUMP_ROWS_BEFORE * DUMP_ROW);
	const to = Math.min(bytes.length, row + (DUMP_ROWS_AFTER + 1) * DUMP_ROW);
	const lines: string[] = [];
	for (let start = from; start < to; start += DUMP_ROW) {
		const slice = bytes.subarray(start, Math.min(start + DUMP_ROW, to));
		const marker = start === row ? '>' : ' ';
		const hex = [...slice]
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join(' ')
			.padEnd(DUMP_ROW * 3 - 1, ' ');
		const text = [...slice]
			.map((byte) => (byte >= 0x20 && byte < 0x7f ? byte : 0x2e))
			.map((byte) => String.fromCharCode(byte))
			.join('');
		lines.push(
			`${marker} ${start.toString(16).padStart(8, '0')}  ${hex}  |${text}|`,
		);
	}
	if (lines.length === 0) {
		lines.push(`  ${offset.toString(16).padStart(8, '0')}  (no bytes)`);
	}
	return lines;
}

/**
 * The verdict for the whole comparison. A difference counts as a
 * divergence only when the comparison can trust each side of the
 * difference. The comparison trusts a side when the bytes on that side
 * came from the text that the run put in the note.
 *
 * A fixture that differs can rest on an environment that waited out the
 * metadata timeout. When every fixture that differs rests on such an
 * environment, these runs do not settle the question. The owner must run
 * the fixture again, and must not read the difference as evidence that
 * the writer differs. A difference that two environments without a
 * timeout show between them stands, whatever the wait on a third
 * environment did.
 */
function verdictFor(
	fixtures: readonly FixtureComparison[],
	corpusMismatches: readonly string[],
	integrityFailures: readonly IntegrityFailure[],
	problems: readonly string[],
): Verdict {
	const incomparable =
		corpusMismatches.length > 0 ||
		integrityFailures.length > 0 ||
		problems.length > 0 ||
		fixtures.length === 0 ||
		fixtures.some((fixture) => fixture.outcome === 'incomplete');
	if (incomparable) {
		return 'incomparable';
	}
	const diverged = fixtures.filter(
		(fixture) =>
			fixture.outcome === 'diverge' || fixture.outcome === 'mixed',
	);
	if (diverged.length === 0) {
		return 'agree';
	}
	return diverged.some((fixture) => !fixture.unproven)
		? 'diverge'
		: 'incomparable';
}

function decode(text: string): Uint8Array | null {
	if (!BASE64.test(text)) {
		return null;
	}
	return Buffer.from(text, 'base64');
}

function sha256Hex(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The entry under this key. If the store holds no entry under this key,
 * the function calls `make` and puts the new entry there.
 */
function entryOf<K, V>(store: Map<K, V>, key: K, make: () => V): V {
	const existing = store.get(key);
	if (existing !== undefined) {
		return existing;
	}
	const created = make();
	store.set(key, created);
	return created;
}

const newList = <T>(): T[] => [];
const newSet = <T>(): Set<T> => new Set<T>();
const newMap = <K, V>(): Map<K, V> => new Map<K, V>();

function readFixture(
	entry: unknown,
	index: number,
	source: string,
): ProbeResults['perFixture'][number] {
	const where = `perFixture[${String(index)}]`;
	const record = objectAt(entry, where, source);
	const id = stringAt(record, 'id', source, where);
	const inputHash = stringAt(record, 'inputHash', source, where);
	if (typeof record.error === 'string') {
		return { id, inputHash, error: record.error };
	}
	return {
		id,
		inputHash,
		settledBy: settlingAt(record, source, where),
		outputBase64: stringAt(record, 'outputBase64', source, where),
		outputHash: stringAt(record, 'outputHash', source, where),
	};
}

/** How the record says the wait ended. The wait came before the writer. */
function settlingAt(
	record: Record<string, unknown>,
	source: string,
	where: string,
): MetadataSettling {
	const value = record.settledBy;
	if (value !== 'event' && value !== 'timeout') {
		throw new Error(
			`${source}: ${where} does not say whether the wait before the writer settled by event or by timeout`,
		);
	}
	return value;
}

function objectAt(
	value: unknown,
	where: string,
	source: string,
): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(
			`${source}: ${where} is missing, or the value at that place is not an object`,
		);
	}
	return value as Record<string, unknown>;
}

function stringAt(
	holder: Record<string, unknown>,
	key: string,
	source: string,
	where = 'the file',
): string {
	const value = holder[key];
	if (typeof value !== 'string') {
		throw new Error(
			`${source}: ${where} has no ${key}, or the value under this key is not text`,
		);
	}
	return value;
}

function booleanAt(
	holder: Record<string, unknown>,
	key: string,
	source: string,
): boolean {
	const value = holder[key];
	if (typeof value !== 'boolean') {
		throw new Error(
			`${source}: platform has no ${key}, or the value under this key is not true or false`,
		);
	}
	return value;
}
