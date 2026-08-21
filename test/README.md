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

## Mutation testing

The coverage ratchet counts the lines that a test runs. It does not count the
lines that a test checks. Mutation testing asks the second question. StrykerJS
makes a small change to the source, runs the tests, and asks whether a test
fails. A change that survives every test marks a line that the tests run and
do not check.

```bash
npm run mutation
```

The run takes minutes, and the run writes `reports/mutation/mutation.html` and
`reports/mutation/mutation.json`. A person reads the HTML report.

A person runs this tool by hand to find the gaps in the tests. No workflow
runs the tool, no check reads its report, and no merge waits for a run. The
score of a run has no floor, and no file in the repository records a score.
[`stryker.config.mjs`](../stryker.config.mjs) configures the run. A case in
[`stryker-config.test.ts`](stryker-config.test.ts) loads that file and
compares the selection in it with the files that the coverage instrument
reads.

Read the score with its limit in mind. Stryker holds a set of rules, and each
rule makes one kind of change. A rule of the source can be wrong in a way that
no rule of Stryker writes, and a run then says nothing about that mistake. The
score is therefore a floor under the tests, and it is not a statement that the
tests pin the behavior of a line.

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

The seed does not cover the inputs of a property test. The constant in
`test/harness/arbitraries/seed.ts` fixes those inputs, the variable
`DAVENPORT_PROPERTY_SEED` overrides the constant, and a failure prints the
replay command.

## Property tests

A property test states a rule and then asks a generator for many inputs. The
tests under `test/properties/` hold the round-trip rules of the engine: the
canonical serializer writes its own output again unchanged, a model goes to
text and back whole, the definition of every zone of the table survives the
parse boundary, a note goes through a read and a write and stays the same, and
a record goes through the emitter and the reader and stays the same.

The generators live under [`harness/arbitraries/`](harness/arbitraries/), with
a unit test beside each one. Those unit tests read a sample and ask what the
sample covers. A generator that stopped drawing hard values would make every
rule pass over an empty search, and the unit test beside it turns red instead.

```bash
npm test -- test/properties
```

The seed is a constant of the repository, in
[`harness/arbitraries/seed.ts`](harness/arbitraries/seed.ts). The same commit
therefore draws the same inputs on every machine and on every run, and a
failure in a build log repeats on a desktop. Give another seed to search
wider:

```bash
DAVENPORT_PROPERTY_SEED=17 npm test -- test/properties
```

A failure states the command that draws the same inputs again.

`test/properties/ics/known-defects.test.ts` holds the defects that these tests
and the fuzzing lane found. Every case in that file is skipped, and each one is
the smallest input that reaches the defect.

## The fuzzing lane

A feed subscription points at any location that the user names, so the parse
boundary receives every byte that a generator, a proxy or an attacker sends.
The property tests above drive that boundary with legal calendars. The fuzzing
lane drives it with damaged text as well, and it drives it far longer than a
suite of every commit can afford.

```bash
npm run fuzz                          # 30 seconds at a desk
npm run fuzz -- --budget=600          # the budget of the workflow
npm run fuzz -- --seed=17             # another place in the space
npm run fuzz -- --all-findings        # report the filed defects too
```

The command gives the status 0 when it found nothing new, and the status 1 when
it found something new or when it examined no input. It writes its report and
one file for each new finding into `reports/fuzz`. Git ignores that folder.

The lane has two arms, and each arm knows something different about its input.

- The model arm draws a calendar from the generators of the property tests and
  writes the text of it. The arm knows which calendar the text states, so the
  drive can ask whether the calendar comes back whole. That question is the
  only one that sees a value which the parse loses without a change of the
  bytes. Those generators leave out the shapes that the boundary reads wrongly
  today, and this arm puts one of those shapes back into the calendar that it
  drew.
- The text arm draws a text and changes it. The text comes from the adversarial
  corpus, from a calendar of the model arm, from a feed of ordinary shape, or
  from noise that carries the words of the format. The changes that keep the
  meaning come from the property tests. The changes of the bytes damage the
  text: they remove a run, repeat a run, write a character over a run, cut the
  text short, and take a line ending apart.

