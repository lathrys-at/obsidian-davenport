# Davenport — Test Plan Specification

This plan is a companion to the Davenport design specification. Every `§`, row, principle, and Appendix A reference points into that document. "row N" means Appendix B's state table. This plan specifies the required tests by shape, behavior, and assertion. This plan does not prescribe the framework, the file layout, or the naming inside the test suite. Those are implementation choices. The assertion set, in contrast, is normative. An implementation is not done until every test here passes or every verification item here is recorded.

This plan has a maintenance rule that mirrors the design spec's own rule (B.3). Any future spec change owes this plan its tests before that change ships.

The rule also runs downward and inward. An issue's milestone can disagree with the stage that Part 8 assigns to one of that issue's tests. In that case, the issue owes Part 8 the reassignment before anyone works that issue. Issue authoring is where the fine-grained staging is decided. The milestone gates are copies of these stage lists. A stale list is therefore a stale definition of done.

A capability that Part 2 names in a shape's definition owes Part 3 a requirement that states that capability. Part 3 must hold that requirement before the tests of that shape are gated. Part 3 is the checklist that a harness gate certifies against. A capability that is absent from Part 3 is therefore a shape that nothing can report as unrunnable.

## Part 1 — Conventions

- Every test carries a stable ID, a shape tag (Part 2), and the design-spec references that its assertions trace to. The coverage map (Part 7) refers to these IDs.
- This plan phrases every assertion as externally observable behavior: files written or provably not written, requests issued or provably not issued, request counts and ordering, surfaces raised and dismissed, log entries, and byte comparisons. "Never" assertions are standing obligations. They run as sweeps (Part 4) across every simulation in this plan. They do not run as single cases.
- Unstated configuration means the design-spec defaults. Stated defaults are test inputs: grace period 10 minutes (§5.3), horizon −3/+12 months (§5.7), delta granularity one day (§5.7), mass-vanish threshold more-than-¼ and at-least-5 (§5.2), and retention windows (§15.2). Every threshold has boundary tests from both sides.
- Appendix A items are not pass/fail tests. They are verification protocols that produce recorded facts. Each fact lands on the branch that the design spec pre-states (Part 6.1). The recorded-facts document is versioned with the plugin. That document names its own re-verification triggers.
- Where a test is an "anchor" for a sweep, that test constructs the most direct violation opportunity for the sweep. The sweep itself still runs everywhere.

## Part 2 — Test shapes

- **[D] Deterministic unit.** These tests cover pure functions, with no I/O and no clock: parsing, serialization, normalization, digests, checksums, validation, the render pipeline, instance computation, and identity keys. The evidence is byte-level equality wherever the spec claims determinism.
- **[E] Engine simulation, single device.** These tests run the full sync engine against the mock CalDAV server and the feed fixture (Part 3), a fake vault, and a controlled clock. The evidence is request logs, vault file states, record bytes, and surface and log inventories.
- **[M] Multi-device simulation.** These tests run two or more engine instances. Each instance holds isolated device-local state. The instances share one simulated vault-sync channel with controlled delivery (Part 3.2) and one mock server. The evidence is convergence to identical vault bytes, per-device write counts, and per-device surface behavior.
- **[C] Crash and fault injection.** These tests are [E] and [M] runs with kill points between individual file writes, truncated responses, mid-loop network failure, and process restart. The evidence is that every post-restart state is a state that the design spec defines, and that the specified surface appears.
- **[V] Live verification.** These tests execute Appendix A against real providers, real sync tools, and real Obsidian builds. The evidence is recorded facts that route to pre-stated branches.
- **[U] Interface behavior.** These tests cover views, banners, modals, and commands. They run automatically where the plugin test harness reaches those surfaces. Where the harness does not reach them, scripted manual checklists carry the identical assertions. The assertion set is normative either way.
- **[L] Load and benchmark.** These tests run the envelope magnitudes (§5.7) against startup, sync-loop, and render costs. They also count write churn at steady state.

## Part 3 — Harness requirements

Every capability below is load-bearing for at least one test in Part 5.

### 3.1 Mock CalDAV server

Each run configures the mock CalDAV server. The configurable items are these:

- RFC 6578 sync-token support on or off, and token rejection on demand.
- CTag behavior.
- `If-Match` and `If-None-Match: *` enforcement on or off (the §5.5 branch).
- ETag stability, or an ETag change on each fetch.
- Byte-stable or re-serialized `GET` bodies (§3.2 normalization, A16).
- `supported-calendar-component-set` per collection.
- `calendar-query` UID property-filter support on or off (§3.4, A25).
- RFC 8607 managed attachments on or off (§9.4, A3).
- A scheduling record (§5.5). The scheduling record is a ledger of the writes that *would* have generated iTIP messages. Gate tests therefore assert against that record. Gate tests never assert against real mail.
- A discovery tree with redirect injection (A13).
- Response truncation and 5xx injection.
- A full request log with ordering and counts.

### 3.2 Vault-sync simulator

The vault-sync simulator delivers file changes between simulated devices. It gives control over these items:

- Order and latency (record before note, or note before record).
- Conflict-copy generation for each tool filename pattern. The recorded facts of A20 feed the pattern corpus.
- Merge-mangle injection that models line-level auto-merge damage (§3.2 quarantine, A14).
- Delivery of a rename as a rename, or as a delete plus a create (A21).
- An mtime preservation toggle (A15).

### 3.3 Feed fixture

The feed fixture serves ICS with these properties:

- `DTSTAMP` churn on each fetch.
- UID omission, UID duplication inside the feed, and UID re-minting on each fetch.
- Truncation in the middle of the file.
- Login-wall HTML.
- A valid but empty `VCALENDAR`.
- Decade-spanning corpora.
- Controllable content deltas per poll.

### 3.4 Obsidian API fake, and the real-API split

The [D], [E], and [M] shapes run against a fake of `metadataCache`, vault events, and `processFrontMatter`. The byte behavior of that fake is deterministic by construction. The harness poisons global `fetch` in every [E], [M], and [C] run. A network call that does not route through `requestUrl` therefore fails loudly (IV-13). This rule applies to the network calls of `tsdav` also. `tsdav` must run on the injected transport.

The determinism of the *real* `processFrontMatter` is exactly Appendix A item 11. The fake never assumes that determinism. Appendix A item 11 gates stage 2 (Part 8).

### 3.5 Clock and corpus

The harness has a controllable clock. That clock drives debounce, grace periods, horizon edges, delta granularity, and retention. The harness also has an adversarial ICS corpus that holds fuzzed unmodeled `X-` properties, foreign `VALARM`s, structured locations, legal but exotic folding and escaping, `VTIMEZONE` variety that includes historical zones, `RECURRENCE-ID` overrides, and `EXDATE`s. IV-4, the normalization tests, and the round-trip suites use that corpus.

The harness poisons the ambient time functions in every run of the test suite, and that scope covers every [E], [M], and [C] run. The poisoned functions are `Date.now`, the `Date` constructor with no argument, `Date` called as a plain function, and the timers `setTimeout`, `setInterval`, and `setImmediate`. A test that reads the wall clock through one of these functions therefore fails at the line that reads the wall clock (IV-14). The poison covers only these ordinary forms of a clock reading, and it does not cover every path to the wall clock. Three known paths stay outside the poison: `performance.timeOrigin` with `performance.now`, `new Intl.DateTimeFormat().format()` with no argument, and a timer that a test imports from `node:timers`. The poison replaces the time functions of the global objects, and an imported function does not come from those objects.

The poison asks which code made the call, and it answers from the stack. A call throws when the caller is the code of this repository, and a call throws when the poison cannot read the caller. A call gets the real answer when the caller is an installed dependency, the node runtime, or a file outside the repository root. The poison must let those callers through, because the test runner and the test dependencies read the wall clock in the same process as the tests. A test that must read the real clock calls a named opt-out, and that call states its reason.

### 3.6 Vault-write interruption and restart

This capability is the kill points inside a vault write, and the process lifecycle around that write. These are the other two capabilities that Part 2 defines [C] by. A write and its change event are separable: the harness can drop the write, drop the event, or deliver the two out of order.

The engine restarts against the vault and the device-local state as an interrupted run left them. The engine rehydrates and re-derives. The engine does not resume. Nothing carries across the restart that was not on disk.

Where a crash can land between two writes, which write goes first is a design decision, not an implementation accident (§5.4). The mandated orders therefore need a facility that can land a crash between those two writes. This capability is load-bearing for CD-3, CD-9, CD-10, IN-12, IN-14, PU-8, TS-10, TK-7, and TK-16. Those are the tests whose setup or assertion is a vault state that no running process observed, or a write and its change event delivered apart. This capability is also load-bearing for the standing obligation of every [C] run: the post-restart state is one that the design spec defines (Part 2).

## Part 4 — Invariant sweeps

The sweeps are standing assertions. This plan evaluates them across every [E], [M], and [C] run. A sweep failure anywhere fails the run that produced it. Each sweep traces to a principle (§1) or to a stated prohibition.

