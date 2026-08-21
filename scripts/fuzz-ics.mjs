/**
 * The fuzzing lane of the iCalendar parse boundary.
 *
 * A feed subscription points at any location that the user names, so the
 * parse boundary receives every byte that a generator, a proxy or an
 * attacker sends. The tests of every commit drive that boundary with the
 * shapes that a person thought of. This command drives it with shapes that
 * nobody thought of: calendars from the generators of the property tests,
 * with the shapes put back that those generators leave out, and texts whose
 * bytes a chain of changes damaged.
 *
 * The command drives each input through the boundary, through the canonical
 * serializer, and back through the boundary. `fuzz-ics-core.ts` states what
 * counts as a finding. `fuzz-ics-inputs.ts` states where the inputs come
 * from. `fuzz-ics-ledger.ts` holds the defects that are already filed and
 * the rule that recognises one. `fuzz-ics-campaign.ts` runs the passes.
 * `fuzz-ics-text.ts` holds the wording of the report.
 *
 * The run writes a report and one file for each new finding. A run that
 * found nothing new gives the status 0. A run that found something new
 * gives the status 1, and so does a run that examined no input. A command
 * that cannot run gives the status 2.
 *
 *     npm run fuzz
 *     npm run fuzz -- --budget=600 --seed=17
 *     node scripts/fuzz-ics.mjs --all-findings
 *     node scripts/fuzz-ics.mjs --graduate=reports/fuzz/finding-01-crash.ics --name=a-name
 *
 * The lane runs no part of the required check. It takes minutes, and it
 * draws inputs that no earlier run drew, so a merge must not wait for it.
 */
import { Buffer } from 'node:buffer';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFuzzLane } from './fuzz-ics-load.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CRASH_CORPUS = join(ROOT, 'test/harness/fixtures/ics-crash');

/** The budget of a run at a desk, in seconds. */
const DESK_BUDGET_SECONDS = 30;
/** How many inputs one pass draws. */
const RUNS_PER_PASS = 400;
/** How many passes one run may make. */
const PASS_LIMIT = 10_000;
/** How many new findings one run collects. */
const FINDING_LIMIT = 20;

const USAGE = [
	'usage: node scripts/fuzz-ics.mjs [options]',
	'  --budget=<seconds>   how long the run may take. The default is 30.',
	'  --seed=<number>      the seed of the first pass.',
	'  --runs=<number>      how many inputs one pass draws.',
	'  --findings=<number>  how many new findings the run collects.',
	'  --out=<directory>    where the run writes its report and its seeds.',
	'  --all-findings       report the filed defects as well.',
	'  --graduate=<file>    put one seed file into the crash corpus.',
	'  --name=<id>          the name of the fixture that --graduate writes.',
];

function fail(message) {
	console.error(`ics fuzz: ${message}`);
	for (const line of USAGE) {
		console.error(line);
	}
	process.exit(2);
}

/** The whole number that the argument states. */
function number(name, text) {
	const value = Number(text);
	if (!Number.isSafeInteger(value) || value < 0) {
		fail(
			`${name} must state a whole number that is not negative, and it states ${JSON.stringify(text)}`,
		);
	}
	return value;
}

const options = {
	budget: DESK_BUDGET_SECONDS,
	seed: undefined,
	runs: RUNS_PER_PASS,
	findings: FINDING_LIMIT,
	out: join(ROOT, 'reports/fuzz'),
	ledger: true,
	graduate: undefined,
	name: undefined,
};
for (const argument of process.argv.slice(2)) {
	const [flag, ...rest] = argument.split('=');
	const value = rest.join('=');
	switch (flag) {
		case '--budget':
			options.budget = number('--budget', value);
			break;
		case '--seed':
			options.seed = number('--seed', value);
			break;
		case '--runs':
			options.runs = number('--runs', value);
			break;
		case '--findings':
			options.findings = number('--findings', value);
			break;
		case '--out':
			options.out = resolve(ROOT, value);
			break;
		case '--all-findings':
			options.ledger = false;
			break;
		case '--graduate':
			options.graduate = resolve(ROOT, value);
			break;
		case '--name':
			options.name = value;
			break;
		default:
			fail(
				`the option ${JSON.stringify(argument)} is not an option of this command`,
			);
	}
}

const lane = await loadFuzzLane();

if (options.graduate !== undefined) {
	graduate(options.graduate, options.name);
} else {
	run();
}

/**
 * Runs one campaign, writes what it found, and sets the status of the
 * command.
 */
function run() {
	if (options.runs === 0) {
		fail('--runs must state a count that is more than nothing');
	}
	const report = lane.campaign.runCampaign({
		engine: lane.engine,
		seed: options.seed ?? lane.defaultSeed,
		budgetMs: options.budget * 1000,
		runsPerPass: options.runs,
		passLimit: PASS_LIMIT,
		findingLimit: options.findings,
		now: () => performance.now(),
		...(options.ledger ? {} : { ledger: [] }),
	});
	const lines = [...lane.text.reportLines(report)];
	for (const line of lines) {
		console.log(line);
	}
	const failures = lane.text.failureLines(report);
	write(report, [...lines, ...failures]);
	for (const line of failures) {
		console.error(line);
	}
	process.exit(lane.campaign.runFails(report) ? 1 : 0);
}

/** Writes the report of a run, and one file for each new finding. */
function write(report, lines) {
	mkdirSync(options.out, { recursive: true });
	writeFileSync(
		join(options.out, 'report.json'),
		`${JSON.stringify(report, null, '\t')}\n`,
	);
	writeFileSync(join(options.out, 'report.txt'), `${lines.join('\n')}\n`);
	for (const [at, finding] of report.findings.entries()) {
		const name = lane.text.seedFileName(at + 1, finding);
		writeFileSync(join(options.out, name), finding.minimized);
		writeFileSync(join(options.out, `${name}.as-drawn`), finding.input);
	}
	console.log(`ics fuzz: the run wrote its report to ${options.out}`);
}

/**
 * Puts one seed file into the crash corpus, and says what stays to be
 * done. The command writes the file and no other file: a person writes the
 * entry of the index and the case that states the rule.
 */
function graduate(path, name) {
	if (name === undefined || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
		fail(
			'--graduate needs --name, and the name takes lower case letters, digits and single dashes',
		);
	}
	if (!existsSync(path)) {
		fail(`the command cannot read ${path}: no file stands there`);
	}
	const text = readFileSync(path, 'utf8');
	// The corpus holds files, and a file holds octets. A text that UTF-8
	// cannot carry loses the code unit that it cannot carry, and the fixture
	// would then hold another input than the finding. A lone surrogate is
	// such a code unit.
	if (Buffer.from(text, 'utf8').toString('utf8') !== text) {
		fail(
			`the input holds a code unit that UTF-8 cannot carry, so a file cannot hold it. Read ${path} and write a fixture by hand.`,
		);
	}
	const target = join(CRASH_CORPUS, `${name}.ics`);
	if (existsSync(target)) {
		fail(
			`the crash corpus already holds ${basename(target)}; choose another name`,
		);
	}
	const found = lane.core.driveInput(lane.engine, { text, promise: 'any' });
	mkdirSync(CRASH_CORPUS, { recursive: true });
	writeFileSync(target, text);
	for (const line of lane.text.graduationLines(
		name,
		target,
		found === null ? null : found.kind,
	)) {
		console.log(line);
	}
}
