/**
 * The golden corpus of the canonical serializer.
 *
 * The gate holds the serializer to the bytes that it writes for a fixed
 * set of inputs. The inputs come from two places. The adversarial ICS
 * corpus supplies the details that a careless reader or a careless writer
 * gets wrong. The directory `inputs/` beside the sets supplies the files
 * of this gate, and those files exercise every rule that the serializer
 * states. A rule that no input exercises can change without a failure
 * here, so a new rule of the serializer lands together with an input that
 * exercises the rule.
 *
 * The serializer writes one text for each input. Those texts are
 * committed here. A test compares each committed text with the text that
 * the serializer writes now.
 *
 * Each set of golden files sits in a directory. The name of the directory
 * carries the value of the core component of the normalization stamp. The
 * directory `core-1/` therefore holds the bytes that the serializer wrote
 * while that component was 1. The layout ties a change of the bytes to a
 * change of the component in three ways.
 *
 * - A change to the serializer that does not raise the component reads
 *   the directory of the old value. The bytes in that directory differ
 *   from the new bytes, and the test fails and names the component.
 * - A change that raises the component finds no directory for the new
 *   value. The test then names the directory to write.
 * - A set that an earlier version wrote stays in the tree. The closure
 *   test reads every set, so an old set keeps its work after the
 *   serializer moves past it.
 *
 * The environment variable `DAVENPORT_WRITE_ICS_GOLDENS` makes the test
 * write the set of the current component. The test then fails, so a run
 * that writes a set never reports success.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { icsCorpus } from './ics-corpus';

/** One committed set of golden files. */
export interface IcsGoldenSet {
	/** The value of the core component that wrote this set. */
	readonly core: number;
	/** The path of the directory that holds the set. */
	readonly path: string;
	/** The fixture names in the set, in sorted order. */
	readonly ids: readonly string[];
}

/** The text of one golden file, with its CRLF line endings. */
export interface IcsGoldenEntry {
	readonly id: string;
	readonly text: string;
}

/** One input of the gate, with its CRLF line endings. */
export interface IcsGoldenInput {
	/** The file name without its extension. No two inputs share an id. */
	readonly id: string;
	/** The text of the input file, decoded from UTF-8. */
	readonly text: string;
}

const GOLDEN_ROOT = join(import.meta.dirname, 'ics-serializer');
const INPUT_DIRECTORY = join(GOLDEN_ROOT, 'inputs');
const SET_PREFIX = 'core-';
const EXTENSION = '.ics';
const WRITE_VARIABLE = 'DAVENPORT_WRITE_ICS_GOLDENS';

const utf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Every input of the gate: the files of the corpus, and then the files of
 * this gate. The function throws an error when one id stands in both
 * places, because one id names one golden file.
 */
export function icsGoldenInputs(): readonly IcsGoldenInput[] {
	const corpus = icsCorpus().map((fixture) => ({
		id: fixture.id,
		text: fixture.content,
	}));
	const owned = readdirSync(INPUT_DIRECTORY)
		.filter((file) => file.endsWith(EXTENSION))
		.sort()
		.map((file) => ({
			id: file.slice(0, -EXTENSION.length),
			text: utf8.decode(readFileSync(join(INPUT_DIRECTORY, file))),
		}));
	const shared = owned.filter((input) =>
		corpus.some((fixture) => fixture.id === input.id),
	);
	if (shared.length > 0) {
		throw new Error(
			`the ICS corpus and the inputs of the golden gate share these names: ${shared
				.map((input) => input.id)
				.join(', ')}; rename the file under ${INPUT_DIRECTORY}`,
		);
	}
	return [...corpus, ...owned];
}

/** Every committed set, from the oldest component to the newest. */
export function icsGoldenSets(): readonly IcsGoldenSet[] {
	if (!existsSync(GOLDEN_ROOT)) {
		return [];
	}
	return readdirSync(GOLDEN_ROOT, { withFileTypes: true })
		.filter(
			(entry) => entry.isDirectory() && entry.name.startsWith(SET_PREFIX),
		)
		.map((entry) => readSet(entry.name))
		.sort((left, right) => left.core - right.core);
}

/** The set of one component value, or nothing when no set carries it. */
export function icsGoldenSet(core: number): IcsGoldenSet | undefined {
	return icsGoldenSets().find((set) => set.core === core);
}

/** The path that a set of the given component value takes. */
export function icsGoldenSetPath(core: number): string {
	return join(GOLDEN_ROOT, `${SET_PREFIX}${String(core)}`);
}

/** The text of one file of a set. */
export function icsGoldenText(set: IcsGoldenSet, id: string): string {
	return utf8.decode(readFileSync(join(set.path, `${id}${EXTENSION}`)));
}

/** True when the environment asks the test to write the set. */
export function icsGoldenWriteRequested(): boolean {
	return process.env[WRITE_VARIABLE] !== undefined;
}

/** Writes one set. The function replaces every file that the set holds. */
export function writeIcsGoldenSet(
	core: number,
	entries: readonly IcsGoldenEntry[],
): string {
	const path = icsGoldenSetPath(core);
	mkdirSync(path, { recursive: true });
	for (const entry of entries) {
		writeFileSync(
			join(path, `${entry.id}${EXTENSION}`),
			entry.text,
			'utf8',
		);
	}
	return path;
}

function readSet(directory: string): IcsGoldenSet {
	const path = join(GOLDEN_ROOT, directory);
	return {
		core: Number(directory.slice(SET_PREFIX.length)),
		path,
		ids: readdirSync(path)
			.filter((file) => file.endsWith(EXTENSION))
			.map((file) => file.slice(0, -EXTENSION.length))
			.sort(),
	};
}
