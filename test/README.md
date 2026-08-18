# Tests

Layout:

- `test/harness/` — the shared test infrastructure. It holds the Obsidian
  API fake and controlled clock, the mock CalDAV server, and the vault-sync
  simulator. It also holds the feed fixture, the adversarial ICS corpus, and
  the invariant-sweep framework. Each piece arrives in its own issue. Every
  suite depends on the harness. Therefore each piece carries its own unit
  tests beside it. These unit tests take their names from what they cover,
  and not from a plan ID. The fixture corpora are data files under
  `test/harness/fixtures/`. Each corpus has a typed loader beside its data.
- `test/suites/` — the test-plan suites. This directory holds one file or
  one directory for each suite ID from `docs/davenport-test-plan.md`. Every
  test title carries the plan ID of the assertion that the test implements,
  for example `FM-2: date alongside start fails naming both keys`. The
  coverage map in the plan refers to these IDs. The titles are therefore the
  traceability surface. Keep the titles exact. `scripts/plan-ids.mjs`
  compares the titles with the plan. That check fails on a title that cites
  an ID that the plan does not contain, and it runs with the tests in CI.
  Write each title as a plain string, because the check reads no ID out of a
  title that a program builds.
- Colocated `src/**/*.test.ts` micro-unit tests are allowed for internal
  helpers. Anything that asserts a plan ID lives under `test/suites/`.
- `test/fetch-guards.test.ts` — the static halves of the network-discipline
  ban. One static half is the lint selectors, and they are read out of the
  lint configuration itself. The other static half is
  `scripts/scan-bundle.mjs`. It runs as a process over a bundle that it is
  handed. The runtime half is the fetch poison. Its tests run with the
sweeps.
- `test/probe-compare.test.ts`, `test/probe-hash.test.ts` and
  `test/probe-results.test.ts` — the pure halves of the frontmatter probe
  under `tools/a11-probe/`. One pure half is the comparison over results
  files. Another pure half is the digest that the probe carries. The probe
  carries this digest so that the probe hashes the same way on every device.
  Another pure half is the naming and the wording that its results module
  decides. The rest of the probe runs in a real vault, and it is exercised
  by hand. `tools/a11-probe/README.md` says how to do this.
- `test/vault-provisioning.test.ts` — the decisions behind
  `scripts/vault.mjs`. That script makes a scratch vault with the probe
  installed. One decision is the names that the script accepts and the names
  that it draws. Another decision is the verdict that it reaches on a probe
  already in a vault. Another decision is what it makes of a vault that it
  has walked. Another decision is the wording that it prints. The help text
  and a refused name are run as a process, because the exit status is part
  of the interface. The copying is thin, but the copying is the whole of
  what the script could destroy. Therefore a few cases run the real script
  against real vaults under `.vaults/`. These cases assert that nothing that
  the owner put there was rewritten. These cases take their vaults down
  afterwards.
- `test/plan-id-traceability.test.ts` — the decisions behind
  `scripts/plan-ids.mjs`:
    - which IDs the check reads out of the plan;
    - what the check does with a plan that gives it no vocabulary;
    - which words in a title cite an ID, and which words only look like one;
    - which titles a suite file declares;
    - what the comparison of the two sets says, and the wording that the check
      prints around it.

  The exit status is part of the interface. Therefore several cases run the
  real script as a process.
- `test/live/` — what verification runs against real servers need. This
  directory holds the credential resolver and the self-hosted CalDAV
  containers. Nothing here reaches a server during `npm test`.
  `test/live/README.md` states the naming rule that keeps it that way.

The issues that populate the `harness/` and `suites/` directories create
them. Git carries no empty directories.

`test/harness/fixtures/ics/` holds the ICS corpus. The corpus contains
hand-authored iCalendar files. These files are stored as the octets that a
server would send, and they are read back byte for byte. Git does not convert
these files, because `.gitattributes` prevents the conversion. `ics-corpus.ts`
indexes the files by the adversarial property that each file carries.

`test/harness/obsidian-fake/` is the vault behind the vault port. The
constructor of `FakeVault` receives a filesystem profile as its second
argument. The default profile is permissive. A permissive vault accepts
every name, and it tells every name apart. `filesystem-profile.ts` holds
three other profiles. Each one models one hostile behavior of a real disk:

- two names that differ only in case land on one file;
- the vault refuses the names that Windows reserves for devices;
- the NFC spelling and the NFD spelling of one name land on one file.

A profile changes only the behavior that its name states. A suite
therefore runs one scenario two times. The first run uses a hostile
filesystem, and the second run uses the permissive filesystem. The suite
then asserts what diverges.

`test/harness/feed-fixture/` is the ICS feed server behind the transport
port. A feed is a script. Poll N serves the variant that is declared for it.
The fixture takes its reference time from the caller. Therefore identical
scripts serve identical octets.

`test/harness/ics-octets.ts` holds the octet limit and the UTF-8 encoding.
The feed fixture's `ics-text.ts` folds against them, the mock server folds
and measures with them, and the suites measure stored bytes with them.
`ics-lines.ts` reads folded text back, and it needs no octet arithmetic of
its own. It takes any line ending, because a client sends what it likes. It
offers two readers. The first reader throws on text that no legal writer
produces. The second reader reports the problem and reads on. The mock takes
the second reader, because a malformed request body is something that the
mock answers, and not something that fails the run.

`test/harness/caldav-mock/` is the in-process CalDAV server. It implements
the transport port. Therefore a run wires it where the Obsidian adapter goes,
and the run issues no network call at all. A test states the server that it
wants through the capability switchboard. The test then asserts against the
ordered request log and the scheduling record. The scheduling record is the
ledger of writes that would have mailed attendees.

`test/harness/sweeps/` holds the standing assertions and the helper through
which a simulation is built. `runSimulation` gathers what the run's surfaces
recorded. It evaluates every registered sweep over the result. It fails the
test with the sweep's name and the evidence that the sweep objected to.
Sweeps are named predicates over that evidence. The standing set is in
`standing.ts`, and it grows with the behavior that it polices. A suite may
register its own sweeps. `vitest.config.ts` wires in `setup.ts`, and
`setup.ts` applies to every test file. `setup.ts` poisons global fetch.
Therefore a call outside the transport port throws where the call is written.
`setup.ts` also returns the registry to the standing set before each test.

Files run in a random order, and the tests inside each file also run in a
random order. A test that passes only on state that a neighbour left behind
fails here. It does not instead fail on the day that some unrelated change
reorders the suite. Every run draws a seed. The run prints the seed in the
banner under the version line: `Running tests with seed "1786557325096"`.
Therefore a CI log carries the order that its run used. To replay the order
exactly, give that seed back: `npm test -- --sequence.seed=1786557325096`. To
stop the shuffle completely, run `npm test -- --sequence.shuffle=false`. This
command runs the files in sorted order, and it runs the tests in the order in
which they are written. This order is the fixed order to bisect an ordering
failure against.

`test/harness/sequencer.ts` makes the seed a replay and not a suggestion.
Vitest hands the sequencer its files in the order in which the directory
crawl returned them. That order is not the same twice. A direct shuffle of
that order would therefore give the same seed a different order in each run.
The sequencer sorts the files first, and then it shuffles the sorted list.
When shuffling is off, the sequencer hands back the sorted list unshuffled.
Test order within a file is Vitest's own shuffle over declaration order, and
that shuffle takes the same seed. That seed does not cover property-test
inputs: fast-check draws and reports a seed of its own.

Commands: `npm test` (single run), `npm run test:watch`, `npm run coverage`.
Coverage is report-only for now.
