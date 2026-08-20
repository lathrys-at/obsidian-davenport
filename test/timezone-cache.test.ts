/**
 * The cache of the timezone release, and the reader of the archive.
 *
 * The repository holds the checksum of one release of the timezone
 * database, and the download command puts the bytes of that release in a
 * cache outside the repository. These tests cover the two parts of that
 * path that hold no network: where the cache is, what the reader of the
 * cache answers, and how the reader of the archive takes the files out of
 * it.
 *
 * The tests build their own archive, so they need no release.
 */

import { gzipSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	readReleaseArchive,
	readTarFiles,
} from '../tools/timezone-table/archive';
import {
	absentMessage,
	archiveFile,
	checksum,
	readCachedRelease,
	readPin,
	releaseDirectory,
	timezoneCacheRoot,
	wrongMessage,
	type Pin,
} from '../tools/timezone-table/cache';

const BLOCK = 512;

/** A pin of two files, for the cases that need no real release. */
const pin: Pin = {
	release: '1970a',
	form: 'main',
	archive: {
		name: 'tzdata1970a.tar.gz',
		url: 'https://data.example/tzdata1970a.tar.gz',
		signature: 'tzdata1970a.tar.gz.asc',
		signatureUrl: 'https://data.example/tzdata1970a.tar.gz.asc',
		sha256: checksum(Buffer.from('archive')),
	},
	data: ['africa'],
	files: {
		africa: checksum(Buffer.from('the rules of africa')),
		version: checksum(Buffer.from('1970a\n')),
	},
};

/** One entry of a tar archive: the header block and the blocks of bytes. */
function entry(
	name: string,
	body: string,
	change: {
		readonly type?: string;
		readonly prefix?: string;
		readonly size?: string;
		readonly checksum?: string;
	} = {},
): Buffer {
	const header = Buffer.alloc(BLOCK);
	header.write(name, 0, 100, 'latin1');
	header.write('0000644\0', 100, 8, 'latin1');
	header.write('0000000\0', 108, 8, 'latin1');
	header.write('0000000\0', 116, 8, 'latin1');
	const size =
		change.size ?? Buffer.byteLength(body).toString(8).padStart(11, '0');
	header.write(`${size}\0`, 124, 12, 'latin1');
	header.write('00000000000\0', 136, 12, 'latin1');
	header.write('        ', 148, 8, 'latin1');
	header.write(change.type ?? '0', 156, 1, 'latin1');
	header.write('ustar\0', 257, 6, 'latin1');
	header.write('00', 263, 2, 'latin1');
	header.write(change.prefix ?? '', 345, 155, 'latin1');
	let sum = 0;
	for (const byte of header) {
		sum += byte;
	}
	const stated = change.checksum ?? `${sum.toString(8).padStart(6, '0')}\0 `;
	header.write(stated, 148, 8, 'latin1');
	const bytes = Buffer.from(body, 'latin1');
	const padding = Buffer.alloc((BLOCK - (bytes.length % BLOCK)) % BLOCK);
	return Buffer.concat([header, bytes, padding]);
}

/** A whole archive: the entries, and the two blocks that end it. */
function archive(...entries: readonly Buffer[]): Buffer {
	return Buffer.concat([...entries, Buffer.alloc(BLOCK * 2)]);
}

describe('the place of the cache', () => {
	it('takes the directory that the environment names', () => {
		expect(
			timezoneCacheRoot(
				{ DAVENPORT_TIMEZONE_CACHE: '/somewhere/else' },
				'/home/person',
			),
		).toBe('/somewhere/else');
	});

	it('takes the cache home of the environment', () => {
		expect(
			timezoneCacheRoot(
				{ XDG_CACHE_HOME: '/state/cache' },
				'/home/person',
			),
		).toBe(join('/state/cache', 'davenport', 'timezone-database'));
	});

	it('takes the cache directory of the home directory', () => {
		expect(timezoneCacheRoot({}, '/home/person')).toBe(
			join('/home/person', '.cache', 'davenport', 'timezone-database'),
		);
	});

	it('reads an empty value as no value', () => {
		expect(
			timezoneCacheRoot(
				{ DAVENPORT_TIMEZONE_CACHE: '', XDG_CACHE_HOME: '' },
				'/home/person',
			),
		).toBe(
			join('/home/person', '.cache', 'davenport', 'timezone-database'),
		);
	});

	it('gives each release a directory of its own', () => {
		expect(releaseDirectory('/cache', pin)).toBe(join('/cache', '1970a'));
		expect(archiveFile('/cache', pin)).toBe(
			join('/cache', 'tzdata1970a.tar.gz'),
		);
	});

	it('states the same place for the whole repository', () => {
		// The download command writes the cache and the tests read it. A
		// second answer here would let a test state that it has no input
		// while the command reports success.
		expect(timezoneCacheRoot()).toBe(timezoneCacheRoot());
	});
});

