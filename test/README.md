# Tests

The tests run under Vitest.

## Run the tests

```bash
npm test                                  # every test, one run
npm test -- test/harness/clock.test.ts    # one file
npm run test:watch                        # watch mode
npm run coverage                          # every test, with a coverage report
```

The argument after `--` filters the file paths. A fragment of a path selects
every file that contains the fragment.

## The coverage ratchet

The coverage run writes `coverage/coverage-summary.json`.
[`scripts/coverage-ratchet.mjs`](../scripts/coverage-ratchet.mjs) reads that
file and compares each source file against the floor that
[`coverage-baseline.json`](../coverage-baseline.json) holds for that file. CI
runs the check after the coverage run:

```bash
npm run coverage
node scripts/coverage-ratchet.mjs
```

The baseline holds a floor for each file, and not one floor for the whole
repository. The check reports the numbers of the whole run, and it never fails
on those numbers.

Three things fail the check:

- one metric of one file falls more than two percentage points below its
  floor;
- the baseline holds a file, and the run does not report that file;
- the run reports a file, and the baseline holds no floor for that file.

A change that adds a file, moves a file, or deletes a file therefore writes
the baseline in that same change.

The check never writes the baseline by itself. Accept an intended change in
the pull request that causes it: run
`node scripts/coverage-ratchet.mjs --write-baseline` and commit the new file.

## The mutation lane

The coverage ratchet counts the lines that a test runs. It does not count the
lines that a test checks. The mutation lane asks the second question.
StrykerJS makes a small change to the source, runs the tests, and asks whether
a test fails. A change that survives every test marks a line that the tests
run and do not check.

```bash
npm run mutation
node scripts/mutation-ratchet.mjs
```

The run takes minutes, and the run writes `reports/mutation/mutation.html` for
a person and `reports/mutation/mutation.json` for the check. A workflow runs
the lane once a week and on request. The lane is not part of the required
`ci-ok` check, and no merge waits for it.

[`mutation-baseline.json`](../mutation-baseline.json) holds one number, and
that number is the score of the whole run. A score less than that floor fails
the check, even by one hundredth of a point. The check never writes the
baseline by itself. Accept an intended change in the pull request that causes
it: run `node scripts/mutation-ratchet.mjs --write-baseline` and commit the
new file.

The check also fails on a run that measured too little to score. The score
divides by the mutants that it counts, and a mutant that the run could not
test leaves that division. A run that tests less would therefore score more.
The check refuses a report that holds a mutant with a compile error or a
runtime error, and it refuses a report whose mutants the score counts none of.

Read the score with its limit in mind. Stryker holds a set of rules, and each
rule makes one kind of change. A rule of the source can be wrong in a way that
no rule of Stryker writes, and the lane then says nothing about that mistake.
The score is therefore a floor under the tests, and it is not a statement that
the tests pin the behavior of a line.

A mutant that survives is work, and not a broken build. A mutant that shows a
gap in the tests becomes an issue. A mutant that no test can kill gets a
Stryker disable comment at the line, with one sentence that states why.

## The stage-and-claim lane

Part 8 of the test plan gives each test ID to a stage. The issue tree gives
each test ID to a milestone: one line of the issue body states which IDs the
issue delivers, and the milestone of the issue states the stage.
[`scripts/stage-claims.mjs`](../scripts/stage-claims.mjs) compares the two.

```bash
node scripts/stage-claims.mjs
```

Write the claim of an issue as a list item of the body:

```markdown
- Test plan: FM-1..4, UI-16 (read subset)
```

The line takes four forms of an ID list, and a stage list of Part 8 takes the
same four: one ID (`DL-3`), a range (`ID-1..ID-6`), a group behind one prefix
(`UI-1/2/8`), and a suite tag that stands for the whole suite (`LG`, or
`CD complete`, with `except` to take IDs back out). One reader reads an entry,
and a claim line and a stage list both go through it. A comma and a semicolon
each end an entry, so one line can hold more than one entry.

A suite tag counts where the tag opens an entry. A tag inside a phrase names a
thing, and the check reports each tag that it passed over in that way. Each of
those reports also states the test IDs that the other reading gives the stage,
so the output of one run is enough to audit the rule.

A suite tag that opens an entry of Part 8 takes no bold, no link, and no
backticks. The tag `**BB**` at the front of an entry reads as a tag inside the
entry, and the stage then loses that suite.

The check reads no stage list and no claim line inside a fenced block. An issue
body that shows the example above therefore makes no claim, and a fenced stage
list in the plan declares no stage. A body that carries more than one claim
line gives the check the first line, and the check names that issue in the
report.

Two things fail the check:

- the plan gives a test ID to no stage;
- an issue claims an ID that no stage holds.