- **IV-1 Presence is never intent (principle 3).** No server write occurs without its named signal. A push requires dirty ∧ mode (§5.3, §4.2), or it requires `ready` execution (§6.1). A `DELETE` requires a local-intent tombstone (§5.6). RSVP, refresh, and transmutation each require their command (§12, §9.5, §10.4). The property obligation is this: generated operation sequences that contain no signal produce zero server writes.
- **IV-2 Attendee gate (§5.5).** A recorded confirmation comes before every `PUT` and every `DELETE` whose resource has `ATTENDEE`, would gain `ATTENDEE`, or would lose `ATTENDEE`. This holds in every mode and on every path. The paths include auto-push-on-valid (§4.2), drag/resize (§14.2), refresh (§9.5), and RSVP (§12). The scheduling record of the mock server never contains an unconfirmed would-notify write.
- **IV-3 Declared fields only (principle 2).** Engine note writes touch only the declared keys and channels. Outside those keys and channels, the body is never a sync surface. Templates fire one time (§8.1). The only sanctioned write into non-Davenport frontmatter is the write of prefix-scoped tags (§13). That write never adds, removes, or reorders tags outside the prefix.
- **IV-4 Round-trip preservation (§5.5).** Under the adversarial corpus, every unmodeled property survives arbitrary sequences of modeled-field pushes. The comparison uses normalized bytes.
- **IV-5 Storage discipline (§3.1, §3.2).** No `etag`, href, hash, or base-snapshot material ever appears in note frontmatter. No per-device fact ever appears in a record, and no friendly calendar name ever appears in a record.
- **IV-6 Secrets (§4.3).** At maximum log verbosity, no credential material appears in frontmatter, records, logs, or exports.
- **IV-7 Nothing silently skipped (principle 5).** Every refusal, every skip, and every failure emits a log entry (§14.4). Every condition that §14.3 routes also raises its surface.
- **IV-8 Remote-observed tombstones never write (§5.6).** When the engine processes a remote-observed tombstone, it issues zero server requests. This holds in every reachable sequence.
- **IV-9 Zero-churn convergence (§3.2).** At steady state, devices that hold identical server state hold byte-identical records and perform zero writes per loop.
- **IV-10 No silent last-writer-wins (§5.4, §6.3).** Dirty same-field three-value conflicts always surface. Pointer/map supersessions always surface. No path resolves either one silently.
- **IV-11 Mode gating (§4.2, B.2).** No push-capable action is reachable on a remote-owned calendar. Feed calendars are remote-owned unconditionally.
- **IV-12 Surface lifecycle (§14.3).** Flight-skew items self-dismiss when their condition resolves. Preservation items (§4.2, §5.4) resolve only by acknowledgment. No item outlives its condition.
- **IV-13 Network discipline (§2.2).** Every network call routes through `requestUrl`. CalDAV servers send no CORS headers, so a stray `fetch` is a mobile-only breakage discovered in the field. Two mechanisms enforce this rule. First, the harness poisons global `fetch` in every simulated run (Part 3.4). Second, a static scan of the shipped bundle finds no direct `fetch` usage.
- **IV-14 Time discipline (§2.2).** The controlled clock is the only source of a time in an [E], [M], or [C] run. No [E], [M], or [C] test uses the opt-out that Part 3.5 states. The wall clock gives a different answer on each run. A test that reads the wall clock can therefore pass on one run and fail on a later run. The harness poisons the ambient time functions in every run of the test suite, and that poison covers only the ordinary forms of a clock reading. The sweep asserts that the poison stayed in place for the whole run.

## Part 5 — Suites

Suites mirror the design spec's sections. Each test has an ID, a shape, a behavior with assertions, and references.

### 5.1 Frontmatter and schema [FM] — §3.1

- **FM-1 [D]** The parser reads the full key vocabulary. The vocabulary includes the `duration` forms (`30m`, `1h30m`) and the ISO 8601 variants with offsets and without offsets.
- **FM-2 [D]** `date` together with `start` fails validation. `end` together with `duration` also fails validation. Each failure names both keys (§3.1, §6.2).
- **FM-3 [D]** All-day serialization: an inclusive `endDate` becomes an exclusive `DTEND`. This applies to single-day events, to multi-day events, and to month-boundary events. This off-by-one is the point of the test (§3.1).
- **FM-4 [D]** Timezone resolution order: an explicit offset or `Z` beats the `timezone` key, and the `timezone` key beats the calendar default. Emission carries `TZID` with `VTIMEZONE`. Set the device zone to differ from all three inputs. The emitted zone then equals the resolved zone, and the emitted zone is never silently the local zone (§3.1, §2.2).
- **FM-5 [E]** `summary` takes its default from the filename one time, at push-creation. A rename of the live note after that marks nothing dirty and pushes nothing (§3.1, §14.8).
- **FM-6 [E]** The inbound timed↔all-day switch is shape-exclusive. A single write event removes the keys of the departing shape and adds the keys of the arriving shape (§3.1).
- **FM-7 [D]** `status` and `state` are disjoint. `status: cancelled` passes its vocabulary, renders struck (§14.2), and never touches the lifecycle. `state` never serializes to the server (§3.1, §13).
- **FM-8 [E]** Materialization always writes explicit `summary` and `calendar:` (§8.1, §3.4).

### 5.2 Record ledger [LG] — §3.2

- **LG-1 [D]** The record filename equals the digest of the pair (collection href, UID). The record contains the pair. The digest is filename-safe against §14.8's per-platform illegal sets.
- **LG-2 [D]** Byte determinism: two independent engine instances compute a record from identical inputs (server state, venue pointer, materialization map and content hash, tombstone). The two instances produce identical bytes. Write-if-changed performs zero writes on a match.
- **LG-3 [D]** Normalization: server ICS that is byte-different but semantically identical normalizes to identical record bytes. The variants are re-serialized, re-folded, and property-reordered, per the corpus (§3.2, A16).
- **LG-4 [E]** Version-stamp skew: an older-stamped device reads a newer-stamped record that has byte-only differences. The older-stamped device suppresses its rewrite. The newer device rewrites one time. No ping-pong occurs across ≥10 alternating loops (§3.2, A19).
- **LG-5 [M]** Two-channel convergence: a stale device's own fetch fast-forwards its record to identical bytes, with zero vault-sync conflict. The other device's arriving copy corrects the stale device's linked note. Assert that the stale device's engine performed no note write (§3.2).
- **LG-6 [E]** Quarantine (a): unparseable records and schema-invalid records quarantine and surface. Every consumer excludes them. Enumerate the consumers: views, inbound locate, push, adoption, and routing (§3.2).
- **LG-7 [E]** Quarantine (b): a record whose filename does not equal its contained identity quarantines. Every conflict-copy pattern in the A20 corpus trips this rule.
- **LG-8 [E]** Quarantine (c1): merge-mangled records fail the self-checksum on every device at every version stamp. (c2): a mangle that survives the checksum fails recompute at an equal stamp (§3.2, A14).
- **LG-9 [E]** The checksum verifies with the checksum field blanked. An older-version device verifies a newer-stamped record and does not recompute the canonical form (§3.2).
- **LG-10 [E]** Rebuild, resource present: the re-fetch gives a live record. Suspended-era dirty entries evaluate normally: they push per mode, or they conflict (row 16, B.1).
- **LG-11 [E]** Rebuild, resource absent: on `404`, the rebuilt record is a remote-observed tombstone. On `404`, the note becomes orphaned and the accumulated dirty state goes inert. Run this test against a setup near-identical to LG-10's setup. Use this setup to demonstrate that the branches cannot fall through each other (row 16b).
- **LG-12 [E]** Conflict-copy records that differ only in tombstone type auto-resolve by dominance, with no surfacing (§3.2, §5.6).
- **LG-13 [E]** Records are machine-owned. The next loop overwrites a hand edit wholesale, or the next loop quarantines the hand edit. A hand edit is never merged (§3.2).
- **LG-14 [U]** The onboarding excluded-files button adds the records folder. The documentation of the Bases/Dataview trade-off follows A18's recorded fact (§3.2).

### 5.3 Device-local state [DL] — §3.3

- **DL-1 [M]** Cursor isolation and regenerability: each device syncs on its own tokens. Wipe one device's device-local state and re-sync that device. The device converges to identical record bytes, with zero server writes and zero wrong note writes.
- **DL-2 [M]** Dirty-set loss degrades to a question. Wipe the dirty set while genuine divergence is outstanding: no push occurs. Grace surfacing then occurs after the period. If a same-field remote overlap exists, the §5.4 preservation item occurs instead of silence (§3.3, §5.3, §5.4).
- **DL-3 [E]** Storage capacity: bulk device-local data routes per A17's recorded limits (IndexedDB for bulk). After a loss of the IndexedDB cache, the device regenerates the identical state (§3.3, §2.2).

### 5.4 Identity [ID] — §3.4

- **ID-1 [D]** Validation rejects a template-supplied `uid` (§3.4, §8.1).
- **ID-2 [E]** Resolution requires `calendar:` and `uid`. One UID synced in two collections yields two records. A note resolves unambiguously to one record.
- **ID-3 [E]** Two notes, one identity: this condition is detected. The newer file is stripped to draft, and its fields are kept. The older file is untouched. The rule never applies to record files (row 18, §3.2).
- **ID-4 [E]** A rename does not disturb identity. The record pointer follows the rename event (§3.4).
- **ID-5 [E]** A `uid` without a record is inert. It is never pushed, it is never re-created, and it is never offered adoption. When a record for that identity later appears, an adoption suggestion is raised, and an auto-bind never happens (§3.4).
- **ID-6 [E]** Persistence past grace surfaces with the three named actions: UID-filter server lookup, strip-to-draft, and strip identity. For the lookup: if the server finds the UID, the result is an adoption suggestion. If the server does not find the UID, there is nothing to link. A filter-unsupported server gives "lookup unavailable", and it never gives a false not-found (row 8, A25).
- **ID-7 [M]** Creation race: two devices execute `ready` for one UID. Exactly one device gets a `201`. The `412` loser fetches and converges. The result is one server resource and byte-identical records (§3.4, §5.5, row 4).
- **ID-8 [E]** The same UID is live in two synced collections, and both sides carry `ATTENDEE` data. The result is two distinct records. The invited-copy relationship is surfaced informationally, and it is not modeled (row 20, §3.2).

