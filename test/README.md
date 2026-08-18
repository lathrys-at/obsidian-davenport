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

Write each title as a plain string. The check reads no ID out of a title that
a program builds, and the check still passes. The plan ID then joins the IDs
that no title cites, and that list does not fail the check.

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
`withRealTime` from
[`harness/sweeps/index.ts`](harness/sweeps/index.ts). That call states its
reason.
