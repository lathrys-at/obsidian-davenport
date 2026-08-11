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

`test/harness/feed-fixture/` is the ICS feed server behind the transport
port. A feed is a script — poll N serves the variant declared for it — and
the fixture takes its reference time from the caller, so identical scripts
serve identical octets.

`test/harness/ics-octets.ts` holds the octet limit and the UTF-8 encoding:
the feed fixture's `ics-text.ts` folds against them, and the suites measure
stored bytes with them. `ics-lines.ts` reads folded text back and needs no
octet arithmetic of its own.

`test/harness/caldav-mock/` is the in-process CalDAV server. It implements
the transport port, so a run wires it where the Obsidian adapter goes and
issues no network call at all. A test states the server it wants through
the capability switchboard, then asserts against the ordered request log
and the scheduling record — the ledger of writes that would have mailed
attendees.

Commands: `npm test` (single run), `npm run test:watch`, `npm run coverage`.
Coverage is report-only for now.