### 5.5 Registry and ownership [RG] — §4.1–§4.2

- **RG-1 [E]** Discovery: the `PROPFIND` walk starts at `/.well-known/caldav` and goes through the principal and the calendar-home-set. The walk reads `supported-calendar-component-set`. The walk enumerates task lists as first-class items (§4.1, §10.2).
- **RG-2 [D]** An unresolvable `calendar:` fails validation legibly. The failure names the value (§4.1).
- **RG-3 [E]** Newly added CalDAV calendars default to remote-owned (§4.2).
- **RG-4 [E]** Vault-owned: the per-calendar setting determines how remote changes are handled. Exercise both values of the setting. Auto-push-on-valid pushes valid divergence without `ready`. This option exists on vault-owned calendars only; assert that it is absent elsewhere. The attendee gate still fires on each write (IV-2 anchor) (§4.2).
- **RG-5 [E]** Remote-owned: push transitions are absent, and the UI says so. `state: ready` gives a visible warning. `state: draft` gives no warning (row 22) (§4.2).
- **RG-6 [E]** Remote-owned dirty divergence: surfacing is immediate, and it offers revert and copy-out. The next inbound overwrites. The item preserves the displaced values, and the item resolves only by acknowledgment (§4.2, §14.3).
- **RG-7 [M]** Remote-owned not-dirty divergence: vault-sync flight skew never prompts. When the grace prompt fires, the prompt has no push action (§4.2, §5.3).
- **RG-8 [E]** Feed calendars are remote-owned. No configuration path can change this ownership (IV-11) (§4.2).
- **RG-9 [E]** An ownership-mode change on a registered calendar flips behavior without record churn. Zero record rewrites are attributable to the mode change (§4.2, §3.2).
- **RG-10 [E]** Registry rename: a rename of a calendar's friendly name rewrites zero records. Names resolve from the href at read time (§3.2). At the same time, views, validation messages, and note `calendar:` resolution reflect the new name. Notes that carry the old name fail validation, and the failure names the value (§4.1).

### 5.6 Secrets and OAuth [SC] — §4.3–§4.4

- **SC-1 [E]** SecretStorage is used when it is available. The `data.json` fallback carries the persistent settings warning on older versions (§4.3).
- **SC-2** IV-6 anchor: full-verbosity logs, exports, records, and frontmatter from every other suite are scanned for credential material.
- **SC-3 [E]** OAuth against a mock IdP: the flow is Authorization Code with PKCE. The transient loopback listener opens and closes. Token refresh goes through `tsdav`. The refresh token is stored per §4.3 (§4.4).
- **SC-4 [U]** Mobile: authorization is stated to be unavailable. Post-authorization mobile behavior follows A7's recorded fact into §6.1's credentials-absent path (§4.4).
- **SC-5 [release checklist]** The README makes no encryption-at-rest claim until A1 records support (§4.3). The Google setup guide gives the instruction to publish the OAuth app to production (unverified) status. The guide names the seven-day token expiry of Testing status (§4.4).

### 5.7 Sync loop [LP] — §5.1

- **LP-1 [E]** Incremental happy path: the sequence is the token REPORT, then the changed hrefs, then one `calendar-multiget`, then the §5.4 apply, then the token advance. Assert the request counts.
- **LP-2 [E]** A reported href with no record mints a record. Test the in-horizon variant and the out-of-horizon variant (§5.1, §5.7).
- **LP-3 [E]** Token rejection: if the CTag is unchanged, no query occurs, and this is the cheap exit. If the CTag changed, a horizon `calendar-query` occurs, and the diff is scoped to in-horizon records. In the CTag-changed branch, out-of-horizon records stay untouched: no reads and no writes occur against them (§5.1).
- **LP-4 [E]** Absence confirmation, `200` branch: a reschedule across the horizon boundary since the last good sync produces no tombstone. The record updates to the moved time. Subsequent fallback diffs exclude the record (§5.1, §5.7).
- **LP-5 [E]** Absence confirmation, `404` branch: a true deletion mints the remote-observed tombstone (§5.1).
- **LP-6 [E]** Confirmation is one batched `calendar-multiget` over the whole absent set. The request count is 1 for every set size (§5.1).
- **LP-7 [E]** Injected failures back off exponentially. Writes to one server are strictly serialized. Reads are batched (§5.1).

### 5.8 Feeds [FD] — §5.2

- **FD-1 [E]** `DTSTAMP` churn per fetch across repeated polls causes zero record rewrites (content-hash marker).
- **FD-2 [D]** `SEQUENCE` tiebreaker: an equal content hash with a bumped `SEQUENCE` applies as a change.
- **FD-3 [E]** Parse gate: the gate discards truncated ICS and login-wall HTML whole. The result is one log line, zero diff, and zero tombstones (§5.2).
- **FD-4 [E]** Horizon clip: a decade-spanning feed mints records only for in-horizon events. The minting is stable across polls (§5.2, §5.7).
- **FD-5 [E]** Unclipped existence: an event outside the window that is present in the file is never tombstoned. An event rescheduled outward across the boundary is retained and not tombstoned. That event updates when the window covers it again (§5.2).
- **FD-6 [E]** Threshold boundaries: a hold requires vanished > ¼ of the feed's records AND vanished ≥ 5. Exercise these cases: exactly ¼ (proceed), above ¼ with 4 events (proceed), and above ¼ with 5 (hold) (§5.2).
- **FD-7 [E]** Instability branch: the feed re-mints UIDs on each fetch. The vanish/appear content-pairing then succeeds. One anomaly then offers the sticky per-feed switch to content-derived identity. If the user accepts, the switch re-keys the feed's records in one poll. The accept produces no per-event banners and no tombstones for the re-keyed set. The accept transfers venue pointers and materialization entries along the pairing. Unmatched events fall out as an ordinary vanish-plus-appear under the new identity. Subsequent polls are stable with zero churn (§5.2, A23).
- **FD-8 [E]** Outage branch: a valid-but-empty `VCALENDAR` gives 100% vanish. The 100% vanish gives a hold with one anomaly and zero per-event banners. The restoring poll clears the hold silently (§5.2).
- **FD-9 [E]** Held tombstones apply only on the user's explicit accept. The accept then produces the per-event remote-observed tombstones and the typed banners (§5.2).
- **FD-10 [E]** A genuine vanish below the threshold gives a remote-observed tombstone, a feed-typed banner, and zero server requests (IV-8) (row 32, §5.2, §5.6).
- **FD-11 [D]** Synthesized identity for UID-less events is stable across byte-identical re-serves. An edit is a vanish-plus-appear. Assert the continuity loss: the pointer and the materialization do not transfer (§5.2).
- **FD-12 [E]** Duplicate UIDs within one feed: the content hash disambiguates them. Both records stay live. The feed-level anomaly is raised one time (§5.2).
- **FD-13 [E]** Feed records refuse push on every path. The refusal states the reason (§5.2, §4.2).

### 5.9 Local change detection [CD] — §5.3

- **CD-1 [E]** Watcher scope: the watcher observes only notes that carry `uid` or `state`. The watcher does not watch plain notes, and this includes acknowledged notes with event fields intact (row 1, B axes). The watcher does not watch a record file inside the records folder. That file carries `uid` and no `state`, and Davenport does not treat it as a note (§5.3).
- **CD-2 [E]** Debounce: an edit burst produces one batched push after editor idle (§5.3).
- **CD-3 [E]** Self-write exclusion works by expected-content matching. Inbound application, adoption backfill, and `state`-strip never enter the dirty set. Construct both misattribution directions, and show that both are benign. First: a user edit that is byte-identical to the expected content is swallowed, and it later takes the surfaced path. Second: a self-write that is mistaken for a user edit produces zero server writes in the steady interleaving (§5.3, §5.4; the crash interleaving per IN-12).
- **CD-4 [E]** Generation stamps: an edit during push flight survives clear-on-success. The edit pushes on the next loop. There is no lost update, and there is no downgraded prompt (§5.3).
- **CD-5 [E]** Dirty entries clear when the divergence disappears (hand revert) (§5.3).
- **CD-6 [M]** Not-dirty divergence is held inert. At grace expiry, the divergence surfaces with per-field values and with inspect as the default. Grace expiry is clock-driven; test the boundary on both sides of the configured value. A late-arriving file resolves the divergence, and the item self-dismisses without a click (§5.3, IV-12).
- **CD-7 [E]** Derived-content divergence is exempt from grace surfacing. It participates only when a push is already occurring, that is, on dirty declared fields or on the refresh command (§5.3, §9.5).
- **CD-8 [E]** Orphaned notes and suspended notes are exempt from grace surfacing. The banner is their surface (§5.3, B.1).
- **CD-9 [E]** External edits made while Obsidian was closed (files changed before startup) create no dirty entry. These edits take the surfaced path. An auto-push never happens (§5.3).
- **CD-10 [E]** The pending set is derived. A mid-cycle kill and restart with the dirty set intact recomputes an identical pending set (§5.3, §14.4).

