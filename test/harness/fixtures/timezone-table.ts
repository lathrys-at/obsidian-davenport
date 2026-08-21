/**
 * The committed digest of the whole synthesised table.
 *
 * The golden corpus of the synthesiser holds the bytes of twelve zones.
 * That corpus gives a legible difference, and it reads no other zone. This
 * gate reads every zone of the table and gives one answer over all of
 * them. The committed file holds one digest, and the digest covers the
 * release of the bundled table and the definition of every name that the
 * table holds.
 *
 * The two gates answer different questions, and a change keeps both. A
 * failure of the golden corpus names the zone and shows the bytes. A
 * failure of this gate says that one byte of one definition moved, and it
 * names no zone.
 *
 * The bytes of a definition follow from two things: the release of the
 * bundled table, and the code that writes a definition from it. The
 * timezone component of the normalization stamp covers both. The
 * comparison of two records reads the two base snapshots whole where the
 * two records carry one value of that component. A build that moves a
 * definition and keeps the component therefore makes two devices rewrite
 * one record in turn, and neither device stops. This gate holds the bytes
 * and the component together over the whole table.
 *
 * The name of the file carries the value of the timezone component that
 * wrote the digest. The file `timezone-1.digest` therefore holds the
 * digest that the build of the component 1 computed. The layout ties a
 * change of the bytes to a change of the component in two ways.
 *
 * - A change to the synthesiser or to the table that does not raise the
 *   component reads the file of the old value. The digest in that file
 *   differs from the new digest, and the test fails and names the
 *   component.
 * - A change that raises the component finds no file for the new value.
 *   The test then names the file to write.
 *
 * A file that an earlier value wrote stays in the tree. No test can
 * recompute such a digest, because the build holds one table and one
 * synthesiser. The file is a record of what an earlier build wrote, and a
 * shape test holds each file to the form of a digest.
 *
 * The environment variable `DAVENPORT_WRITE_TIMEZONE_DIGEST` makes the
 * test write the digest of the current component. The test then fails, so
 * a run that writes a digest never reports success.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/** One committed digest, with the component value that wrote it. */
export interface TimezoneTableDigest {
	/** The value of the timezone component that wrote this digest. */
	readonly timezone: number;
	/** The path of the file that holds the digest. */
	readonly path: string;
	/** The digest, in the hexadecimal form, in lower case. */
	readonly digest: string;
}

const DIGEST_ROOT = join(import.meta.dirname, 'timezone-table');
const FILE_PREFIX = 'timezone-';
const EXTENSION = '.digest';
const WRITE_VARIABLE = 'DAVENPORT_WRITE_TIMEZONE_DIGEST';

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Every committed digest, from the oldest component to the newest. */
export function timezoneTableDigests(): readonly TimezoneTableDigest[] {
	if (!existsSync(DIGEST_ROOT)) {
		return [];
	}
	return readdirSync(DIGEST_ROOT, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(EXTENSION))
		.map((entry) => read(entry.name))
		.sort((left, right) => left.timezone - right.timezone);
}

/** The digest of one component value, or nothing where no file holds one. */
export function timezoneTableDigest(timezone: number): string | undefined {
	return timezoneTableDigests().find((entry) => entry.timezone === timezone)
		?.digest;
}

/** The path that the digest of the given component value takes. */
export function timezoneTableDigestPath(timezone: number): string {
	return join(DIGEST_ROOT, `${FILE_PREFIX}${String(timezone)}${EXTENSION}`);
}

/** True when the environment asks the test to write the digest. */
export function timezoneTableDigestWriteRequested(): boolean {
	return process.env[WRITE_VARIABLE] !== undefined;
}

/** Writes the digest of one component value. */
export function writeTimezoneTableDigest(
	timezone: number,
	digest: string,
): string {
	const path = timezoneTableDigestPath(timezone);
	mkdirSync(DIGEST_ROOT, { recursive: true });
	writeFileSync(path, `${digest}\n`, 'utf8');
	return path;
}

function read(file: string): TimezoneTableDigest {
	const path = join(DIGEST_ROOT, file);
	return {
		timezone: Number(file.slice(FILE_PREFIX.length, -EXTENSION.length)),
		path,
		digest: utf8.decode(readFileSync(path)).trim(),
	};
}