The check reports, and does not fail on, each disagreement between a stage
list and a milestone. Staging moves as the work proceeds. The check also fails
when the plan or the issue tree gives it nothing to compare: a plan with no
stage list, a stage with no test ID, a plan that declares one stage two times,
a set of issues with no issue, a set of issues in which no body carries a claim
line, and an answer of the command that carries no body for an issue.

Some disagreements are correct as they stand. A person adjudicates such a
mention, and `ADJUDICATED` in
[`scripts/stage-claims-core.ts`](../scripts/stage-claims-core.ts) holds it with
one sentence that says why. The check names each of these in the report, and
it names an entry that meets no disagreement any more.

The check reads the plan from a file and the issues from GitHub, through the
`gh` command line tool. A machine that cannot reach GitHub runs the first half
alone, and the check says which half it ran. The option `--require-issues`
makes a run that cannot read the issues a failure. The option
`--issues=<file>` reads the issues from a file that holds the answer of the
command, and the tests of the check use that option to reach no server. The
option `--save-issues=<file>` writes the answer that the run read to a file.

A workflow runs the check once a week and on request. The lane is not part of
the required `ci-ok` check, and no merge waits for it. The issue bodies and the
milestones change when nobody changes the tree, so a check of that state on
every commit would turn red on a commit that changed nothing. For the same
reason the lane keeps the answer of the command as an artifact of each run,
which includes each run that failed.

## Order and seeds

Files run in a random order. The tests inside each file also run in a random
order. A test that passes only on state that a neighbour left behind fails
here.

Every run draws a seed. The run prints the seed under the version line:

```
Running tests with seed "1787087984158"
```

A CI log therefore carries the seed of its run. Give that seed back to replay
the same order. Add `--no-file-parallelism`, because the printed order is the
run order only when the files run one after another:

```bash
npm test -- --sequence.seed=1787087984158 --no-file-parallelism
```

The order of the tests inside one file replays under the seed alone.

One flag stops the shuffle. Vitest then runs the files in sorted order. It
runs the tests of a file in the order in which they are written:

```bash
npm test -- --sequence.shuffle=false
```

Use this fixed order to bisect an ordering failure.

The seed does not cover the inputs of a property test. fast-check draws those
inputs, and fast-check reports a seed of its own.

## Where a test goes

- `test/suites/` — one file or one directory for each suite of
  [`docs/davenport-test-plan.md`](../docs/davenport-test-plan.md).
- `test/harness/` — the shared test infrastructure, with a unit test beside
  each piece of it. Name each of these unit tests after the behavior that it
  covers, and not after a plan ID.
- `test/` — the tests of the scripts, the tools, and the test pipeline.
- `src/**/*.test.ts` — micro-unit tests of internal helpers. A test that
  asserts a plan ID goes under `test/suites/` instead.
- `test/live/` — the code that runs against real servers.
  [`live/README.md`](live/README.md) states the naming rule that keeps a live
  run out of `npm test`.

Every test title under `test/suites/` carries the plan ID that the test
implements, for example `FM-2: date with start fails and names both keys`.
`scripts/plan-ids.mjs` compares the titles with the plan, and that check runs
with the tests in CI. The check fails on a title that cites an ID that the
plan does not contain. The check also fails when the plan declares a suite and
defines no ID for that suite. A new suite heading in the plan therefore lands
together with the first ID of that suite.

Write each title as a plain string. The check reads a plain string, and the
check reads no other shape of title. The check fails on each title that it
cannot read. A title that a program joins from parts is one example. A
template with an expression in it is another example. The check names the
file, the line, and the text that stands in the title.

For the citations, the check reads every file under `test/suites/` whose name
ends in `.test.ts`, at any depth. It reads no other file for the citations.
The rule of the plain string therefore holds for those files, and for no other
file. A test elsewhere under `test/` takes its name from what the test covers,
and the check never reads that name.

## What the setup file blocks

[`harness/sweeps/setup.ts`](harness/sweeps/setup.ts) runs before every test
file. It replaces the global fetch and the ambient time functions with
functions that throw. A call to fetch outside the
[transport port](../src/core/ports/transport.ts) therefore fails where the
call is written.

The poisoned time functions are `Date.now`, the `Date` constructor with no
argument, and the timers `setTimeout`, `setInterval` and `setImmediate`.
`new Date(value)` keeps working, because there the caller supplies the time.
`performance.now` also keeps working. A test reads the time from the
[clock port](../src/core/ports/clock.ts), and the controlled clock of the
harness answers that port. A test that must read the real clock calls
`withRealTime` from [`harness/sweeps/index.ts`](harness/sweeps/index.ts).
That call states its reason.
