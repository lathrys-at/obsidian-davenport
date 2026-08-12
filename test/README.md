# Tests

Layout:

- `test/harness/` — the shared test infrastructure: the Obsidian API fake
  and controlled clock, the mock CalDAV server, the vault-sync simulator,
  the feed fixture, the adversarial ICS corpus, and the invariant-sweep
  framework. Each piece lands with its own issue. The harness is
  load-bearing for every suite, so each piece carries its own unit tests
  beside it, named for what they cover rather than for a plan ID. Fixture
  corpora live under `test/harness/fixtures/` as data files, each with a
  typed loader beside its data.
- `test/suites/` — the test-plan suites, one file (or directory) per suite
  ID from `docs/davenport-test-plan.md`. Every test title carries the plan
  ID of the assertion it implements, e.g. `FM-2: date alongside start
  fails naming both keys`. The coverage map in the plan references these
  IDs, so titles are the traceability surface — keep them exact.
- Colocated `src/**/*.test.ts` micro-unit tests are allowed for internal
  helpers; anything asserting a plan ID lives under `test/suites/`.
- `test/fetch-guards.test.ts` — the static halves of the network-discipline
  ban: the lint selectors, read out of the lint configuration itself, and
  `scripts/scan-bundle.mjs`, run as a process over a bundle it is handed.
  The runtime half is the fetch poison, tested with the sweeps.
- `test/probe-compare.test.ts` and `test/probe-hash.test.ts` — the pure
  halves of the frontmatter probe under `tools/a11-probe/`: the comparison
  over results files, and the digest the probe carries so that it hashes
  the same way on every device. The plugin half of the probe runs in a real
  vault and is exercised by hand; `tools/a11-probe/README.md` says how.
- `test/live/` — what verification runs against real servers need: the
  credential resolver, and the self-hosted CalDAV containers. Nothing here
  reaches a server during `npm test`; `test/live/README.md` states the
  naming rule that keeps it that way.

The `harness/` and `suites/` directories are created by the issues that
populate them; git carries no empty directories.

`test/harness/fixtures/ics/` holds the ICS corpus: hand-authored iCalendar
files, stored as the octets a server would send and read back byte for
byte, which `.gitattributes` keeps git from converting. `ics-corpus.ts`
indexes them by the adversarial property each one carries.

`test/harness/feed-fixture/` is the ICS feed server behind the transport
port. A feed is a script — poll N serves the variant declared for it — and
the fixture takes its reference time from the caller, so identical scripts
serve identical octets.

`test/harness/ics-octets.ts` holds the octet limit and the UTF-8 encoding:
the feed fixture's `ics-text.ts` folds against them, the mock server folds
and measures with them, and the suites measure stored bytes with them.
`ics-lines.ts` reads folded text back and needs no octet arithmetic of its
own. It takes any line ending, since a client sends what it likes, and
offers both a reader that throws on text no legal writer produces and one
that reports the problem and reads on — the mock takes the second, because
a malformed request body is something it answers rather than something
that fails the run.

`test/harness/caldav-mock/` is the in-process CalDAV server. It implements
the transport port, so a run wires it where the Obsidian adapter goes and
issues no network call at all. A test states the server it wants through
the capability switchboard, then asserts against the ordered request log
and the scheduling record — the ledger of writes that would have mailed
attendees.

`test/harness/sweeps/` holds the standing assertions and the helper a
simulation is built through. `runSimulation` gathers what the run's surfaces
recorded, evaluates every registered sweep over the result, and fails the
test with the sweep's name and the evidence it objected to. Sweeps are named
predicates over that evidence; the standing set is in `standing.ts` and grows
with the behavior it polices, and a suite may register its own. `setup.ts` is
wired into `vitest.config.ts` and applies to every test file: it poisons
global fetch, so a call outside the transport port throws where it is
written, and returns the registry to the standing set before each test.

Files run in a random order, and so do the tests inside each file. A test
that passes only on state a neighbour left behind fails here, rather than on
the day some unrelated change reorders the suite. Every run draws a seed and
prints it in the banner under the version line, `Running tests with seed
"1786557325096"`, so a CI log carries the order its run used. Hand that seed
back to replay the order exactly:
`npm test -- --sequence.seed=1786557325096`. To step out of shuffling
altogether, `npm test -- --sequence.shuffle=false` runs the files in sorted
order and the tests in the order they are written, which is the fixed order
to bisect an ordering failure against.

`test/harness/sequencer.ts` is what makes the seed a replay rather than a
suggestion. Vitest hands the sequencer its files in the order the directory
crawl returned them, which is not the same twice, so shuffling that directly
would give the same seed a different order each run; the sequencer sorts the
files first and shuffles the sorted list, and hands back the sorted list
unshuffled when shuffling is off. Test order within a file is
Vitest's own shuffle over declaration order and takes the same seed.
Property-test inputs are not covered by it: fast-check draws and reports a
seed of its own.

Commands: `npm test` (single run), `npm run test:watch`, `npm run coverage`.
Coverage is report-only for now.
