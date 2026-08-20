/**
 * A release attaches `main.js` to a tag, and nothing confirmed that a second
 * build of the same source writes that same file. This check confirms it. A
 * person can then build the source and compare the result against the file
 * that the release carries.
 *
 * The check runs the build two times. Before each run, the check removes the
 * metafile and every file that the metafile names. Each run therefore starts
 * with the output files of the build absent, and the second run can neither
 * read nor keep a file of the first run. After each run, the check reads the
 * metafile and every file that the metafile names.
 *
 * The check then compares the two sets of files octet by octet. Three things
 * fail the check:
 *
 * - a file whose octets are not the same in the two runs. The failure names
 *   the file, gives the place of the first octet that differs, gives the
 *   count of octets of each of the two files, and prints the octets of each
 *   run around that place;
 * - a file that only one of the two runs wrote;
 * - a build that declares no output file.
 *
 * The check compares the metafile too. The metafile names each input file and
 * each output file of the build, and it gives the count of octets of each
 * one. esbuild writes those names relative to the directory that the build
 * ran in, so the metafile holds no absolute path. Two runs in one directory
 * must therefore write the same metafile. `scripts/bundle-size.mjs` reads the
 * metafile, and a metafile that changes between two runs makes the report of
 * that check change too.
 *
 * The claim is narrow. The check compares two runs on one machine, with the
 * versions of Node and esbuild that this repository pins. The check does not
 * compare two machines, and it does not compare two versions of the tools.
 *
 * By default the check builds the plugin. It runs `esbuild.config.mjs
 * production` in the root of the repository. Give a directory and a script to
 * check another build: Node runs the script, the directory is the working
 * directory of each run, and the metafile is `bundle-meta.json` in that
 * directory.
 *
 *     node scripts/repeat-build.mjs
 *     node scripts/repeat-build.mjs <directory> <script> [argument...]
 *
 * The check leaves the files of the second run on disk. Those files are the
 * files that the build writes, so the working tree ends as `npm run build`
 * leaves it.
 *
 * This file runs the builds, reads the files, prints the report, and sets the
 * exit status. `repeat-build-core.ts` holds the decisions behind the
 * comparison. `repeat-build-text.ts` holds the wording that the check prints.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, outputPaths } from './repeat-build-core.ts';
import { failureLines, reportLines, say } from './repeat-build-text.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const METAFILE = 'bundle-meta.json';

/** The build that the check runs when the command line names no other one. */
const BUILD = ['esbuild.config.mjs', 'production'];

const argv = process.argv.slice(2);
const directory = resolve(argv[0] ?? ROOT);
const command = argv.length > 1 ? argv.slice(1) : BUILD;
const metafile = join(directory, METAFILE);

/** The reason that an error carries. */
function said(error) {
	return error instanceof Error ? error.message : String(error);
}

/** Says these lines and ends the run with a failure. */
function stop(lines) {
	for (const line of lines) {
		console.error(line);
	}
	process.exit(1);
}

/**
 * The files that the metafile names, or nothing when the metafile is absent.
 * A metafile that the check cannot read ends the run.
 */
function declared() {
	let text;
	try {
		text = readFileSync(metafile, 'utf8');
	} catch {
		return undefined;
	}
	const reading = outputPaths(text);
	if (!reading.ok) {
		stop([say(`the metafile at ${metafile} ${reading.reason}`)]);
	}
	return reading.value;
}

/**
 * Removes the metafile and every file that the metafile names. The next run
 * of the build then starts with the output files of the build absent.
 */
function clean() {
	for (const path of declared() ?? []) {
		rmSync(join(directory, path), { force: true });
	}
	rmSync(metafile, { force: true });
}

/** One file of a build, with its octets and the digest of those octets. */
function taken(path) {
	const file = join(directory, path);
	let bytes;
	try {
		bytes = readFileSync(file);
	} catch (error) {
		stop([
			say(`the check cannot read the file at ${file}: ${said(error)}`),
			say('the metafile names that file, and the build did not write it'),
		]);
	}
	return {
		path,
		bytes: Uint8Array.from(bytes),
		digest: createHash('sha256').update(bytes).digest('hex'),
	};
}

/**
 * Runs the build one time, and gives back the files that the run wrote. The
 * metafile is one of those files.
 */
function built(which) {
	clean();
	const result = spawnSync(process.execPath, command, {
		cwd: directory,
		stdio: 'inherit',
	});
	if (result.error !== undefined) {
		stop([
			say(
				`the ${which} run of the build did not start: ${said(result.error)}`,
			),
		]);
	}
	if (result.status !== 0) {
		stop([
			say(
				`the ${which} run of the build ended with the status ${String(result.status)}`,
			),
		]);
	}
	const paths = declared();
	if (paths === undefined) {
		stop([
			say(
				`the ${which} run of the build wrote no metafile at ${metafile}`,
			),
			say('the check reads the metafile to learn which files to compare'),
		]);
	}
	return [METAFILE, ...paths].map(taken);
}

const first = built('first');
const second = built('second');
const comparison = compare(first, second);

for (const line of reportLines(comparison)) {
	console.log(line);
}
const failures = failureLines(comparison);
if (failures.length > 0) {
	stop(failures);
}
