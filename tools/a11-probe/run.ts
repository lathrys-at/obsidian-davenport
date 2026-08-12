/**
 * The run: every fixture written into the vault, put through the
 * frontmatter writer with one fixed mutation, and read back as bytes.
 *
 * Two things make a run comparable with a run on another device. The input
 * is identical everywhere — the corpus is embedded at build time and the
 * notes are rewritten from it before each mutation, so a second run starts
 * from the same text as the first. And the mutation is identical
 * everywhere — the same key, the same value, every fixture — so whatever
 * differs in the emitted bytes is the writer, not the input.
 *
 * A fixture the writer refuses is recorded and the run carries on. Losing
 * one fixture to a version that will not parse it is a result; losing the
 * other thirteen with it is not.
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
import { describeError, isEmission, resultsPath } from './results';
import { sha256Hex, sha256HexOfText } from './sha256';
import type {
	FixtureEmission,
	FixtureResult,
	MetadataSettling,
	ProbeMarker,
	ProbeResults,
} from './results';

/** The folder the probe writes into. Everything it touches lives here. */
export const PROBE_FOLDER = 'frontmatter-probe';

/** The mutation every fixture is put through, on every device. */
export const MARKER: ProbeMarker = { key: 'probe-marker', value: 'fixed' };

/** How long to wait for the app to notice a note before writing to it. */
const METADATA_WAIT_MS = 3000;

/**
 * What the run needs from the plugin: the vault it works in, and the
 * cleanup registers, so that unloading mid-run takes the listener and the
 * timer with it.
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
	/** Emissions whose wait ran out before the app read the note back. */
	readonly timedOut: number;
}

/** Runs the whole corpus and writes the results file. */
export async function runProbe(host: ProbeHost, now: Date): Promise<ProbeRun> {
	if (PROBE_CORPUS.length === 0) {
		throw new Error(
			'the corpus is empty; this build embedded no fixtures at all',
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

/** One fixture: written fresh, mutated, read back as bytes. */
async function sample(
	host: ProbeHost,
	path: string,
	fixture: { readonly id: string; readonly content: string },
	inputHash: string,
): Promise<FixtureEmission> {
	const settling = metadataSettles(host, path);
	const file = await writePristine(host.app, path, fixture.content);
	const settledBy = await settling;

	await host.app.fileManager.processFrontMatter(
		file,
		(frontmatter: Record<string, unknown>) => {
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
	};
}

/** Creates the probe folder, or accepts the one already there. */
async function ensureFolder(app: App, path: string): Promise<void> {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) {
		return;
	}
	if (existing !== null) {
		throw new Error(`${path} is a note, so the probe cannot use it`);
	}
	await app.vault.createFolder(path);
}

/** Puts the fixture's own text back into the note, whatever was there. */
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
		throw new Error(`${path} is a folder, so the probe cannot use it`);
	}
	return await app.vault.create(path, content);
}

/**
 * Resolves once the app has read this path back, so the writer works from
 * the note as it now stands rather than as it stood before. The listener
 * goes on before the write, because the app can be quicker than the await
 * that follows it. A wait that runs out resolves anyway and says so: a
 * stale cache is worth recording, a hung command is not.
 *
 * Both the listener and the fallback timer are handed to the plugin's
 * registers, which take them down if it unloads mid-run — a timer and an
 * interval share one set of ids, so the interval register cancels this
 * one. Whichever arrives first also clears the other here, so a run that
 * finishes normally leaves nothing behind either way.
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

/** Writes the results file under a name no other run has taken. */
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
