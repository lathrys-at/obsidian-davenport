/**
 * The run. The run writes every fixture into the vault. Then the run puts
 * each fixture through the frontmatter writer with one fixed change.
 * Then the run reads the bytes back.
 *
 * Two conditions make a run comparable with a run on another device.
 *
 * The first condition is that the input is the same everywhere. The build
 * puts the corpus into the bundle, and the run writes the notes again
 * from that corpus before each change. Therefore a second run starts from
 * the same text as the first run.
 *
 * The second condition is that the change is the same everywhere: the
 * same key, the same value, and every fixture. Therefore a difference in
 * the emitted bytes comes from the writer, and not from the input.
 *
 * The run records each fixture that the writer refuses, and then the run
 * continues. The loss of one fixture to a version that will not parse
 * that fixture is itself a result. The loss of the other thirteen
 * fixtures at the same time is not a result.
 */

import {
	TFile,
	TFolder,
	arrayBufferToBase64,
	type App,
	type EventRef,
} from 'obsidian';
import { PROBE_CORPUS } from 'probe-corpus';
import {
	obsidianVersion,
	pluginApiVersion,
	probePlatform,
} from './environment';
import {
	PROBE_FOLDER,
	describeError,
	isEmission,
	resultsPath,
} from './results';
import { sha256Hex, sha256HexOfText } from './sha256';
import type {
	FixtureEmission,
	FixtureResult,
	MetadataSettling,
	ProbeMarker,
	ProbeResults,
} from './results';

/** The change that the probe makes to every fixture, on every device. */
export const MARKER: ProbeMarker = { key: 'probe-marker', value: 'fixed' };

/**
 * How long the run waits for the app to read a note back, before the run
 * writes to that note.
 */
const METADATA_WAIT_MS = 3000;

/**
 * What the run needs from the plugin. The run needs the vault that the
 * run works in. The run also needs the register functions that clean up.
 * Then an unload during a run takes the listener and the timer away with
 * the plugin.
 */
export interface ProbeHost {
	readonly app: App;
	registerEvent(ref: EventRef): void;
	registerInterval(id: number): number;
}

/** What a finished run leaves behind. */
export interface ProbeRun {
	/** The vault path of the results file. */
	readonly path: string;
	readonly results: ProbeResults;
	readonly emitted: number;
	readonly failed: number;
	/**
	 * How many samples had a wait that ran out before the app read the
	 * note back.
	 */
	readonly timedOut: number;
}

/** Runs the whole corpus and writes the results file. */
export async function runProbe(host: ProbeHost, now: Date): Promise<ProbeRun> {
	if (PROBE_CORPUS.length === 0) {
		throw new Error(
			'the corpus is empty, because this build put no fixtures into the bundle; build the probe again and install it again',
		);
	}
	await ensureFolder(host.app, PROBE_FOLDER);

	const perFixture: FixtureResult[] = [];
	for (const fixture of PROBE_CORPUS) {
		const inputHash = sha256HexOfText(fixture.content);
		const path = `${PROBE_FOLDER}/${fixture.fileName}`;
		try {
			perFixture.push(await sample(host, path, fixture, inputHash));
		} catch (error) {
			perFixture.push({
				id: fixture.id,
				inputHash,
				error: describeError(error),
			});
		}
	}

	const results: ProbeResults = {
		kind: 'frontmatter-emission-samples',
		timestamp: now.toISOString(),
		obsidianVersion: obsidianVersion(host.app),
		apiVersion: pluginApiVersion(),
		platform: probePlatform(),
		marker: MARKER,
		perFixture,
	};
	const path = await writeResults(host.app, results, now);
	const emissions = perFixture.filter(isEmission);
	return {
		path,
		results,
		emitted: emissions.length,
		failed: perFixture.length - emissions.length,
		timedOut: emissions.filter(
			(emission) => emission.settledBy === 'timeout',
		).length,
	};
}

/**
 * One fixture. The function writes the note again from the text of the
 * fixture, changes the frontmatter, and reads the bytes back.
 */
