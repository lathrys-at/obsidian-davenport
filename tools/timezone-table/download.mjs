/**
 * This script gets the pinned release of the timezone database and puts
 * the files of the release in a cache outside the repository.
 *
 *     node tools/timezone-table/download.mjs
 *
 * `pin.json` states the release, the address of the archive, the checksum
 * of the archive, and the checksum of each file of the release. The
 * script gets the archive from that address with the HTTPS protocol. The
 * script computes the checksum of the archive before it reads one byte of
 * the content. The script computes the checksum of each file before it
 * writes that file. Nothing reaches the cache that the pin does not
 * state.
 *
 * The script writes nothing when the cache already holds the release. The
 * script takes the files out of the archive again when the cache holds
 * the archive and not the files. The script therefore reaches the network
 * one time for one release.
 *
 * The exit status is 0 when the cache holds the release at the end. The
 * status is 1 when bytes do not agree with `pin.json`. The status is 2
 * when the script cannot run at all.
 *
 * `README.md` in this directory states the procedure that moves the pin
 * to a new release.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { get } from 'node:https';
import { dirname, join } from 'node:path';
import { readReleaseArchive } from './archive.ts';
import {
	archiveFile,
	checksum,
	readCachedRelease,
	readPin,
	releaseDirectory,
	timezoneCacheRoot,
	wrongMessage,
	PIN_PATH,
} from './cache.ts';

const EXIT_REFUSED = 1;
const EXIT_UNUSABLE = 2;
const USAGE = 'usage: node tools/timezone-table/download.mjs';

/** The count of seconds that the script waits for an answer. */
const TIMEOUT = 60;

/**
 * The count of bytes that the script takes from the server. The archive
 * of the pinned release is 475,694 bytes. The limit is about eight times
 * that count, and it stops an address that answers with something else.
 */
const LIMIT = 4 * 1024 * 1024;

/** The answers that name another address. */
const MOVED = new Set([301, 302, 303, 307, 308]);

/** The count of addresses that the script follows. */
const HOPS = 5;

const argument = process.argv[2];
if (argument === '--help' || argument === '-h') {
	console.log(USAGE);
	process.exit(0);
}
if (argument !== undefined) {
	console.error(`unknown argument: ${argument}`);
	console.error(USAGE);
	process.exit(EXIT_UNUSABLE);
}

let pin;
try {
	pin = readPin();
} catch (error) {
	console.error(`the script cannot read ${PIN_PATH}: ${String(error)}`);
	process.exit(EXIT_UNUSABLE);
}

const root = timezoneCacheRoot();
const directory = releaseDirectory(root, pin);
const archivePath = archiveFile(root, pin);

const cached = readCachedRelease(pin, root);
if (cached.state === 'wrong') {
	console.error(wrongMessage(pin, root, cached.wrong));
	process.exit(EXIT_REFUSED);
}
if (cached.state === 'ready') {
	console.log(
		`timezone release: ${directory} holds the ${String(cached.files.size)} files of the release ${pin.release}`,
	);
	process.exit(0);
}

let archive = cachedArchive();
if (archive === undefined) {
	console.log(`timezone release: get ${pin.archive.url}`);
	try {
		archive = await getBytes(pin.archive.url, HOPS);
	} catch (error) {
		console.error(`the script cannot get the archive: ${String(error)}`);
		process.exit(EXIT_UNUSABLE);
	}
	const found = checksum(archive);
	if (found !== pin.archive.sha256) {
		console.error(
			`the archive does not agree with ${PIN_PATH}:\n  ${PIN_PATH} states ${pin.archive.sha256}\n  the answer gives ${found}`,
		);
		console.error('The script wrote nothing.');
		process.exit(EXIT_REFUSED);
	}
	write(archivePath, archive);
	console.log(
		`timezone release: ${archivePath} holds ${String(archive.length)} bytes, and the checksum agrees`,
	);
}

