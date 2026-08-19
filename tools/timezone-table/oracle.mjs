/**
 * This script writes the offset fixture that the tests of the timezone
 * table read.
 *
 *     zic -b fat -d /tmp/zoneinfo tools/timezone-table/vendor/{africa,...}
 *     node tools/timezone-table/oracle.mjs /tmp/zoneinfo
 *
 * The fixture states what one zone answers at one instant. The answers
 * come from `zic`, the compiler that the timezone project ships. The
 * tests then compare the plugin against a second reader of the same
 * release, and not against the plugin itself.
 *
 * `zic` writes files in the TZif form. This script reads that form. It
 * reads the version 2 block, which states the instants in 64 bits.
 *
 * The compiler writes every change out through 2037 and states the years
 * after that as a rule. This script therefore samples no instant after
 * 2037, so that every row of the fixture comes from bytes that the
 * compiler wrote.
 *
 * Run this script again when the pin moves to a new release.
 * `README.md` in this directory states that procedure.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXIT_UNUSABLE = 2;
const USAGE =
	'usage: node tools/timezone-table/oracle.mjs <zoneinfo directory>';

/** The zones that the fixture states at every change of the clock. */
const DENSE = [
	'Africa/Casablanca',
	'America/Grand_Turk',
	'America/New_York',
	'America/Santiago',
	'Antarctica/Troll',
	'Asia/Gaza',
	'Asia/Kolkata',
	'Asia/Tbilisi',
	'Australia/Lord_Howe',
	'Europe/Dublin',
	'Europe/London',
	'Pacific/Apia',
	'Pacific/Chatham',
];

/** The instants that the fixture states for every zone. */
const SAMPLE = [
	'1970-01-01T00:00:00Z',
	'1978-07-01T12:00:00Z',
	'1990-01-15T05:30:00Z',
	'1999-07-04T23:15:00Z',
	'2007-03-15T09:00:00Z',
	'2014-11-02T06:45:00Z',
	'2021-06-30T18:20:00Z',
	'2030-01-01T00:00:00Z',
	'2036-12-25T11:11:11Z',
].map((text) => Date.parse(text) / 1000);

const root = new URL('../../', new URL('./', import.meta.url));
const fixturePath = fileURLToPath(
	new URL('test/harness/fixtures/timezone-offsets.txt', root),
);

const directory = process.argv[2];
if (directory === undefined || directory === '--help' || directory === '-h') {
	console.error(USAGE);
	process.exit(directory === undefined ? EXIT_UNUSABLE : 0);
}

const zones = read(directory);
if (zones.length === 0) {
	console.error(`${directory} holds no compiled timezone file`);
	process.exit(EXIT_UNUSABLE);
}

const blocks = [];
for (const zone of zones) {
	const rows = [];
	for (const at of SAMPLE) {
		rows.push({ ...row(zone, at), dense: false });
	}
	if (DENSE.includes(zone.name)) {
		for (const at of zone.times) {
			if (at > 0 && at < Date.parse('2037-01-01T00:00:00Z') / 1000) {
				rows.push({ ...row(zone, at - 1), dense: true });
				rows.push({ ...row(zone, at), dense: true });
			}
		}
	}
	const seen = new Set();
	const ordered = [];
	for (const entry of rows.sort((left, right) => left.at - right.at)) {
		if (!seen.has(entry.at)) {
			seen.add(entry.at);
			ordered.push(entry);
		}
	}
	// A row that repeats the state of the row before it states nothing
	// that the row before it does not state. The first row, the last row,
	// and every row that a change touches stay.
	const kept = ordered.filter((entry, index) => {
		if (entry.dense || index === 0 || index === ordered.length - 1) {
			return true;
		}
		const before = ordered[index - 1];
		return (
			before === undefined ||
			before.offset !== entry.offset ||
			before.isDaylight !== entry.isDaylight ||
			before.abbreviation !== entry.abbreviation
		);
	});
	blocks.push(
		`${zone.name}\n${kept
			.map(
				(entry) =>
					`\t${String(entry.at)} ${String(entry.offset)} ${entry.isDaylight ? '1' : '0'} ${entry.abbreviation}`,
			)
			.join('\n')}`,
	);
}

const text = `${blocks.join('\n')}\n`;
writeFileSync(fixturePath, text, 'utf8');
console.log(
	`timezone oracle: wrote ${String(zones.length)} zones and ${String(
		text.split('\n').length - 1 - zones.length,
	)} rows to test/harness/fixtures/timezone-offsets.txt`,
);

/** The state of one zone at one instant, as the compiled file states it. */
function row(zone, at) {
	let type = zone.initial;
	for (let index = 0; index < zone.times.length; index += 1) {
		const time = zone.times[index];
		if (time !== undefined && time <= at) {
			type = zone.types[zone.indexes[index]];
		} else {
			break;
		}
	}
	return {
		at,
		offset: type.offset,
		isDaylight: type.isDaylight,
		abbreviation: type.abbreviation,
	};
}

/** Every compiled file under the directory, with its name. */
function read(directory, prefix = '') {
	const found = [];
	for (const entry of readdirSync(directory).sort()) {
		const path = join(directory, entry);
		const name = prefix === '' ? entry : `${prefix}/${entry}`;
		if (statSync(path).isDirectory()) {
			found.push(...read(path, name));
			continue;
		}
		const bytes = readFileSync(path);
		if (bytes.length < 5 || bytes.toString('latin1', 0, 4) !== 'TZif') {
			continue;
		}
		found.push({ name, ...parse(bytes, name) });
	}
	return found;
}

/** The version 2 block of one file in the TZif form. */
function parse(bytes, name) {
	const header = (start) => ({
		version: bytes.toString('latin1', start + 4, start + 5),
		universalCount: bytes.readUInt32BE(start + 20),
		standardCount: bytes.readUInt32BE(start + 24),
		leapCount: bytes.readUInt32BE(start + 28),
		timeCount: bytes.readUInt32BE(start + 32),
		typeCount: bytes.readUInt32BE(start + 36),
		charCount: bytes.readUInt32BE(start + 40),
		end: start + 44,
	});
	const first = header(0);
	if (first.version === '\0') {
		throw new Error(`${name} holds no version 2 block`);
	}
	const second = header(
		first.end +
			first.timeCount * 5 +
			first.typeCount * 6 +
			first.charCount +
			first.leapCount * 8 +
			first.standardCount +
			first.universalCount,
	);
	let at = second.end;
	const times = [];
	for (let index = 0; index < second.timeCount; index += 1) {
		times.push(Number(bytes.readBigInt64BE(at)));
		at += 8;
	}
	const indexes = [];
	for (let index = 0; index < second.timeCount; index += 1) {
		indexes.push(bytes.readUInt8(at));
		at += 1;
	}
	const types = [];
	for (let index = 0; index < second.typeCount; index += 1) {
		types.push({
			offset: bytes.readInt32BE(at),
			isDaylight: bytes.readUInt8(at + 4) === 1,
			nameAt: bytes.readUInt8(at + 5),
		});
		at += 6;
	}
	const names = bytes.toString('latin1', at, at + second.charCount);
	for (const type of types) {
		type.abbreviation = names.slice(
			type.nameAt,
			names.indexOf('\0', type.nameAt),
		);
	}
	let initial = types[0];
	for (let index = 0; index < times.length; index += 1) {
		const time = times[index];
		if (time !== undefined && time <= 0) {
			initial = types[indexes[index]];
		}
	}
	return { times, indexes, types, initial };
}