async function sample(
	host: ProbeHost,
	path: string,
	fixture: { readonly id: string; readonly content: string },
	inputHash: string,
): Promise<FixtureEmission> {
	const settling = metadataSettles(host, path);
	const file = await writePristine(host.app, path, fixture.content);
	const settledBy = await settling;

	let valueTypes: Record<string, string> = {};
	await host.app.fileManager.processFrontMatter(
		file,
		(frontmatter: Record<string, unknown>) => {
			valueTypes = Object.fromEntries(
				Object.entries(frontmatter).map(([key, value]) => [
					key,
					typeName(value),
				]),
			);
			frontmatter[MARKER.key] = MARKER.value;
		},
	);

	const emitted = await host.app.vault.adapter.readBinary(file.path);
	return {
		id: fixture.id,
		inputHash,
		settledBy,
		outputBase64: arrayBufferToBase64(emitted),
		outputHash: sha256Hex(new Uint8Array(emitted)),
		valueTypes,
	};
}

/**
 * The name of the type of one value that the writer gave the callback.
 * The engine reads text under most keys, and it reads a day under the
 * keys of whole days. A value of another type therefore changes what the
 * engine can do with the note.
 */
function typeName(value: unknown): string {
	if (value === null) {
		return 'null';
	}
	if (value instanceof Date) {
		return 'Date';
	}
	if (Array.isArray(value)) {
		return 'array';
	}
	return typeof value;
}

/** Makes the probe folder, or accepts the folder that is already there. */
async function ensureFolder(app: App, path: string): Promise<void> {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) {
		return;
	}
	if (existing !== null) {
		throw new Error(
			`${path} is a note, and the probe needs a folder with this path; move the note away`,
		);
	}
	await app.vault.createFolder(path);
}

/**
 * Puts the text of the fixture back into the note, and replaces whatever
 * the note held before.
 */
async function writePristine(
	app: App,
	path: string,
	content: string,
): Promise<TFile> {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await app.vault.modify(existing, content);
		return existing;
	}
	if (existing !== null) {
		throw new Error(
			`${path} is a folder, and the probe needs a note with this path; move the folder away`,
		);
	}
	return await app.vault.create(path, content);
}

/**
 * The promise resolves when the app reads this path back. Then the writer
 * works from the note as the note now is, and not as the note was before.
 * The function starts the listener before the write, because the app can
 * be quicker than the `await` that comes after the write. A wait that
 * runs out also resolves, and the value it gives is `timeout`: a stale
 * cache is worth a record, but a command that hangs is not.
 *
 * The function gives both the listener and the fallback timer to the
 * register functions of the plugin. Then an unload during a run takes
 * both of them down. The identifier of a timeout and the identifier of an
 * interval come from one set. Therefore the register function for an
 * interval cancels this timeout. The event or the timeout that arrives
 * first also clears the other one here. Therefore a run that finishes
 * normally leaves nothing behind, on both paths.
 */
function metadataSettles(
	host: ProbeHost,
	path: string,
): Promise<MetadataSettling> {
	return new Promise<MetadataSettling>((resolve) => {
		let settled = false;
		const finish = (how: MetadataSettling): void => {
			if (settled) {
				return;
			}
			settled = true;
			host.app.metadataCache.offref(ref);
			window.clearTimeout(timer);
			resolve(how);
		};
		const ref: EventRef = host.app.metadataCache.on(
			'changed',
			(changed) => {
				if (changed.path === path) {
					finish('event');
				}
			},
		);
		host.registerEvent(ref);
		const timer = window.setTimeout(() => {
			finish('timeout');
		}, METADATA_WAIT_MS);
		host.registerInterval(timer);
	});
}

/** Writes the results file with a name that no other run took. */
async function writeResults(
	app: App,
	results: ProbeResults,
	now: Date,
): Promise<string> {
	const path = resultsPath(
		PROBE_FOLDER,
		now,
		(candidate) => app.vault.getAbstractFileByPath(candidate) !== null,
	);
	await app.vault.create(path, JSON.stringify(results, null, '\t'));
	return path;
}