describe('the reader of the cache', () => {
	let root = '';

	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), 'davenport-timezone-cache-'));
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	/** Writes the files of one case into a cache of its own. */
	function cache(files: Readonly<Record<string, string>>): string {
		const place = mkdtempSync(join(root, 'case-'));
		const directory = releaseDirectory(place, pin);
		mkdirSync(directory, { recursive: true });
		for (const [name, body] of Object.entries(files)) {
			writeFileSync(join(directory, name), body);
		}
		return place;
	}

	it('gives the files where every checksum agrees', () => {
		const place = cache({
			africa: 'the rules of africa',
			version: '1970a\n',
		});
		const read = readCachedRelease(pin, place);
		expect(read.state).toBe('ready');
		if (read.state !== 'ready') {
			return;
		}
		expect([...read.files.keys()].sort()).toEqual(['africa', 'version']);
		expect(read.files.get('version')?.toString('utf8')).toBe('1970a\n');
	});

	it('names the files that the cache does not hold', () => {
		const read = readCachedRelease(pin, cache({ version: '1970a\n' }));
		expect(read.state).toBe('absent');
		if (read.state !== 'absent') {
			return;
		}
		expect(read.missing).toEqual(['africa']);
	});

	it('names a file whose bytes are not the bytes of the release', () => {
		const read = readCachedRelease(
			pin,
			cache({ africa: 'the rules of africa!', version: '1970a\n' }),
		);
		expect(read.state).toBe('wrong');
		if (read.state !== 'wrong') {
			return;
		}
		expect(read.wrong.length).toBe(1);
		expect(read.wrong[0]?.name).toBe('africa');
		expect(read.wrong[0]?.stated).toBe(pin.files.africa);
		expect(read.wrong[0]?.found).not.toBe(pin.files.africa);
	});

	it('reports the wrong bytes before the absent file', () => {
		// A file that nobody can explain is the more serious of the two
		// conditions, and a caller that only skips would hide it.
		const read = readCachedRelease(
			pin,
			cache({ africa: 'the rules of somewhere else' }),
		);
		expect(read.state).toBe('wrong');
	});

	it('reports an empty cache as absent', () => {
		const read = readCachedRelease(pin, join(root, 'nothing-here'));
		expect(read.state).toBe('absent');
		if (read.state !== 'absent') {
			return;
		}
		expect(read.missing).toEqual(['africa', 'version']);
	});

	it('gives a read that failed for another reason to the caller', () => {
		// Such a read is a fault. An answer of absent would make a test
		// state that it has no input, and the fault would stay unseen.
		const place = cache({ version: '1970a\n' });
		mkdirSync(join(releaseDirectory(place, pin), 'africa'));
		expect(() => readCachedRelease(pin, place)).toThrow(/EISDIR/);
	});
});

describe('the messages of the cache', () => {
	it('names the command that gets the release', () => {
		const message = absentMessage(pin, '/cache', ['africa']);
		expect(message).toContain('1970a');
		expect(message).toContain('npm run timezone:download');
		expect(message).toContain(join('/cache', '1970a'));
	});

	it('names the file, the checksum of the pin, and the checksum found', () => {
		const message = wrongMessage(pin, '/cache', [
			{ name: 'africa', stated: 'a1', found: 'b2' },
		]);
		expect(message).toContain(join('/cache', '1970a', 'africa'));
		expect(message).toContain('a1');
		expect(message).toContain('b2');
		expect(message).toContain('tools/timezone-table/pin.json');
	});
});

