/**
 * The pin of the timezone release, and the cache that holds the release.
 *
 * The repository holds the checksum of one release of the timezone
 * database. The repository does not hold the bytes of that release. The
 * download command gets those bytes and puts them in a cache outside the
 * repository. This module states where the cache is, and it reads the
 * release out of the cache.
 *
 * Every read computes the checksum of the file. The read then compares
 * that checksum against the checksum in `pin.json`. The read gives one of
 * three answers: the cache holds the release; the cache holds no copy of
 * the release; or the cache holds a file whose bytes are not the bytes of
 * the release. The three answers stay apart because a caller acts
 * differently on each one. A test that gets the second answer states that
 * it has no input, and the test runs nothing. A test that gets the third
 * answer fails.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The archive of the release, as the pin records it. */
export interface PinnedArchive {
	readonly name: string;
	readonly url: string;
	readonly signature: string;
	readonly signatureUrl: string;
	readonly sha256: string;
}

/** The record of the pinned release. `pin.json` holds it. */
export interface Pin {
	readonly release: string;
	readonly form: string;
	readonly archive: PinnedArchive;
	/** The files that the generator reads, in the order that it reads them. */
	readonly data: readonly string[];
	/** The checksum of each file of the release, by the name of the file. */
	readonly files: Readonly<Record<string, string>>;
}

/** The path of the pin, for a message that names it. */
export const PIN_PATH = 'tools/timezone-table/pin.json';

/** The command that gets the release, for a message that names it. */
export const DOWNLOAD_COMMAND = 'npm run timezone:download';

/** The variable that names another directory for the cache. */
export const CACHE_VARIABLE = 'DAVENPORT_TIMEZONE_CACHE';

/** The pinned release. */
export function readPin(): Pin {
	return JSON.parse(
		readFileSync(join(import.meta.dirname, 'pin.json'), 'utf8'),
	) as Pin;
}

/**
 * The directory that holds the releases that a person downloaded.
 *
 * The directory is outside the repository. The bytes of a release are not
 * the work of this repository, and a checkout must not carry them. The
 * directory is in the cache home of the user, because a person can get
 * the bytes again at any time.
 *
 * The place of the directory follows three rules, in this order:
 *
 * - the directory that the variable `DAVENPORT_TIMEZONE_CACHE` names,
 *   where the environment sets that variable;
 * - `davenport/timezone-database` under the directory that the variable
 *   `XDG_CACHE_HOME` names, where the environment sets that variable;
 * - `.cache/davenport/timezone-database` in the home directory of the
 *   user, in all other conditions.
 */
export function timezoneCacheRoot(
	environment: Readonly<Partial<Record<string, string>>> = process.env,
	home: string = homedir(),
): string {
	const named = environment[CACHE_VARIABLE];
	if (named !== undefined && named !== '') {
		return named;
	}
	const stated = environment.XDG_CACHE_HOME;
	const base =
		stated !== undefined && stated !== '' ? stated : join(home, '.cache');
	return join(base, 'davenport', 'timezone-database');
}

/**
 * The directory that holds the files of one release. The name of the
 * release names the directory, so a new pin takes nothing away from the
 * cache and a person can compare two releases.
 */
export function releaseDirectory(root: string, pin: Pin): string {
	return join(root, pin.release);
}

/** The file that holds the archive of one release. */
export function archiveFile(root: string, pin: Pin): string {
	return join(root, pin.archive.name);
}

/** The checksum of the bytes, in the form that the pin states. */
export function checksum(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/** One file of the cache whose bytes are not the bytes of the release. */
export interface WrongFile {
	readonly name: string;
	readonly stated: string;
	readonly found: string;
}

/** What the cache holds for one release. */
export type CachedRelease =
	| { readonly state: 'ready'; readonly files: ReadonlyMap<string, Buffer> }
	| { readonly state: 'absent'; readonly missing: readonly string[] }
	| { readonly state: 'wrong'; readonly wrong: readonly WrongFile[] };

/**
 * The files of the release, from the cache. The reader compares the
 * checksum of each file against the pin. A file that disagrees makes the
 * whole answer `wrong`, even where another file is also absent: bytes
 * that nobody can explain are the more serious of the two conditions.
 */
export function readCachedRelease(pin: Pin, root: string): CachedRelease {
	const directory = releaseDirectory(root, pin);
	const files = new Map<string, Buffer>();
	const missing: string[] = [];
	const wrong: WrongFile[] = [];
	for (const [name, stated] of Object.entries(pin.files)) {
		let bytes;
		try {
			bytes = readFileSync(join(directory, name));
		} catch (error) {
			if (!isMissing(error)) {
				throw error;
			}
			missing.push(name);
			continue;
		}
		const found = checksum(bytes);
		if (found === stated) {
			files.set(name, bytes);
		} else {
			wrong.push({ name, stated, found });
		}
	}
	if (wrong.length > 0) {
		return { state: 'wrong', wrong };
	}
	if (missing.length > 0) {
		return { state: 'absent', missing };
	}
	return { state: 'ready', files };
}

/**
 * Whether the error of a read states that the file is not there. A read
 * that failed for another reason is a fault, and the reader gives it to
 * the caller. A fault that reads as an absence would make a test state
 * that it has no input, and the fault would stay unseen.
 */
function isMissing(error: unknown): boolean {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** What a caller says when the cache holds no copy of the release. */
export function absentMessage(
	pin: Pin,
	root: string,
	missing: readonly string[],
): string {
	const count = Object.keys(pin.files).length;
	const held = count - missing.length;
	return (
		`the cache holds no copy of the release ${pin.release}. The ` +
		`directory ${releaseDirectory(root, pin)} holds ${String(held)} of ` +
		`the ${String(count)} files of the release. Run ${DOWNLOAD_COMMAND} ` +
		`to get them.`
	);
}

/** What a caller says when the cache holds bytes that the pin refuses. */
export function wrongMessage(
	pin: Pin,
	root: string,
	wrong: readonly WrongFile[],
): string {
	const directory = releaseDirectory(root, pin);
	const lines = wrong.map(
		(file) =>
			`  ${join(directory, file.name)}\n` +
			`    ${PIN_PATH} states ${file.stated}\n` +
			`    the file gives   ${file.found}`,
	);
	return (
		`the cache holds bytes that are not the release ${pin.release}:\n` +
		`${lines.join('\n')}\n` +
		`Remove each file that this message names, then run ` +
		`${DOWNLOAD_COMMAND} again.`
	);
}
