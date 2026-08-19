/**
 * The release carries `main.js`, and nothing else measured that file. This
 * check measures it. The check reports four things: the raw size, the
 * compressed size, the size of each output file, and the modules that hold
 * the most bytes. A module under node_modules counts against the package
 * that holds it. Therefore the report says what each dependency costs.
 *
 * The check does not count a source map, because a release carries no source
 * map. The report names each source map that the build makes. The report
 * also gives the count of bytes that no total holds. A source map fails no
 * rule.
 *
 * The check compares the sizes against `bundle-baseline.json`. Two things
 * fail the check:
 *
 * - the raw size or the compressed size grows past the baseline by more
 *   than a generous step. The failure then names the modules that grew;
 * - the baseline holds an output file that the build no longer makes. A
 *   payload that stops loading lazily moves into another output file, and
 *   the totals do not show that move.
 *
 * The check is an instrument for attribution, and it is not a budget. A
 * build that is smaller than the baseline is a report, and never a failure.
 * A move of bytes between the output files that the build keeps is a report
 * too. The baseline moves only when a person writes the new numbers into it.
 *
 * The production build writes the metafile that this check reads. Run
 * `npm run build` first. The check fails when the metafile is absent. The
 * check also fails when the baseline is absent, and it never writes a
 * baseline by itself.
 *
 *     node scripts/bundle-size.mjs
 *     node scripts/bundle-size.mjs <metafile> <baseline>
 *     node scripts/bundle-size.mjs --write-baseline
 *
 * This file finds the files, measures them, prints the report, and sets the
 * exit status. `bundle-size-core.ts` holds the decisions behind the numbers.
 * `bundle-size-text.ts` holds the wording that the check prints.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants, gzipSync } from 'node:zlib';
import {
	compare,
	measure,
	readBaseline,
	readMetafile,
} from './bundle-size-core.ts';
import { failureLines, reportLines, say } from './bundle-size-text.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const METAFILE = 'bundle-meta.json';
const BASELINE = 'bundle-baseline.json';

/**
 * The compression that the report measures. The level is the strongest one,
 * so that the number is the smallest that gzip reaches. The number comes
 * from the zlib library that Node carries. Therefore the number can move by
 * a few bytes when the version of Node changes.
 */
const LEVEL = constants.Z_BEST_COMPRESSION;

/** The reason that an error carries. */
function said(error) {
	return error instanceof Error ? error.message : String(error);
}

/** The text of a file, or the end of the run. */
function text(path, what, hint) {
	try {
		return readFileSync(path, 'utf8');
	} catch (error) {
		stop([
			say(`the check cannot read the ${what} at ${path}: ${said(error)}`),
			say(hint),
		]);
	}
}

/** Says these lines and ends the run with a failure. */
function stop(lines) {
	for (const line of lines) {
		console.error(line);
	}
	process.exit(1);
}

/** The value of a reading, or the end of the run. */
function taken(reading) {
	if (!reading.ok) {
		stop([say(reading.reason)]);
	}
	return reading.value;
}

const argv = process.argv.slice(2);
const write = argv.includes('--write-baseline');
const given = argv.filter((argument) => argument !== '--write-baseline');
const metafilePath = given[0] ?? join(ROOT, METAFILE);
const baselinePath = given[1] ?? join(ROOT, BASELINE);

const metafile = taken(
	readMetafile(
		text(
			metafilePath,
			'metafile',
			'the production build writes the metafile. Run `npm run build`.',
		),
	),
);

// The metafile names each output file relative to the directory that holds
// the metafile, because the build writes both at the top of the repository.
const measurements = metafile.outputs.map((output) => {
	const file = resolve(dirname(metafilePath), output.path);
	let bytes;
	try {
		bytes = readFileSync(file);
	} catch (error) {
		stop([
			say(
				`the check cannot read the output file at ${file}: ${said(error)}`,
			),
			say('the metafile and the built files do not agree. Build again.'),
		]);
	}
	return {
		path: output.path,
		raw: bytes.length,
		compressed: gzipSync(bytes, { level: LEVEL }).length,
	};
});

const report = taken(measure(metafile, measurements));

if (write) {
	writeFileSync(baselinePath, `${JSON.stringify(report, undefined, '\t')}\n`);
	console.log(say(`the check wrote the baseline at ${baselinePath}`));
	console.log(
		say(
			'read the difference before you commit the file. The baseline is the record of the build that the repository ships.',
		),
	);
	process.exit(0);
}

const baseline = taken(
	readBaseline(
		text(
			baselinePath,
			'baseline',
			'the baseline is a committed file, and this check never writes it by itself. The command `node scripts/bundle-size.mjs --write-baseline` writes it.',
		),
	),
);

const comparison = compare(report, baseline);
for (const line of reportLines(report, comparison, metafile.skipped)) {
	console.log(line);
}
const failures = failureLines(comparison);
if (failures.length > 0) {
	stop(failures);
}