### 5.10 Inbound and conflicts [IN] — §5.4

Part 6.4 holds the full branch matrix. The items in this section are the cells of that matrix, plus the behavior around the cells.

- **IN-1 [E]** The local value equals the base value, and the remote value changed. Davenport applies the remote change to the record and to the linked note. Davenport updates the base snapshot (row 6 baseline).
- **IN-2 [M]** Flight-skew silence: a stale note copy carries the previous base value, and a remote change also occurs. Davenport applies the remote change silently. Davenport shows no item and no prompt (§5.4).
- **IN-3 [E]** Three distinct values occur on a note that is not dirty. Davenport applies the remote value. An acknowledgeable preservation item carries the displaced value with revert and copy-out. The item never self-dismisses (row 6, §5.4, §14.3).
- **IN-4 [E]** The note is dirty, and the remote value did not change. Davenport takes no inbound action. The push proceeds per §5.5.
- **IN-5 [E]** Local and remote both changed, but in different fields. Davenport merges silently: it applies the remote fields, and it keeps and pushes the local fields. The test asserts the *absence* of any surface (§5.4).
- **IN-6 [M]** Local and remote changed the same field to the same value. The result is a convergence no-op. The same user's edit arrives one time by CalDAV and one time by vault sync, and it raises nothing (§5.4).
- **IN-7 [E]** The note is dirty, local and remote changed the same field, and three distinct values occur. Davenport surfaces a conflict. Davenport never applies last-writer-wins. The local-wins choice updates the note and the record, and it pushes. The remote-wins choice updates both and pushes nothing (§5.4, IV-10).
- **IN-8 [E]** A remote deletion arrives for an identity with a linked note. Under the flag default, Davenport writes a remote-observed tombstone and puts a banner on the note. Under the flag default, the file survives and the materialized sections stay (§5.4, §5.6, §7.5).
- **IN-9 [M]** Row 25: two devices edit the same note at the same time. The sync-tool layer resolves the edits. The tool's output re-enters as dirty. A stale-base push meets `412` and goes into resolution. This demonstrates the named backstop (§5.4, §5.5).
- **IN-10 [E]** Field-level application: Davenport applies only the changed fields of a multi-field remote change. Davenport does not touch the local-only keys (IV-3 anchor) (§5.4).
- **IN-11 [M]** Every-device symmetry: two devices apply the same inbound change to the same linked note at the same time. The two devices produce byte-identical note writes. Vault sync produces no conflict artifacts. This tests §5.4's "every device applies every inbound change" claim. The Part 3.4 fake makes the test deterministic, and A-11 carries the real API.
- **IN-12 [C]** Inbound-apply crash window under the mandated order (note first, record/base second — §5.4). The write log shows that the base write never leads the note write. A kill after the note write resolves on the next loop as silent convergence (remote-equals-local), with no prompt and no wrong write. An interrupted self-write that escapes expected-content matching and enters the dirty set meets `If-Match` on the advanced etag, and it converges. This exercises the named backstop (§5.4, §5.3, §5.5).
- **IN-13 [E]** Remove option (§5.4): Davenport moves an untouched note that Davenport created to the trash through the trash API. The trash operation honors the deleted-files preference, and Davenport never deletes the note permanently. A note whose content diverges from the stored materialization hash degrades to flag, and Davenport logs the reason. A note that Davenport did not create (adopted or linked) also degrades to flag, and Davenport logs the reason. The trash operation acknowledges: the tombstone is claimant-free, and it prunes per TS-15. The venue sections stay (§5.4, §7.3, §5.6).
- **IN-14 [C+M]** Remove-option order and flight: a kill occurs between the tombstone write and the trash operation. The intermediate state is an ordinary orphaned note. The intermediate state is never a live record with a dangling pointer. On a second device, the trashed note arrives before the tombstone record, and this raises a transient dangling-pointer item. The item self-dismisses when the tombstone record arrives (IV-12) (§5.4, §14.3).

### 5.11 Push [PU] — §5.5

- **PU-1 [E]** Every update `PUT` carries `If-Match` with the record's etag. On success, Davenport increases `SEQUENCE` and updates the etag, the base snapshot, and the hashes (§5.5).
- **PU-2 [E]** A creation targets `{uid}.ics` and carries `If-None-Match: *`. A `412` on creation makes Davenport fetch and converge. A `412` on creation also makes Davenport strip `state` and report no error (row 4, §5.5).
- **PU-3 [E]** `412` on update: Davenport pulls and enters §5.4. Davenport retries only after the resolution. The test asserts no blind retry and no forced write (§5.5).
- **PU-4 [D+E]** Round-trip patching (IV-4 anchor): every corpus property survives the modeled-field pushes. The named regression is this: a foreign `VALARM` survives a time change (§5.5).
- **PU-5 [E]** Attendee-gate matrix (Part 6.3): every listed operation gates in every context. The confirmation shows what changes and who receives a notification (§14.6). No configuration path suppresses the gate (§15.4).
- **PU-6 [E]** Precondition-non-enforcement branch: the mock has enforcement off, and the documentation records the provider as non-enforcing. Under these two conditions, Davenport shows the §14.4 per-account trust caveat (§5.5, A24).
- **PU-7 [E]** Stage variants: the stage-3 build surfaces `412` as a blocking error on the item. The stage-4 build surfaces field-level resolution (§18).
- **PU-8 [C]** Push crash windows: the first window is a kill between a successful update `PUT` and the update of the record's etag and base. The next loop's push meets `412`. The push then pulls and lands in the remote-equals-local convergence branch (§5.4), with no conflict prompt and no duplicate write. The second window is a kill between a successful creation and the record mint. The note is still `ready`, and the re-push meets `If-None-Match: *` `412`. Then row 4's fetch-and-converge produces one server resource and one record (§5.5).

### 5.12 Tombstones and deletion [TS] — §5.6