const names = Object.keys(pin.files);
let files;
try {
	files = readReleaseArchive(archive, names);
} catch (error) {
	console.error(`the script cannot read the archive: ${String(error)}`);
	process.exit(EXIT_UNUSABLE);
}

// The script computes the checksum of every file before it writes one of
// them. A file that does not agree therefore leaves the cache as it was.
// The reader of the archive gives a file for each name that it received,
// so this loop reads every name of the pin.
for (const [name, bytes] of files) {
	const stated = pin.files[name];
	const found = checksum(bytes);
	if (found !== stated) {
		console.error(
			`the file ${name} of the archive does not agree with ${PIN_PATH}:\n  ${PIN_PATH} states ${stated}\n  the archive gives ${found}`,
		);
		console.error('The script wrote no file of the release.');
		process.exit(EXIT_REFUSED);
	}
}

for (const [name, bytes] of files) {
	write(join(directory, name), bytes);
}

console.log(
	`timezone release: wrote ${String(files.size)} files of the release ${pin.release} into ${directory}`,
);

/** The archive from the cache, where the cache holds it and it agrees. */
function cachedArchive() {
	let bytes;
	try {
		bytes = readFileSync(archivePath);
	} catch {
		console.log(
			`timezone release: the cache holds no archive of the release ${pin.release}`,
		);
		return undefined;
	}
	if (checksum(bytes) === pin.archive.sha256) {
		console.log(`timezone release: ${archivePath} holds the archive`);
		return bytes;
	}
	console.log(
		`timezone release: ${archivePath} is not the archive of the release ${pin.release}, and the script gets the archive again`,
	);
	return undefined;
}

/** Writes the bytes at the path, and makes the directory above it. */
function write(path, bytes) {
	const temporary = `${path}.part`;
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(temporary, bytes);
		renameSync(temporary, path);
	} catch (error) {
		console.error(`the script cannot write ${path}: ${String(error)}`);
		process.exit(EXIT_UNUSABLE);
	}
}

/**
 * The bytes that the address answers with. The script follows an answer
 * that names another address. The script takes an address of the HTTPS
 * protocol and no other address.
 */
function getBytes(url, hops) {
	return new Promise((resolve, reject) => {
		if (new URL(url).protocol !== 'https:') {
			reject(new Error(`${url} does not start with https:`));
			return;
		}
		const request = get(url, (answer) => {
			const status = answer.statusCode ?? 0;
			const next = answer.headers.location;
			if (MOVED.has(status) && next !== undefined) {
				answer.resume();
				if (hops === 0) {
					reject(
						new Error(
							`the server names another address more than ${String(HOPS)} times`,
						),
					);
					return;
				}
				// The server writes this address, and a server can write
				// an address that no reader can read. A throw here is
				// outside the executor of the promise, and it would stop
				// the script with the status of a checksum that
				// disagrees.
				let address;
				try {
					address = new URL(next, url).toString();
				} catch (error) {
					reject(
						new Error(
							`the server names the address ${next}, and the script cannot read it: ${String(error)}`,
						),
					);
					return;
				}
				resolve(getBytes(address, hops - 1));
				return;
			}
			if (status !== 200) {
				answer.resume();
				reject(
					new Error(
						`the server answers ${String(status)} for ${url}`,
					),
				);
				return;
			}
			const parts = [];
			let size = 0;
			answer.on('data', (part) => {
				size += part.length;
				if (size > LIMIT) {
					request.destroy();
					reject(
						new Error(
							`the answer for ${url} passes ${String(LIMIT)} bytes`,
						),
					);
					return;
				}
				parts.push(part);
			});
			answer.on('end', () => {
				resolve(Buffer.concat(parts));
			});
			answer.on('error', reject);
		});
		request.on('error', reject);
		request.setTimeout(TIMEOUT * 1000, () => {
			request.destroy(
				new Error(
					`the server does not answer in ${String(TIMEOUT)} seconds`,
				),
			);
		});
	});
}
