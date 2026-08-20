/**
 * This script writes the timezone table into the source of the plugin.
 *
 *     node tools/timezone-table/generate.mjs
 *     node tools/timezone-table/generate.mjs --check
 *
 * The script reads the timezone database files under `vendor/`. Those
 * files come from one release of the database, and `pin.json` names that
 * release and holds the checksum of every one of the files. The script
 * stops when a checksum does not agree. The script reaches no network.
 *
 * Without an argument the script writes the module. With `--check` the
 * script writes nothing and compares instead. The exit status is 0 when
 * the module on disk holds what the generator writes now. The exit status
 * is 1 when the two differ. The exit status is 2 when the script cannot
 * run at all.
 *
 * `README.md` in this directory states how to move the pin to a new
 * release.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeTable, tableNames } from './encode.ts';
import { expandZones } from './expand.ts';
import { tableModule, TABLE_MODULE_PATH } from './module.ts';
import { parseTimezoneSource } from './source.ts';

const EXIT_DIFFERS = 1;
const EXIT_UNUSABLE = 2;
const USAGE = 'usage: node tools/timezone-table/generate.mjs [--check]';

const here = new URL('./', import.meta.url);
const root = new URL('../../', here);
const modulePath = fileURLToPath(new URL(TABLE_MODULE_PATH, root));

const argument = process.argv[2];
if (argument === '--help' || argument === '-h') {
	console.log(USAGE);
	process.exit(0);
}
if (argument !== undefined && argument !== '--check') {
	console.error(`unknown argument: ${argument}`);
	console.error(USAGE);
	process.exit(EXIT_UNUSABLE);
}
const check = argument === '--check';

let pin;
try {
	pin = JSON.parse(readFileSync(new URL('pin.json', here), 'utf8'));
} catch (error) {
	console.error(`the script cannot read pin.json: ${String(error)}`);
	process.exit(EXIT_UNUSABLE);
}

const texts = new Map();
for (const [name, expected] of Object.entries(pin.files)) {
	let bytes;
	try {
		bytes = readFileSync(new URL(`vendor/${name}`, here));
	} catch (error) {
		console.error(
			`the script cannot read vendor/${name}: ${String(error)}`,
		);
		process.exit(EXIT_UNUSABLE);
	}
	const found = createHash('sha256').update(bytes).digest('hex');
	if (found !== expected) {
		console.error(
			`vendor/${name} does not agree with pin.json:\n  pin.json states ${expected}\n  the file gives ${found}`,
		);
		console.error(
			'The vendored files and the pin must come from one release. See tools/timezone-table/README.md.',
		);
		process.exit(EXIT_UNUSABLE);
	}
	texts.set(name, bytes.toString('utf8'));
}

const stated = (texts.get('version') ?? '').trim();
if (stated !== pin.release) {
	console.error(
		`vendor/version states the release ${stated}, and pin.json states ${pin.release}`,
	);
	process.exit(EXIT_UNUSABLE);
}

let wanted;
try {
	const source = parseTimezoneSource(
		pin.data.map((name) => ({ name, text: texts.get(name) ?? '' })),
	);
	const table = encodeTable(expandZones(source), tableNames(source));
	wanted = tableModule(pin.release, table);
} catch (error) {
	console.error(`the generator stopped: ${String(error)}`);
	process.exit(EXIT_UNUSABLE);
}

if (check) {
	let found;
	try {
		found = readFileSync(modulePath, 'utf8');
	} catch (error) {
		console.error(
			`the script cannot read ${TABLE_MODULE_PATH}: ${String(error)}`,
		);
		process.exit(EXIT_DIFFERS);
	}
	if (found === wanted) {
		console.log(
			`timezone table: ${TABLE_MODULE_PATH} holds what the release ${pin.release} gives`,
		);
		process.exit(0);
	}
	console.error(
		`timezone table: ${TABLE_MODULE_PATH} differs from what the release ${pin.release} gives. Run node tools/timezone-table/generate.mjs and commit the result.`,
	);
	process.exit(EXIT_DIFFERS);
}

writeFileSync(modulePath, wanted, 'utf8');
const lines = wanted.split('\n').length - 1;
console.log(
	`timezone table: wrote ${TABLE_MODULE_PATH} from the release ${pin.release} (${String(Buffer.byteLength(wanted))} bytes, ${String(lines)} lines)`,
);