- **TS-1 [E]** Local-intent tombstone: Davenport sends a `DELETE` with `If-Match`. A `404` is a silent success.
- **TS-2 [E]** `DELETE` `412`: Davenport surfaces a delete-anyway choice and a keep choice. Davenport never does an auto-refetch-and-force (§5.6).
- **TS-3 [E]** Keep: Davenport clears the tombstone and revives the record. Davenport re-fetches the resource and enters §5.4 again. Davenport retains the pointer if and only if a note still claims the identity. If no note claims the identity, the record goes to routing or the inbox (row 12).
- **TS-4 [M]** Monotone typing: a remote-observed tombstone arrives first, and a local-intent tombstone arrives after it. The type upgrades, and the banner corrects to the user's own deletion (§5.6's acknowledged mislabel). A local-intent tombstone never downgrades. A loss of the strongest-seen memory degrades to a banner correction only, with no server effect (§5.6, §3.3).
- **TS-5 [M]** Deletion propagation: device A decides a tombstone, and vault sync carries the tombstone to device B. Device B's next pull never resurrects the event (§5.6's core rationale).
- **TS-6 [E]** Retention: an unacknowledged claim blocks pruning for an unlimited time. Acknowledgment strips `uid` and `state`. The note becomes a plain note, and its fields stay intact. Acknowledgment then starts prunability (row 13, §5.6).
- **TS-7 [E]** Reappearance within retention, with no acknowledgment: Davenport revives the record and relinks the note. The banner self-dismisses. Davenport clears the orphan-era dirty state. A post-revival divergence goes to inert or grace, and never to a push (row 14, §5.6, B.1).
- **TS-8 [E]** Reappearance after acknowledgment: within retention, the revival lands unlinked and goes to the inbox. After pruning, the reappearance is a genuinely new record and goes to the inbox. Davenport auto-binds in neither case (row 14, §3.4).
- **TS-9 [E]** Move suggestion: one account holds a tombstone in collection A, and the same UID appears in collection B. Davenport puts a suggestion on the orphaned note. Accept updates `calendar:` and transfers the pointer. If `ATTENDEE` is present on both sides, Davenport suppresses the suggestion or adds a caveat to it. Across two accounts, Davenport never suggests the move, and the manual acknowledge-then-adopt path is present (row 15, §5.6).
- **TS-10 [E]** Dangling pointer (note deleted while closed): the rename check runs first under both A21 delivery modes, and it offers relink. Davenport never does an automatic `DELETE` (IV-1). A live record offers retract, unlink, and restore. A deletion of an orphaned note counts as acknowledgment (§5.6).
- **TS-11 [E]** Venue relink heuristic: a venue arrives as delete-plus-create. The heuristic matches the venue by name and timing, and Davenport offers relink. The materialization-map entries clear only after the resolution concludes deletion. The entries never clear eagerly (row 24, §5.6, §6.3).
- **TS-12 [E]** Horizon exit: an event drifts out of the window. The event produces no tombstone and no deletion-adjacent observable at all (§5.6, §5.7).
- **TS-13 [E]** Record-only tombstone: Davenport processes the tombstone per its type. The venue sections stay. The tombstone is legible in the sync log and in the inbox. No note exists to carry a banner (row 30, §7.5).
- **TS-14 [E]** Record-only quarantine: every consumer excludes the quarantined record. The rebuild follows rows 16/16b. The venue pointer rides the rebuilt record (row 31, §3.2).
- **TS-15 [E]** Pruning: the test constructs a claimant-free tombstone that is record-only, or acknowledged, or has its orphaned note deleted (§5.6). That tombstone prunes when the retention window elapses. The test drives the clock and checks the boundary on both sides of the configured window. A tombstone with an unacknowledged claim never prunes, regardless of the elapsed time (TS-6's block, held for an unlimited time). The post-prune reappearance behavior follows TS-8 (§5.6, §15.2).

### 5.13 Horizon and membership [HZ] — §5.7

- **HZ-1 [E]** Davenport pulls a recurring series whole when the series intersects the window. The instances beyond the edge are present in the record base (§5.7).
- **HZ-2 [E]** Backfill mints past records on demand, per calendar (§5.7).
- **HZ-3 [E]** Delta query: the test creates an event beyond the future edge and does not modify it. The clock advances one day. Davenport queries the newly included slice and mints the record (token mode) (§5.7).
- **HZ-4 [E]** CTag mode needs no delta step: the fallback's full-window query enumerates the same slide-in (§5.7, §5.1).
- **HZ-5 [E]** Delta granularity: Davenport makes no delta query until the edge crosses the configured granularity. The test checks the boundary on both sides of one day (§5.7).
- **HZ-6 [E]** Out-of-horizon staleness: a linked-note edit pushes a stale out-of-horizon record, and the push meets the `412` path. A remote change that the token reports refreshes the record (§5.7, §5.5).
- **HZ-7 [L]** Envelope benchmarks per Part 6.6 (§5.7).
- **HZ-8 [E]** Per-calendar horizon override: an overridden calendar enumerates, clips, and delta-queries on its own window. The other calendars follow the global default. The override is one of §5.7's named envelope levers (§5.7, §15.2).

### 5.14 Lifecycle and validation [LC] — §6.1–§6.2

- **LC-1 [E]** Draft: the views render the draft. Davenport makes zero server requests across N loops (row 2).
- **LC-2 [E]** Ready: validation runs, then creation runs, then Davenport mints the record, then Davenport strips `state`. A note with no `state` and with a `uid` reads as live (row 3, §6.1).
- **LC-3 [E]** Signal equivalence: the command, the view button, the quick-add confirm, and the hand-typed field produce identical behavior (pairwise-sampled) (§6.1).
- **LC-4 [E]** Hand `ready` on a live note: Davenport strips it as satisfied and logs the strip. Davenport does not re-push (row 9).
- **LC-5 [E]** Hand `draft` on a live note: Davenport surfaces it with revert. Davenport deletes nothing on the server under any response (row 10).
- **LC-6 [E]** Hand-changed or deleted `calendar:`/`type:`: Davenport surfaces the change with revert. The surface names the commands as the sanctioned path (row 11).
- **LC-7 [E]** Hand-appearing or changed `uid`: Davenport surfaces it, never auto-binds it, and offers copied-note recovery (row 28). Hand-deleted `uid`: Davenport surfaces it with unlink, and the pointer stays one-way pending resolution (row 29).
- **LC-8 [M]** Execute-anywhere: a note with `ready` and `uid` arrives by vault sync, and it executes on the second device. The executing device prompts any attendee gate (§6.1; race per ID-7).
- **LC-9 [E]** Identity gate: `ready` against a tombstoned identity refuses with the un-cancel message. `ready` against a quarantined identity refuses with the resolve-first message. Neither case executes (rows 26–27, §6.2).
- **LC-10 [M]** Credentials absent: the §14.4 card shows the account as disabled-on-this-device. Davenport makes zero retries across N loops. An edit on the uncredentialed device reaches the server through the grace prompt on the credentialed device. Davenport never pushes that edit automatically (§6.1, §5.3).
- **LC-11 [D]** Validation matrix: the test violates each §6.2 requirement in isolation, and each violation fails and names the field. The messages "not pushed: draft" and "not pushed: invalid" stay distinct. Every failure logs (IV-7).

### 5.15 Adoption and retraction [AD] — §6.3–§6.4

- **AD-1 [E]** Davenport refuses adoption onto a note that bears a different identity. Davenport offers venue-linking (row 17, §7.1).
- **AD-2 [E]** Link command: Davenport sets the pointer. Davenport backfills `uid` and `calendar:`. Davenport backfills the modeled fields, so the post-link diff is empty. The modal previews the exact changes. Davenport makes zero server writes (§6.3).
- **AD-3 [M]** Pointer/map supersession: two devices make differing writes. Davenport surfaces the writes and names both candidates. Davenport never resolves silently by last writer (row 19, §6.3, IV-10).
- **AD-4 [E]** Davenport offers the first-sync fuzzy suggestions (title and date proximity). Davenport never applies them automatically. This also holds for the §15.2 re-run command (§6.3).
- **AD-5 [E]** The three retractions are delete-note-and-event, revert-to-draft, and remove-from-calendar-keep-note. Revert-to-draft strips `uid` and keeps the fields, and a later push mints a fresh identity. All three retractions go through local-intent tombstones (§6.4).

### 5.16 Venues, routing, materialization [VN] — §7

- **VN-1 [E]** Mutual claim: a pointer with no reciprocal note claim gives a record-only application. Davenport never writes the note. This is the stale-pointer protection (row 7, §7.1).
- **VN-2 [E]** Routing precedence: explicit assignment > note-resident claims > settings rules > inbox. On an overlap, the claims beat the settings rules. Within the settings rules, the evaluation follows the configured order, and the first match wins (§7.2, §15.2).
- **VN-3 [E]** Attendee predicates resolve through the person index (§7.2, §8.4).
- **VN-4 [E]** Lazy materialization: a pull creates records only. An open or a command creates the note or the section. The record stores the materialization content hash at creation, and that hash is the basis of §5.4's remove discriminator (IN-13). Templates fire one time. Sync never renders template output again (§7.3, §8.1).
- **VN-5 [E]** Accepted staleness: an event moves after materialization. The move updates the record, and the move does not touch the interpolated section text (§7.3).
- **VN-6 [E]** Daily notes: the routing matches by date. Davenport creates a missing daily note through the core plugin's settings (§7.4).
- **VN-7 [E]** Venue note deleted: the records fall back to routing or the inbox, with zero server writes. The instances revert to unmaterialized after the resolution (row 24, §7.5; heuristic per TS-11).
- **VN-8 [E]** Remote cancellation: the materialized sections stay. The annotation of those sections is optional (§7.5).
- **VN-9 [U]** Scoped quick-add inherits the venue's claim context: calendar, attendees, template, venue link (§7.6).

### 5.17 Templating and people [TP] — §8

- **TP-1 [D]** The test interpolates every §8.1 field. The `conferenceUrl` extraction corpus spans the provider `X-` property styles and the description-embedded links.
- **TP-2 [D]** Davenport rejects a template that carries `uid` or `state: ready` (§8.1, §3.4).
- **TP-3 [E]** Templater installed: Davenport passes through with the event context. Templater absent: Davenport does plain interpolation. The test exercises both environments (§8.3).
- **TP-4 [E]** Davenport derives the person index from the configurable key, with an optional folder scope. The index updates on a frontmatter change through `metadataCache` (§8.4).
- **TP-5 [E]** Attendee rendering: Davenport renders a matched address as a link. Davenport renders an unmatched address as plain text with the create-person action (§8.4).
- **TP-6 [E]** Two notes claim one address: Davenport detects this condition and surfaces it (§8.4).
- **TP-7 [E]** Own addresses: discovery reads `calendar-user-address-set`, and the manual per-account fallback is also present. The matching normalizes the case and strips `mailto:`. The matching honors the alias list (§8.4, §12).
- **TP-8 [E]** Event types: Davenport applies the defaults at quick-add. The expected-field validation fails legibly ("this 1:1 has no person") (§8.2).
- **TP-9 [E]** Outbound attendee resolution: an event names `[[Jane Doe]]`. Davenport resolves her address from the person index into `ATTENDEE`. The attendee gate covers this write (IV-2 context). A person note with no address fails legibly, and Davenport does not emit an empty `ATTENDEE` (§8.4, §5.5).
- **TP-10 [D]** Quick-add parse corpus: the natural-language inputs ("lunch with Sam tuesday 1pm", relative dates, ranges, all-day phrases) map through `chrono-node` into the correct pre-filled fields. Ambiguous parses land in the preview for correction. Ambiguous parses never go into a direct write. The modal is the safety, and the corpus pins the mapping (§8.2, §14.6).

### 5.18 Description and attachments [DA] — §9

- **DA-1 [E]** One-way projection: Davenport never merges remote `DESCRIPTION` or `ATTACH` edits into the markdown. Davenport flags or overwrites those edits per the mode (§9.1).
- **DA-2 [E]** Source modes: the `description:` field is the default. The delimited region is an opt-in. Its extraction respects the heading boundaries: the content under the configured heading, and nothing above it or beside it. The whole-body opt-in shows the shared-calendar visibility warning (§9.2).
- **DA-3 [E]** Backlink option: the `obsidian://` link goes in `URL` or in the footer. The option carries the visibility warning (§9.2).
- **DA-4 [D]** Embed resolution: the test covers file embeds, heading embeds, and block embeds. Davenport strips the embedded frontmatter. Davenport enforces the depth limit. A cycle terminates and surfaces (IV-7) (§9.3).
- **DA-5 [D]** Markdown-to-text: Davenport strips the formatting. Davenport converts `[text](url)` to `text (url)`. The wikilink modes follow the setting. The escaping and the folding round-trip through `ical.js` (§9.3).
- **DA-6 [D]** Media embeds promote to attachments with the placeholder line. Davenport omits nothing silently (§9.3).
- **DA-7 [E]** Attachment mechanisms: an external URL becomes `VALUE=URI`. Davenport uses managed attachments only when the discovery probe recorded the capability, and Davenport never assumes the capability. In all other cases Davenport uses inline base64 with `FMTTYPE` and `FILENAME`. An over-cap file fails validation, and the failure names the file. The shared-calendar visibility warning covers attachments explicitly (§9.4, §9.2, A3).
- **DA-8 [E]** Inbound `ATTACH`: the URLs render as links. Davenport offers save-to-vault for the binaries. Davenport never writes a binary automatically (§9.4).
- **DA-9 [E]** Snapshot semantics: an embedded source changes after the push, and this change triggers no re-push. The refresh command re-renders and pushes. The test exercises the optional re-render on lifecycle transitions both on and off. On an attendee-bearing event, the gate covers every re-render push (§9.5, IV-2).
- **DA-10 [D+M]** The render hashes are defined over the normalized base ICS values. Davenport normalizes a fresh render before the comparison. Two devices agree on the comparison outcome for identical state (§3.2, §9.5).

### 5.19 Tasks, blocks, transmutation [TK] — §10

- **TK-1 [E]** This test covers the VTODO mapping: `due` to `DUE`, `completed` to `COMPLETED`, and `priority`. The `start` field is optional. (§10.1, §10.3)
- **TK-2 [E]** A block is a VEVENT with a `task:` wikilink. The default is `OPAQUE`. When the user completes a block, Davenport offers task completion. Davenport makes an offer only. If the user declines the offer, Davenport writes nothing. (§10.1, §13)
- **TK-3 [E]** A dangling `task:` link renders plain. On a dangling `task:` link, Davenport suppresses the completion offer and shows no error. (row 23)
- **TK-4 [E]** Tasks target VTODO only. If the user pushes a task at an events-only calendar, the push fails. The failure names the mismatch. The failure offers the block fallback. The deadline-materialization option produces all-day events. (§10.2)
- **TK-5 [E]** An inbound completion from another VTODO client updates the frontmatter. (§10.3)
- **TK-6 [E]** Transmutation runs pre-validation. A failure of the target component type blocks the transmutation before any write. The transmutation touches zero files. (§10.4)
- **TK-7 [C]** This test covers the crash windows around the mandated order. If the crash occurs before the tombstone, Davenport writes nothing and the user can run the command again. If the crash occurs between the tombstone and the rewrite, an orphaned note stays with the "converted" annotation. If the crash occurs between the tombstone and the rewrite, and the successor stays unresolvable past the flight grace, Davenport shows the incomplete-conversion surface. That surface offers complete (a re-derived rewrite) and revert. Revert follows the §5.6 keep; after the `DELETE`, revert is a fresh push, and Davenport states it as such. If the crash occurs after both steps, normal decomposed processing follows. (row 13b, §10.4)
- **TK-8 [M]** This test covers a late successor. While the successor note is in vault-sync flight, it raises no incomplete-conversion item within grace. The arrival of the successor note resolves the check. (§10.4)
- **TK-9 [M]** This test covers a cross-device conversion. A device can observe the server deletion first. That device writes remote-observed. The annotated local-intent tombstone then arrives and upgrades by dominance. The tombstone corrects the banner to "converted, not cancelled". (§10.4, §5.6)
- **TK-10 [E]** An offline conversion queues by artifact existence. The conversion executes where it is first observed. `If-None-Match: *` and a 404 on `DELETE` make the races safe. (§10.4)
- **TK-11 [E]** Attendee-bearing events refuse conversion. (Part 6.3 row) (§10.4)
- **TK-12 [E]** A `412` on the tombstone's `DELETE` gives one prompt: retract-anyway and keep-both. Keep-both leaves the note with the successor. Keep-both also routes the revived old record to the inbox as venue-less. (§10.4, §5.6)
- **TK-13 [E]** Conversion requires a linked note. Davenport refuses a venue-routed record and states the reason. (§10.4)
- **TK-14 [E]** The command's rewrite never trips the §6.1 hand-edit guard (self-write exclusion). (§10.4, §5.3)
- **TK-15 [E]** This test covers a move to a calendar. Davenport runs pre-validation at the target. Davenport writes the tombstone first, with the "moved to" annotation. The note rewrite mints a fresh `uid`, and the test asserts that this `uid` is distinct from the old identity. The note rewrite changes `calendar:` only, and every other field stays byte-untouched. The venue pointer carries forward. The server work completes as standard tombstone processing plus a push, and the mock's request log shows delete-plus-create, never `MOVE`. (§10.4)
- **TK-16 [E/C]** Moves inherit the conversion properties. The row-13b detector reads the "moved" annotation identically. The test re-runs TK-7's crash windows under the move shape. Attendee-bearing events refuse the move. A move requires a linked note. A `412` on the `DELETE` surfaces retract-anyway and keep-both. (§10.4, row 13b)

### 5.20 Recurrence [RC] — §11

- **RC-1 [D]** Davenport computes the instances from `RRULE` for display. The materialization map keys by instance date. (§11)
- **RC-2 [D]** The closure rule applies to edits of the series `start`, `rrule`, or `timezone`, and it includes the timed↔all-day key swap. While overrides or exclusions exist, Davenport refuses these edits and states the reason. Safe fields patch. (§11)
- **RC-3 [D+E]** Davenport preserves overrides and `EXDATE`s across a round trip from day one, under modeled-field pushes. (IV-4) (§11, §5.5)
- **RC-4 [D]** Davenport renders the preserved overrides. Views apply the existing overrides and exclusions read-only. A moved instance displays as moved. (§11)
- **RC-5 [E]** Davenport honors the complete-and-respawn convention for an inbound recurring VTODO. (§11)
- **RC-6 [D]** The timezone matrix follows Part 6.5. Davenport computes DST-straddling instances and all-day instances in the event's zone. Davenport never computes them in the device's zone. (§11)

### 5.21 RSVP [RS] — §12

- **RS-1 [E]** Pending detection uses the own `ATTENDEE` with `PARTSTAT=NEEDS-ACTION`, and it matches by address. Davenport shows a banner and a Needs Response listing. (§12, §14.3)
- **RS-2 [E]** If the user sets `rsvp:` and no own-`ATTENDEE` match exists, validation fails. The failure states the alias hint. Davenport then writes nothing. (row 21, §6.2)
- **RS-3 [E]** A response is a confirm-gated server action. The buttons and the hand-edited `rsvp:` key are equivalent signals. Davenport validates the enum. (§12)
- **RS-4 [E]** The scheduling record shows that the reply reaches the organizer only after confirmation. (IV-2) (§12)

### 5.22 Property mappings [PM] — §13

- **PM-1 [E]** `alarm` maps to `VALARM` in both directions (DISPLAY, relative `TRIGGER`). The in-app notice fires at the offset while Obsidian is open (clock). (§13)
- **PM-2 [E]** Categories map to tags in both directions, with union-under-prefix and replace-within-prefix. Adversarial non-prefixed tag lists stay untouched in membership and in order (IV-3 anchor). The test exercises the per-calendar direction settings. (§13)
- **PM-3 [D]** This test covers the `transp`, `class`, `status`, and `location` mappings. Davenport preserves structured-location `X-` properties. (IV-4) (§13)

### 5.23 Interface [UI] — §14

- **UI-1 [U]** This test covers Needs Attention completeness. Construct every condition that the spec routes there. These conditions are the §14.3 enumeration (conflicts, validation failures, dangling pointers, grace divergence, remote-owned divergence, hand-edited `calendar:`/`type:`/`uid`, persisting uid-without-record, quarantines, duplicate address claims, supersession mismatches, orphan acknowledgments and move suggestions, suspended notices), plus the amendment-introduced surfaces: preservation items (§4.2, §5.4), the incomplete-conversion surface (row 13b), and feed-level anomalies (§5.2). Assert that each condition lists with a working resolve action. Every bannered condition also lists. The section renders only when it is non-empty, and it always renders first.
- **UI-2 [U]** Dismissal is per class. Flight items self-dismiss on resolution. Preservation items require acknowledgment. No item survives its condition. (IV-12) (§14.3)
- **UI-3 [U]** This test covers the sync activity. Davenport derives the pending count. No queue artifact exists anywhere on disk. The log records refusals, skips, and conflicts, and not only successes. The filters work. (§14.4)
- **UI-4 [E]** Dry-run renders the counts and the expandable item list, with zero server writes and zero vault writes. (§14.4)
- **UI-5 [E]** Pause works globally and per calendar. Paused calendars issue zero requests. Edits accumulate as dirty and push on resume. (§14.4)
- **UI-6 [E]** Snapshots precede destructive batches. A restore reproduces the pre-batch bytes exactly. Snapshots expire per the §15.2 retention setting. The test covers the boundary. (§14.4)
- **UI-7 [U]** Drag and resize in the calendar view route through the standard edit path: debounce, validation, and the attendee gate. Davenport disables drag and resize on remote-owned calendars. On an attempt on a remote-owned calendar, Davenport shows the reason, and the handle does not disappear silently. (§14.2)
- **UI-8 [U]** Davenport renders drafts dashed, `tentative` faded, `cancelled` struck, and blocks patterned. The RSVP, conflict, and validation badges are present. (§14.2)
- **UI-9 [U]** Banners are rendered UI. No banner state transition changes the note bytes. (§14.5)
- **UI-10 [U]** This test covers the codeblock views with the full parameter set (`view`, `calendars`, `venue`, `from`/`to`, `format`). The codeblock views are read-only. A click-through opens the notes. (§14.5, §7.4)
- **UI-11 [U]** This test covers the modals, the full §14.6 set. Quick-add previews the parse results live, and Esc abandons quick-add with zero writes. The attendee confirmation is not suppressible. The retraction options state their consequences. The conflict table resolves per field or wholesale. The adoption picker pins the fuzzy-match suggestions on top. The venue picker searches the notes. The dangling-pointer modal offers retract, unlink, and restore. (§14.6, §15.4)
- **UI-12 [U]** This test covers the command inventory conventions. The commands control visibility with `checkCallback`. The test samples these contexts: RSVP commands appear only with a pending or changeable `PARTSTAT`, and convert refuses attendee-bearing events. No command registers a default hotkey. (§14.7)
- **UI-13 [D]** This test covers filename sanitization: the per-platform illegal characters, the length caps, and the collision suffixes. (§14.8)
- **UI-14 [E]** Rename-on-retitle is off by default, and a remote retitle then renames nothing. When the user enables rename-on-retitle, the rename preserves identity and links. (§14.8, §3.4)
- **UI-15 [U]** This test covers the status bar: the next-event countdown, the menu actions, and the device-local toggle. (§14.5)
- **UI-16 [U]** This test covers the calendar-view interactions beyond drag and resize. When the user clicks an event, Davenport opens its materialized note or offers materialization. When the user clicks a draft, Davenport opens its note. When the user drags empty space, Davenport opens quick-add, pre-filled with the selected time and with the view's calendar context. The context menu carries the §14.2-enumerated actions. Each action is visible only where it applies. (§14.2)
- **UI-17 [U]** This test covers the agenda composition. The four sections render in §14.3's order. Today and upcoming is chronological, it honors the configured days-ahead, and it carries inline join and open-materialize actions. Inbox lists exactly the unrouted records, with assign-venue and materialize actions. (§14.3, §7.2)

### 5.24 Configuration [CF] — §15

- **CF-1 [E]** This test covers the tier discipline. Device-local view-state changes cause zero `data.json` writes. Every synced-settings change writes the revision marker. (§15.1)
- **CF-2 [E]** This test covers the tripwire. A marker ahead of the local revision surfaces the stale-settings warning. The warning names the divergent sections and calls out ownership-mode divergence. A damaged marker costs at most one wrong warning, and the next settings write corrects that warning. The marker never gates behavior and never appears in quarantine. The marker lives outside the records folder by design. (§15.1, §3.2)
- **CF-3 [U]** Onboarding runs the settings-sync check under the configured setup. The per-tool procedure follows Part 6.2's recorded facts. (§15.1, A22)
- **CF-4 [D]** The override pattern is global-plus-per-calendar everywhere. Per-event-type overrides exist only for the §8.2-named options. This is a schema assertion. (§15.3)
- **CF-5 [D]** Non-configurability is deliberate. The settings schema contains no toggle for any §15.4 item: attendee confirmation, URI write behavior, dangling-pointer auto-deletion, round-trip preservation, validation gating, and the surfacing of skips and failures. (§15.4)
- **CF-6 [D]** Every settings item states its default (schema-driven). (§15.2)

### 5.25 Integration [IG] — §16

- **IG-1 [E]** URI actions land in drafts or in confirm modals only. Any URI invocation makes zero direct server writes. (IV-1) (§16)
- **IG-2 [E]** The public API makes the ledger queries and quick-add reachable. The queries issue no writes. (§16)
- **IG-3 [E]** This test covers the Full Calendar importer. The fixture vault converts to correct drafts and adoption suggestions. (§16)
- **IG-4 [E]** This test covers the ICS export of a calendar and of a filtered projection. The exports re-import cleanly. The exported bytes contain no secrets and no sync state. (IV-6) (§16)
- **IG-5 [E]** A drop of an `.ics` file and the Import ICS command both offer parse-to-draft through the same path. A bare file offers no reply flow. (§16, §14.7, §12)

### 5.26 Stage-interim behavior [SI] — §18

- **SI-1 [E]** The stages 2–3 interim rule is this: Davenport defers and flags inbound changes to notes in the local dirty set. Davenport never applies these changes over dirty local state. This test exists only in stage-2/3 builds. The Part 5.10 suite replaces this test when three-way comparison lands in stage 4. (§18)
- **SI-2 [E]** This test is the stage-1 read-only assertion. The stage-1 build (feeds only) issues no non-GET request of any kind, across every stage-1 suite run. (§18, §5.2)

## Part 6 — Matrices and verification protocols

### 6.1 Appendix A verification protocol [V]

Each item produces a recorded fact in the versioned recorded-facts document. The fact has four parts: the date, the environment and versions, the fact itself, and the branch taken. No item is pass/fail. Every outcome lands on the branch that the design spec states in advance. Item 11 runs first. Item 24 runs second. The other items run before the stage that consumes them (Part 8).

- **A-11** — `processFrontMatter` byte determinism. Procedure: write a note-fixture corpus (comments, key orders, quote styles, nested values) through `processFrontMatter`. Then compare the outputs byte for byte. Do these two steps in each cell of the minimum matrix. The minimum matrix is the current Obsidian API version on macOS. A previous-version cell is not required. Add platforms and versions when they are available. Part 8 states the re-verification trigger for this item. Branch: if determinism holds, record the fact, and the [E]/[M] fakes stand validated. If determinism fails, the designated-writer redesign is necessary **before stage 2**. This item is the only item in the appendix where a failure causes a design change (§5.4, A11).
- **A-24** — precondition enforcement per provider. Procedure: send a `PUT` with a stale `If-Match` and expect `412`. Send `If-None-Match: *` against an existing resource and expect `412`. Check ETag stability across fetches. Do these three steps on iCloud, Fastmail, Nextcloud, Radicale, Baïkal, and Google CalDAV. Branch: document the providers that do not enforce the preconditions. The §14.4 trust caveat then becomes active (PU-6) (§5.5).
- **A-1** SecretStorage at rest: inspect the desktop storage after you store a secret. Branch: the §4.3 warning posture, and the SC-5 README gate. **A-2** `requestUrl` with self-signed certificates (LAN Nextcloud). Branch: the onboarding documentation. **A-3** RFC 8607 probe per provider. Branch: the DA-7 inline fallback. **A-4** `X-ALT-DESC` rendering in current Outlook, Apple, and Google clients. Branch: the §9.3 option stays gated. **A-5** iCloud sync-token support and discovery redirects. Branch: the expected fallback frequency, and the LP-3 live confirmation. **A-6** Plugin-id collision check at submission. **A-7** SecretStorage cross-device travel. Branch: the LC-10 credentials-absent path is the designed degradation. **A-8** Google RFC 6578 support. Branch: the §5.1 fallback on Google. **A-9** Google verification requirements. Branch: the v2 stretch gate only. **A-10** Google iTIP behavior on `ATTENDEE` writes (test account, observe mail). Branch: assume that the gate is maximally live until you record a different fact.
- **A-12** External-modification events, and the Obsidian Sync replace-unmerged behavior on fresh files: make scripted external changes while Davenport runs; capture the events. Branch: the §5.3 flight machinery, and materialization racing. **A-13** `requestUrl` redirect handling, large-body mobile behavior, and `tsdav` under sustained load. Branch: the onboarding limits, and the attachment-cap default. **A-14** Obsidian Sync diff-match-patch applied to record files: make real concurrent record edits; capture the merge outputs into the mangle corpus. Branch: LG-8 must catch every captured mangle. This fact is a design input to quarantine. **A-15** mtime preservation per tool. Branch: the grace tuning, and the prompt copy. **A-16** Byte-stable `GET`s versus re-serialized `GET`s per provider. Branch: normalization handles both forms (LG-3); record the fact. **A-17** `saveLocalStorage` capacity. Branch: the DL-3 routing thresholds. **A-18** Excluded Files versus Bases and Dataview per the current Obsidian version. Branch: the LG-14 documentation. **A-19** Emitter stability across plugin builds N/N+1. Branch: the version stamp (LG-4) is the consequence of this fact. Verify the assumption that the stamps are necessary. **A-20** Conflict-copy filename patterns per tool. This fact feeds the LG-7 corpus. **A-21** Rename delivery per tool. This fact feeds the TS-10/TS-11 harness modes. **A-22** `data.json` travel per tool × configuration (Obsidian Sync toggles and defaults, git conventions, Syncthing filters). This fact feeds the CF-2/CF-3 expectations. Branch: the §15.1 tripwire, and its recorded escalation. **A-23** UID presence and stability across real feed generators and repeated fetches. This fact feeds FD-7 realism and the threshold defaults. **A-25** UID property-filter support per provider. This fact feeds the ID-6 degraded form. **A-26** WebDAV `MOVE` support per provider, and whether a `MOVE` on scheduling-enabled collections stays silent to attendees. Branch: this fact gates the §10.4 atomic-move optimization only. No shipped behavior depends on it. Until you record the fact, the attendee-bearing refusal stands unconditionally (TK-16).

Provider facts table. The columns are the A-items that own the facts:

| Provider | 6578 tokens (A5/A8) | ETag stable (A24) | `If-Match` (A24) | `If-None-Match:*` (A24) | RFC 8607 (A3) | UID filter (A25) | Byte-stable GET (A16) | iTIP on write (A10/§5.5) | Redirects (A13) | WebDAV `MOVE` (A26) |
|---|---|---|---|---|---|---|---|---|---|---|
| iCloud / Fastmail / Nextcloud / Radicale / Baïkal / Google CalDAV | record | record | record | record | record | record | record | record | record | record |

### 6.2 Sync-tool facts matrix

Record these facts for Obsidian Sync, Syncthing, iCloud Drive, and git: the conflict-copy filename pattern (A20), the merge behavior on records (A14), the rename delivery (A21), the mtime preservation (A15), and the `data.json` travel per configuration (A22). Every recorded fact feeds two things: the harness configuration (Part 3.2), and the CF-3 onboarding procedure per tool. The harness configuration lets the [M] suites replay realistic delivery.

### 6.3 Attendee-gate matrix

Rows: create-with-attendees; add attendee; remove attendee; change `start`/`end`; change `duration`; change `rrule`; change `timezone`; timed↔all-day swap; delete event; edit summary; edit location; edit description; §9.5 refresh; RSVP write; transmutation or move attempt. Columns: bidirectional manual push; vault-owned manual; vault-owned auto-push-on-valid; drag/resize (§14.2); execute-anywhere second device (§6.1). Assertion per cell: the confirmation comes before the write, and the scheduling record stays clean until the confirmation occurs. Transmutation and moves are the exception to this assertion: they **refuse** (TK-11, TK-16). The gate is a predicate; the gate is not this list. The matrix is a floor. The property obligation IV-2 runs over generated operations that go beyond the matrix (§5.5).

### 6.4 Conflict-branch matrix (§5.4)

The rows are the local state. The columns are the remote state. Each cell names the outcome and the covering tests.

| local \ remote | unchanged | changed, different field | changed, same field, same value | changed, same field, different value |
|---|---|---|---|---|
| equals base | steady state; nothing (row 5; IV-9) | apply (IN-1, IN-2) | apply ≡ converge (IN-1) | apply (IN-1) |
| changed, not dirty | inert → grace (CD-6) | remote field applies; local divergence → grace (IN-1 + CD-6) | convergence, silent (IN-6) | apply + preservation item (IN-3) |
| changed, dirty | push (IN-4) | silent merge, both survive (IN-5) | convergence, silent (IN-6) | conflict surfaced (IN-7) |

### 6.5 Timezone matrix (RC-6, FM-4)

Zones: `America/New_York`, `Europe/London`, `Asia/Kolkata` (+:30), `Australia/Lord_Howe` (:30 DST), `Pacific/Apia` (dateline history), `UTC`. Cases per zone, where the case applies: a timed event across spring-forward and across fall-back; a recurring series that crosses both transitions; a nonexistent local time (spring gap) and an ambiguous local time (fall overlap); all-day stability across the transitions; emission of a zone that never arrived inbound (bundled tzdata, §2.2); round-trip of inbound historical `VTIMEZONE` definitions.

### 6.6 Scale matrix (HZ-7) [L]

Ledger sizes: 100, 1,000, and 5,000 records (in-envelope), and 10,000 records (out-of-envelope). For 10,000 records, document the degradation and verify the levers (§5.7). Operations: cold-start index build; steady-state loop wall time with **zero** writes (IV-9 under load); full CTag-fallback diff; month calendar render; agenda render; Dataview query presence. Evidence: recorded baselines with regression gates. The envelope claim has two parts: the in-envelope sizes stay within interactive tolerance, and the churn stays zero.

## Part 7 — Appendix B row coverage

Every row of the state table in the design spec maps to covering tests. Some rows resolve to existing rules, and B.3 marks these rows. These rows also get their tests, because the resolution claim is itself an assertion.

| Row | Tests | | Row | Tests |
|---|---|---|---|---|
| 1 | CD-1 | | 16 | LG-10 |
| 2 | LC-1 | | 16b | LG-11 |
| 3 | LC-2 | | 17 | AD-1 |
| 4 | PU-2, ID-7, PU-8 | | 18 | ID-3 |
| 5 | CD-6, IN-4, IV-9 | | 19 | AD-3 |
| 6 | IN-1, IN-3, IN-6, IN-7, IN-11, IN-12 | | 20 | ID-8 |
| 7 | VN-1 | | 21 | RS-2 |
| 8 | ID-5, ID-6 | | 22 | RG-5 |
| 9 | LC-4 | | 23 | TK-3 |
| 10 | LC-5 | | 24 | TS-11, VN-7 |
| 11 | LC-6 | | 25 | IN-9 |
| 12 | TS-1, TS-2, TS-3 | | 26 | LC-9 |
| 13 | TS-6 | | 27 | LC-9 |
| 13b | TK-7, TK-8, TK-16 | | 28 | LC-7 |
| 14 | TS-7, TS-8 | | 29 | LC-7 |
| 15 | TS-9 | | 30 | TS-13 |
| | | | 31 | TS-14 |
| | | | 32 | FD-10 |

## Part 8 — Ordering and stage gates

Verification order: A-11 runs before the other appendix items. A-11 also runs before the implementation work that writes note frontmatter through the API that A-11 verifies. That work is the frontmatter emission, the materialization, and the engine that drives them. That work is where stage 1 first writes user notes through `processFrontMatter`. The rest of stage 1 proceeds and does not wait for A-11. The failure branch of A-11 is the only design change in the appendix, and that branch gates stage 2. A-24 runs second. The reason is this: a server that does not enforce preconditions silently removes a named backstop, and the plan must know where that backstop is real before push ships. The remaining items land before the stage that consumes them, as the mapping in Part 6.1 shows.

Stage gates align with the roadmap (§18). A stage ships when two conditions are true: the listed suites of the stage pass, and the recorded facts include the verification items that the stage consumes:

- **Stage 1 (feeds, read path):** FM complete except FM-5 (push-creation), LG, DL-3, ID-1..ID-6, FD complete, VN complete except VN-9 (scoped quick-add), TP-1..TP-6, RC-1/RC-4/RC-6 (display), TS-6/TS-7 (read halves — acknowledgment, claimant-gated retention, revival), CD-8 (the exemption over the orphaned conditions that stage 1 produces and the suspended conditions that stage 1 produces), AD-3 (the materialization-map half), IN-13 (the materialization content hash written at creation, which the stage 3 remove discriminator reads), UI-1/2/8/9/10/13/15/17 (read-side), UI-16 (read subset), CF-1/CF-2, CF-3 (the check itself; the per-tool procedure of CF-3 lands with stage 3), SC-5 (the README half, which makes no encryption-at-rest claim; the setup-guide half lands with stage 6), SI-2 (the whole build issues no non-GET request), the applicable IV sweeps, which include IV-13. Consumes: A-6, A-14, A-16, A-18, A-19, A-20, A-22, A-23.
- **Stage 2 (CalDAV pull):** LP, HZ (including HZ-8), AD-1..AD-4, RG-1..RG-3/RG-5/RG-7..RG-10, TP-7, CD-1/CD-3 (the dirty set ships here), SI-1, DL-1, ID-8, SC-1/SC-2. Consumes: **A-11 (gate)**, A-5, A-8, A-12, A-13, A-15, A-16, A-21, A-25.
- **Stage 3 (push, trust surface):** PU (with the stage-3 variant of PU-7, and PU-8), ID-7 (the creation race), FM-5, the write-serialization half of LP-7, the `If-Match` half of HZ-6, TS (including TS-15), LC, AD-5, CD complete, DA, PM, TP-8..TP-10, VN-9, RG-4 (vault-owned behavior: auto-push-on-valid ships with push), IN-8/IN-13/IN-14 (remote-deletion handling ships with tombstones), UI complete, CF complete, IG, the Part 6.3 gate matrix, IV-1/2/4/6/8 at full strength. Consumes: A-1, A-2, A-3, A-4, A-17, **A-24**.
- **Stage 4 (conflicts):** IN complete, and Part 6.4 fully exercised; SI-1 retired; the preservation items (IN-3, RG-6, DL-2), and the conflict UI (the UI-11 table, plus the stage-4 variant of PU-7, which replaces the stage-3 behavior); IV-10/IV-12 at full strength.
- **Stage 5 (tasks, transmutation, moves):** TK complete (including TK-15/TK-16), and RC-5 (inbound complete-and-respawn, which is task machinery and not exception editing), including the [C] crash suite. Consumes: A-26 (an optimization gate only; it does not block).
- **Stage 6 (Google):** SC-3/SC-4, the setup-guide half of SC-5 (the production-status instruction), and the Google column of every provider matrix. Consumes: A-7, A-9, A-10.
- **Stage 7 (recurrence exceptions, RSVP, pipeline):** RC complete (the RC-1/RC-4/RC-6 display is already live from stage 1, the RC-3 preservation is live from stage 3, and the RC-5 inbound respawn is live from stage 5; what lands here is exception *editing*), RS complete, and any deferred DA items.

The facts document records the re-verification triggers. Re-verify the platform items (A-1, A-7, A-11, A-12, A-17, A-18) on each Obsidian minor release. Re-verify the provider items on an observed regression, and at least one time each year. Re-verify the sync-tool items on each tool major version. A changed fact re-routes to its pre-stated branch. A fact with no branch is a design gap: it goes back to the design spec before the code changes.
