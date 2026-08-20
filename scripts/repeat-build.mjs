/**
 * A release attaches `main.js` to a tag, and nothing confirmed that a second
 * build of the same source writes that same file. This check confirms it. A
 * person can then build the source and compare the result against the file
 * that the release carries.
 *
 * The check runs the build two times. Before each run, the check removes the
 * metafile, the output files that the build of this repository writes, and
 * every file that a metafile on disk names. Before the second run it removes
 * exactly what the first run wrote, so no file of the first run reaches the
 * second run. After each run, the check reads the metafile and every file
 * that the metafile names.
 *
 * The check then compares the two sets of files byte by byte. Three things
 * fail the check:
 *
 * - a file whose bytes are not the same in the two runs. The failure names
 *   the file, gives the place of the first byte that differs, gives the size
 *   of each of the two files, and prints the bytes of each run around that
 *   place;
 * - a file that only one of the two runs wrote;
 * - a build that declares no output file, or that writes only empty output
 *   files. Both leave the check with nothing to compare.
 *
 * The check compares the metafile too. The metafile names each input file and
 * each output file of the build, and it gives the size of each one. esbuild
 * writes those names relative to the directory that the build ran in, so the
 * metafile holds no absolute path. Two runs in one directory must therefore
 * write the same metafile. `scripts/bundle-size.mjs` reads the metafile, and
 * a metafile that changes between two runs makes the report of that check
 * change too.
 *
 * The check removes files, so it holds every path that it removes or reads
 * inside the build directory. A path that leaves that directory ends the run.
 * The metafile is an untracked file that stands on disk before any build of
 * this check runs, and a path in it therefore gets the same distrust as any
 * other input.
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
 * leaves it. Do not run the check while a watch build runs, because the two
 * write the same files.
 *
 * This file runs the builds, reads the files, prints the report, and sets the
 * exit status. `repeat-build-core.ts` holds the decisions behind the
 * comparison. `repeat-build-text.ts` holds the wording that the check prints.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, outputPaths } from './repeat-build-core.ts';
import { failureLines, reportLines, say } from './repeat-build-text.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const METAFILE = 'bundle-meta.json';

/** The build that the check runs when the command line names no other one. */
const BUILD = ['esbuild.config.mjs', 'production'];

/**
 * The output files that the build of this repository writes. The check
 * removes these before each run, and it removes them whether or not a
 * metafile names them. A watch build writes `main.js` and writes no metafile,
 * so the metafile alone does not find every file that an earlier build left.
 */
const OUTPUTS = ['main.js'];

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
 * The full path of one file of the build. The path must stay inside the
 * build directory. A path that leaves that directory ends the run, because
 * this check removes the files that it names.
 */
function inside(path) {
	const file = resolve(directory, path);
	const step = relative(directory, file);
	if (step === '' || step === '..' || step.startsWith(`..${sep}`)) {
		stop([
			say(`the path ${path} leaves the build directory at ${directory}`),
			say('the check reads and removes files inside that directory only'),
		]);
	}
	if (isAbsolute(step)) {
		stop([
			say(`the path ${path} is on another volume than ${directory}`),
			say('the check reads and removes files inside that directory only'),
		]);
	}
	return file;
}

/**
 * The files that the metafile names, or nothing when the metafile is absent.
 *
 * The clean before a build reads the metafile to learn what an earlier build
 * left behind, and it tolerates a metafile that it cannot read: that file is
 * one of the files that the clean removes. The read after a build does not
 * tolerate it, because there the metafile is what the build just wrote.
 */
function declared(tolerant) {
	let text;
	try {
		text = readFileSync(metafile, 'utf8');
	} catch {
		return undefined;
	}
	const reading = outputPaths(text);
	if (!reading.ok) {
		if (tolerant) {
			return undefined;
		}
		stop([say(`the metafile at ${metafile} ${reading.reason}`)]);
	}
	return reading.value;
}

/** Removes one file of the build, and makes sure that the file is gone. */
function remove(path) {
	const file = inside(path);
	try {
		rmSync(file, { force: true });
	} catch (error) {
		stop([
			say(`the check cannot remove the file at ${file}: ${said(error)}`),
			say(
				'the check removes the files of a build before it builds again',
			),
		]);
	}
	if (existsSync(file)) {
		stop([
			say(`the check removed the file at ${file}, and the file is there`),
			say('the check cannot give the build a directory that it knows'),
		]);
	}
}

/**
 * Removes the metafile and the output files of an earlier build. The next run
 * of the build then starts with those files absent.
 */
function clean() {
	for (const path of new Set([...OUTPUTS, ...(declared(true) ?? [])])) {
		remove(path);
	}
	remove(METAFILE);
}

/** One file of a build, with its bytes and the digest of those bytes. */
function taken(path) {
	const file = inside(path);
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
	if (result.signal !== null && result.signal !== undefined) {
		stop([
			say(
				`the ${which} run of the build stopped on the signal ${result.signal}`,
			),
			say('the build wrote no result that the check can compare'),
		]);
	}
	if (result.status !== 0) {
		stop([
			say(
				`the ${which} run of the build ended with the status ${String(result.status)}`,
			),
		]);
	}
	const paths = declared(false);
	if (paths === undefined) {
		stop([
			say(
				`the ${which} run of the build wrote no metafile at ${metafile}`,
			),
			say('the check reads the metafile to learn which files to compare'),
		]);
	}
	const artifacts = [METAFILE, ...paths].map(taken);
	if (artifacts.slice(1).every((artifact) => artifact.bytes.length === 0)) {
		stop([
			say(`the ${which} run of the build wrote no byte`),
			say(
				'every output file that the metafile names is empty, so the check would compare nothing that the build makes',
			),
		]);
	}
	return artifacts;
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
