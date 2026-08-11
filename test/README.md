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

The `harness/` and `suites/` directories are created by the issues that
populate them; git carries no empty directories.

`test/harness/fixtures/ics/` holds the ICS corpus: hand-authored iCalendar
files, stored as the octets a server would send and read back byte for
byte, which `.gitattributes` keeps git from converting. `ics-corpus.ts`
indexes them by the adversarial property each one carries.

Commands: `npm test` (single run), `npm run test:watch`, `npm run coverage`.
Coverage is report-only for now.
