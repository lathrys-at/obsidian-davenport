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
every file that holds the fragment. The coverage configuration sets no
threshold. A low number therefore does not make a run fail.

## Order and seeds

Files run in a random order. The tests inside each file also run in a random
order. A test that passes only on state that a neighbour left behind fails
here.

Every run draws a seed. The run prints the seed under the version line:

```
Running tests with seed "1787087984158"
```

A CI log therefore carries the seed of its run. Give that seed back to replay
the same order:

```bash
npm test -- --sequence.seed=1787087984158
```

One flag stops the shuffle. Vitest then runs the files in sorted order. It
runs the tests of a file in the order in which they stand:

```bash
npm test -- --sequence.shuffle=false
```

Use this fixed order to bisect an ordering failure.

The seed does not cover the inputs of a property test. fast-check draws those
inputs, and fast-check reports a seed of its own.

## Where a test goes

- `test/suites/` — one file or one directory for each suite of
  [`docs/davenport-test-plan.md`](../docs/davenport-test-plan.md).
- `test/harness/` — the shared test infrastructure, and the unit test of each
  piece of it. These unit tests take their names from what they cover.
- `test/` — the tests of the scripts, the tools, and the test pipeline.
- `src/**/*.test.ts` — micro-unit tests of internal helpers. A test that
  asserts a plan ID goes under `test/suites/` instead.
- `test/live/` — the code that runs against real servers.
  [`live/README.md`](live/README.md) states the naming rule that keeps these
  runs out of `npm test`.

Every test title under `test/suites/` carries the plan ID that the test
implements, for example `FM-2: date with start fails and names both keys`.
Write the title as a plain string, because `scripts/plan-ids.mjs` reads no ID
out of a title that a program builds. That check runs with the tests in CI.
The check fails on a title that cites an ID the plan does not hold. The check
also fails on a suite that the plan declares and gives no ID. A new suite
heading in the plan therefore lands together with its first item.

## What the setup file blocks

[`harness/sweeps/setup.ts`](harness/sweeps/setup.ts) runs before every test
file. It replaces the global fetch and the ambient time functions with
functions that throw. A call to fetch outside the transport port therefore
fails where the call stands. A read of the wall clock fails in the same way.
The controlled clock stays the one source of time. A test that must read the
real clock calls `withRealTime` from
[`harness/sweeps`](harness/sweeps/index.ts). That call states its reason.
