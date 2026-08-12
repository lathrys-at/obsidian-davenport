/**
 * Reading results files and comparing them.
 *
 * Everything here is a pure function over the parsed files: the script
 * beside it does the reading and the printing. The comparison is over
 * bytes, not over hashes — a recorded hash is checked against the bytes it
 * claims to cover and reported when it does not match, so a truncated or
 * hand-edited file says so rather than passing as agreement.
 *
 * Errors are reported, never compared. A version that refuses a fixture
 * everywhere has behaved consistently; the wording it refuses with is not
 * evidence about emitted bytes.
 */

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { ProbeResults } from './results';

const KIND: ProbeResults['kind'] = 'frontmatter-emission-samples';
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const DUMP_ROW = 16;
const DUMP_ROWS_BEFORE = 1;
const DUMP_ROWS_AFTER = 1;

/** One results file, as the caller wants it named in the report. */
export interface LoadedRun {
	/** The short name the report refers to this environment by. */
	readonly label: string;
	/** Where the file came from, for the legend. */
	readonly source: string;
	readonly results: ProbeResults;
}

export type FixtureOutcome =
	'agree' | 'diverge' | 'error' | 'mixed' | 'incomplete';

export type Verdict = 'agree' | 'diverge' | 'incomparable';

/** The environments that emitted one and the same output. */
export interface OutputGroup {
	readonly hash: string;
	readonly byteLength: number;
	readonly labels: readonly string[];
}

export interface FixtureError {
	readonly label: string;
	readonly message: string;
}

/** Where two outputs part company, and what they look like there. */
export interface Divergence {
	readonly reference: string;
	readonly other: string;
	readonly offset: number;
	/** Whether the outputs differ in a byte or in length alone. */
	readonly kind: 'byte' | 'length';
	readonly referenceDump: readonly string[];
	readonly otherDump: readonly string[];
}

export interface FixtureComparison {
	readonly id: string;
	readonly outcome: FixtureOutcome;
	readonly groups: readonly OutputGroup[];
	readonly errors: readonly FixtureError[];
	/** Environments whose results file has no record of this fixture. */
	readonly missing: readonly string[];
	readonly divergences: readonly Divergence[];
}

/** A results file that does not add up on its own terms. */
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
	/** Fixtures whose input text was not the same in every run. */
	readonly corpusMismatches: readonly string[];
	readonly integrityFailures: readonly IntegrityFailure[];
	readonly verdict: Verdict;
	readonly agreed: number;
	readonly compared: number;
}

/** Reads a results file, or throws saying what is wrong with it. */
export function parseResults(text: string, source: string): ProbeResults {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		const detail = error instanceof Error ? error.message : 'unreadable';
		throw new Error(`${source}: not JSON (${detail})`);
	}
	const root = objectAt(value, 'the file', source);
	if (root.kind !== KIND) {
		throw new Error(
			`${source}: not a results file; its kind is not ${KIND}`,
		);
	}
	const platform = objectAt(root.platform, 'platform', source);
	const marker = objectAt(root.marker, 'marker', source);
	const perFixture = root.perFixture;
	if (!Array.isArray(perFixture)) {
		throw new Error(`${source}: perFixture is missing or not a list`);
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

/** How this environment should read in the legend. */
export function describeEnvironment(results: ProbeResults): string {
	return `${deviceOf(results)}, app ${results.obsidianVersion}, api ${results.apiVersion}`;
}

/** The device this run happened on, in one word. */
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
	const ids: string[] = [];

	for (const run of runs) {
		for (const record of run.results.perFixture) {
			if (!ids.includes(record.id)) {
				ids.push(record.id);
			}
			hashesFor(inputHashes, record.id).add(record.inputHash);
			if ('error' in record) {
				listFor(errors, record.id).push({
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
			bytesFor(outputs, record.id).set(run.label, bytes);
		}
	}

	const labels = runs.map((run) => run.label);
	const fixtures = ids.map((id) =>
		compareFixture(
			id,
			labels,
			outputs.get(id) ?? new Map<string, Uint8Array>(),
			errors.get(id) ?? [],
		),
	);
	const corpusMismatches = ids.filter(
		(id) => (inputHashes.get(id)?.size ?? 0) > 1,
	);
	const agreed = fixtures.filter(
		(fixture) => fixture.outcome === 'agree' || fixture.outcome === 'error',
	).length;

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
		verdict: verdictFor(fixtures, corpusMismatches, integrityFailures),
		agreed,
		compared: fixtures.length,
	};
}

function compareFixture(
	id: string,
	labels: readonly string[],
	bytesByLabel: ReadonlyMap<string, Uint8Array>,
	errors: readonly FixtureError[],
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

	return {
		id,
		outcome: outcomeFor(groups.length, errors.length, missing.length),
		groups,
		errors,
		missing,
		divergences,
	};
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

/** Every other output against the first one, which is the reference. */
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

/** The offset the two outputs part company at. */
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
 * The rows around this offset, in the shape hexdump prints them: the row
 * holding the offset, one either side of it, and printable ASCII only in
 * the text column so a dump of arbitrary bytes stays readable.
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

function verdictFor(
	fixtures: readonly FixtureComparison[],
	corpusMismatches: readonly string[],
	integrityFailures: readonly IntegrityFailure[],
): Verdict {
	const incomparable =
		corpusMismatches.length > 0 ||
		integrityFailures.length > 0 ||
		fixtures.some((fixture) => fixture.outcome === 'incomplete');
	if (incomparable) {
		return 'incomparable';
	}
	const diverged = fixtures.some(
		(fixture) =>
			fixture.outcome === 'diverge' || fixture.outcome === 'mixed',
	);
	return diverged ? 'diverge' : 'agree';
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

function bytesFor(
	outputs: Map<string, Map<string, Uint8Array>>,
	id: string,
): Map<string, Uint8Array> {
	const existing = outputs.get(id);
	if (existing !== undefined) {
		return existing;
	}
	const created = new Map<string, Uint8Array>();
	outputs.set(id, created);
	return created;
}

function listFor(
	errors: Map<string, FixtureError[]>,
	id: string,
): FixtureError[] {
	const existing = errors.get(id);
	if (existing !== undefined) {
		return existing;
	}
	const created: FixtureError[] = [];
	errors.set(id, created);
	return created;
}

function hashesFor(hashes: Map<string, Set<string>>, id: string): Set<string> {
	const existing = hashes.get(id);
	if (existing !== undefined) {
		return existing;
	}
	const created = new Set<string>();
	hashes.set(id, created);
	return created;
}

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
		outputBase64: stringAt(record, 'outputBase64', source, where),
		outputHash: stringAt(record, 'outputHash', source, where),
	};
}

function objectAt(
	value: unknown,
	where: string,
	source: string,
): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`${source}: ${where} is missing or not an object`);
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
		throw new Error(`${source}: ${where} has no ${key}, or it is not text`);
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
			`${source}: platform has no ${key}, or it is not true or false`,
		);
	}
	return value;
}