describe('the reader of the archive', () => {
	it('gives the files that the caller names', () => {
		const bytes = archive(
			entry('africa', 'the rules of africa'),
			entry('asia', 'the rules of asia'),
		);
		const read = readTarFiles(bytes, ['africa']);
		expect([...read.keys()]).toEqual(['africa']);
		expect(read.get('africa')?.toString('utf8')).toBe(
			'the rules of africa',
		);
	});

	it('reads a file whose bytes fill more than one block', () => {
		const body = 'x'.repeat(1100);
		const read = readTarFiles(
			archive(entry('africa', body), entry('version', '1970a\n')),
			['africa', 'version'],
		);
		expect(read.get('africa')?.toString('utf8')).toBe(body);
		expect(read.get('version')?.toString('utf8')).toBe('1970a\n');
	});

	it('reads a name that stands in two fields', () => {
		const read = readTarFiles(
			archive(entry('africa', 'rules', { prefix: 'tzdata' })),
			['tzdata/africa'],
		);
		expect(read.get('tzdata/africa')?.toString('utf8')).toBe('rules');
	});

	it('reads a file that the first form of tar states', () => {
		const read = readTarFiles(
			archive(entry('africa', 'rules', { type: '\0' })),
			['africa'],
		);
		expect(read.get('africa')?.toString('utf8')).toBe('rules');
	});

	it('takes no bytes from an entry that is not a file', () => {
		expect(() =>
			readTarFiles(archive(entry('africa', '', { type: '5' })), [
				'africa',
			]),
		).toThrow(/holds no file named africa/);
	});

	it('stops at the blocks that end the archive', () => {
		const bytes = Buffer.concat([
			archive(entry('africa', 'rules')),
			entry('asia', 'rules after the end'),
		]);
		expect(() => readTarFiles(bytes, ['asia'])).toThrow(
			/holds no file named asia/,
		);
	});

	it('refuses a name that the archive states two times', () => {
		expect(() =>
			readTarFiles(
				archive(entry('africa', 'one'), entry('africa', 'two')),
				['africa'],
			),
		).toThrow(/holds the file africa two times/);
	});

	it('refuses a block that states no checksum', () => {
		const bytes = archive(entry('africa', 'rules'));
		bytes.write('not a tar', 148, 8, 'latin1');
		expect(() => readTarFiles(bytes, ['africa'])).toThrow(
			/states no checksum/,
		);
	});

	it('refuses a header whose bytes do not give its checksum', () => {
		const bytes = archive(entry('africa', 'rules'));
		bytes.write('europe', 0, 6, 'latin1');
		expect(() => readTarFiles(bytes, ['africa'])).toThrow(
			/states the checksum/,
		);
	});

	it('refuses a count of bytes that is not octal digits', () => {
		expect(() =>
			readTarFiles(archive(entry('africa', 'rules', { size: 'many' })), [
				'africa',
			]),
		).toThrow(/wants octal digits/);
	});

	it('refuses an archive that stops inside a file', () => {
		const bytes = archive(entry('africa', 'rules')).subarray(0, BLOCK + 3);
		expect(() => readTarFiles(bytes, ['africa'])).toThrow(
			/stops before them/,
		);
	});

	it('reads the gzip form that the release ships', () => {
		const read = readReleaseArchive(
			gzipSync(archive(entry('africa', 'the rules of africa'))),
			['africa'],
		);
		expect(read.get('africa')?.toString('utf8')).toBe(
			'the rules of africa',
		);
	});
});

describe('the pin in the repository', () => {
	it('states a release, an archive, and a checksum for each file', () => {
		const read = readPin();
		expect(read.release).toMatch(/^[0-9]{4}[a-z]$/);
		expect(read.archive.url).toContain(read.archive.name);
		expect(read.archive.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(Object.keys(read.files).length).toBe(12);
		for (const stated of Object.values(read.files)) {
			expect(stated).toMatch(/^[0-9a-f]{64}$/);
		}
	});

	it('names the archive of the release that it states', () => {
		const read = readPin();
		expect(read.archive.name).toBe(`tzdata${read.release}.tar.gz`);
		expect(read.archive.signature).toBe(`${read.archive.name}.asc`);
	});

	it('gets the archive from the server of the timezone project', () => {
		const read = readPin();
		expect(new URL(read.archive.url).origin).toBe('https://data.iana.org');
		expect(new URL(read.archive.signatureUrl).origin).toBe(
			'https://data.iana.org',
		);
	});
});