The drive sends one input through the boundary, through the canonical
serializer, and back through the boundary.
[`scripts/fuzz-ics-core.ts`](../scripts/fuzz-ics-core.ts) states the rules, and
a breach of one of them is a finding: a call that throws, a refusal that names
no problem, a refusal of a text that the serializer wrote, a canonical text
that moves on the second trip, a canonical text that gives back another
calendar, and a calendar that comes back other than it went in.

### The ledger of the filed defects

The lane rediscovers a filed defect on every run, and a report that buries its
new findings under the known ones is a report that nobody reads.
[`scripts/fuzz-ics-ledger.ts`](../scripts/fuzz-ics-ledger.ts) therefore holds
one entry for each filed defect. A finding that an entry recognises is counted
and set aside; the report names it under its issue, and the run does not fail
on it. Every other finding is new, and the run fails.

A finding matches an entry only when all three conditions hold.

1. **The kind.** The kind of the finding is one of the kinds that the entry
   states. A crash is in no entry: a crash on a line that carries the construct
   of an entry is another defect.
2. **The pattern.** One logical line of the input matches the pattern of the
   entry. The pattern is a cheap first reading and never the proof, so a line
   that carries the construct beside another defect matches it too.
3. **The cause.** The repair that the entry states removes the finding. For a
   finding that reads the calendar which went in, the runner repairs the values
   of that calendar, writes the text again, and drives it. For every other
   finding the runner repairs the lines of the text; there it first drives the
   text that it rebuilt from those lines without a repair, and that text must
   still give the same kind of finding. Without this control, a rebuild that
   removed the finding by itself would look like a repair that worked. The
   repaired text must then be a text that the boundary accepts and that gives
   no finding.

Condition 3 keeps the ledger narrow. A defect that stands beside the construct
of an entry survives the repair, so the run reports it.

### The crash corpus, and how a finding gets there

[`test/harness/fixtures/ics-crash/`](harness/fixtures/ics-crash) holds the
inputs that the lane found and that a person kept. A file stays there after a
change repairs the defect, so a finding of the lane becomes a case that the
required check drives on every commit. `ics-crash-corpus.ts` beside it holds the index.

Turn a finding into a fixture in four steps.

1. Run the command with the seed file of the finding:

    ```bash
    node scripts/fuzz-ics.mjs \
        --graduate=reports/fuzz/finding-01-crash.ics \
        --name=a-name-for-the-fixture
    ```

    The command copies the file into the corpus, drives it, and says which
    finding it gives today. The command writes no other file, and it refuses a
    name that the corpus already holds.

2. Add the entry to the index in
   [`harness/fixtures/ics-crash-corpus.ts`](harness/fixtures/ics-crash-corpus.ts).
   The entry states the id, one sentence that says what the input holds and
   what the engine does with it, and the state. The state `held` says that the
   engine keeps the rule today, and the test then asks for no finding. The
   state `open` says that the defect waits for a decision, and the entry names
   the kind of finding that the file still gives.

3. Add the case that states the rule to
   [`../test/properties/ics/known-defects.test.ts`](properties/ics/known-defects.test.ts),
   and skip that case while the defect waits.

4. When somebody files the issue, put the number of it in the entry of the
   index, and add an entry to the ledger so that the lane stops reporting the
   finding as new.

### The workflow

[`.github/workflows/fuzz.yml`](../.github/workflows/fuzz.yml) runs the lane.
The workflow has the `workflow_dispatch` trigger alone, and it carries no
schedule: the owner starts a run at a point that suits the work. The lane is
not part of the required `ci-ok` check, and no merge waits for it. A run takes
minutes, and a run draws inputs that no earlier run drew, so the lane can turn
red on a commit that changed nothing.

The dispatch takes a budget in seconds, and the default is 600. One run of that
budget on a desktop examined about five thousand inputs a second, so ten
minutes buys about three million inputs. A runner is slower than a desktop. The
run also stops early when it collects twenty new findings, because one defect
answers to many inputs.

The workflow keeps the report and the seed files as an artifact of each run,
and it keeps them after a run that failed as well. A run that failed is the run
whose findings a person reads, and the seed file is the material of a fixture.

## Where a test goes

- `test/suites/` — one file or one directory for each suite of
  [`docs/davenport-test-plan.md`](../docs/davenport-test-plan.md).
- `test/properties/` — one directory for each surface that a property test
  covers. A test here implements no plan ID, so its title takes no ID.
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
