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
import { isEmission } from './results';
import { sha256Hex, sha256HexOfText } from './sha256';
import type {
	FixtureEmission,
	FixtureResult,
	ProbeMarker,
	ProbeResults,
} from './results';

/** The folder the probe writes into. Everything it touches lives here. */
export const PROBE_FOLDER = 'frontmatter-probe';

/** The mutation every fixture is put through, on every device. */
export const MARKER: ProbeMarker = { key: 'probe-marker', value: 'fixed' };

/** How long to wait for the app to notice a note before writing to it. */
const METADATA_WAIT_MS = 3000;

/** How many names to try before giving up on an unused results file. */
const NAME_ATTEMPTS = 50;

/** What a finished run leaves behind. */
export interface ProbeRun {
	/** The vault path of the results file. */
	readonly path: string;
	readonly results: ProbeResults;
	readonly emitted: number;
	readonly failed: number;
}

/** Runs the whole corpus and writes the results file. */
export async function runProbe(app: App, now: Date): Promise<ProbeRun> {
	if (PROBE_CORPUS.length === 0) {
		throw new Error(
			'the corpus is empty; this build embedded no fixtures at all',
		);
	}
	await ensureFolder(app, PROBE_FOLDER);

	const perFixture: FixtureResult[] = [];
	for (const fixture of PROBE_CORPUS) {
		const inputHash = sha256HexOfText(fixture.content);
		const path = `${PROBE_FOLDER}/${fixture.fileName}`;
		try {
			perFixture.push(await sample(app, path, fixture, inputHash));
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
		obsidianVersion: obsidianVersion(app),
		apiVersion: pluginApiVersion(),
		platform: probePlatform(),
		marker: MARKER,
		perFixture,
	};
	const path = await writeResults(app, results, now);
	const emitted = perFixture.filter(isEmission).length;
	return {
		path,
		results,
		emitted,
		failed: perFixture.length - emitted,
	};
}

/** The name a results file written at this instant takes, less its suffix. */
function resultsBaseName(now: Date): string {
	const stamp = now
		.toISOString()
		.slice(0, 19)
		.replace(/[-:]/g, '')
		.replace('T', '-');
	return `emission-samples-${stamp}Z`;
}

/** A thrown value, said in a way a notice can carry. */
export function describeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message === ''
			? error.name
			: `${error.name}: ${error.message}`;
	}
	if (typeof error === 'string') {
		return error;
	}
	return `a thrown ${typeof error}`;
}

/** One fixture: written fresh, mutated, read back as bytes. */
async function sample(
	app: App,
	path: string,
	fixture: { readonly id: string; readonly content: string },
	inputHash: string,
): Promise<FixtureEmission> {
	const settled = metadataSettles(app, path);
	const file = await writePristine(app, path, fixture.content);
	await settled;

	await app.fileManager.processFrontMatter(
		file,
		(frontmatter: Record<string, unknown>) => {
			frontmatter[MARKER.key] = MARKER.value;
		},
	);

	const emitted = await app.vault.adapter.readBinary(file.path);
	return {
		id: fixture.id,
		inputHash,
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
 * that follows it. A wait that times out resolves anyway: a stale cache is
 * worth recording, a hung command is not.
 */
async function metadataSettles(app: App, path: string): Promise<void> {
	await new Promise<void>((resolve) => {
		let settled = false;
		const finish = (): void => {
			if (settled) {
				return;
			}
			settled = true;
			app.metadataCache.offref(ref);
			window.clearTimeout(timer);
			resolve();
		};
		const ref: EventRef = app.metadataCache.on('changed', (changed) => {
			if (changed.path === path) {
				finish();
			}
		});
		const timer = window.setTimeout(finish, METADATA_WAIT_MS);
	});
}

/** Writes the results file under a name no other run has taken. */
async function writeResults(
	app: App,
	results: ProbeResults,
	now: Date,
): Promise<string> {
	const base = resultsBaseName(now);
	const body = JSON.stringify(results, null, '\t');
	for (let attempt = 1; attempt <= NAME_ATTEMPTS; attempt += 1) {
		const suffix = attempt === 1 ? '' : `-${String(attempt)}`;
		const path = `${PROBE_FOLDER}/${base}${suffix}.json`;
		if (app.vault.getAbstractFileByPath(path) === null) {
			await app.vault.create(path, body);
			return path;
		}
	}
	throw new Error(`${PROBE_FOLDER} already holds every name this run tried`);
}
