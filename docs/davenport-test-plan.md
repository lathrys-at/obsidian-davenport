# Davenport — Test Plan Specification

Companion to the Davenport design specification. Every `§`, row, principle, and Appendix A reference points into that document; "row N" means Appendix B's state table. This plan specifies the required tests by shape, behavior, and assertion. It does not prescribe framework, file layout, or naming inside the test suite — those are implementation choices — but the assertion set is normative: an implementation is not done until every test here passes or every verification item here is recorded.

Maintenance rule, mirroring the design spec's own (B.3): any future spec change owes this plan its tests before it ships.

The rule runs downward and inward as well. An issue whose milestone disagrees with the stage Part 8 assigns one of its tests owes Part 8 the reassignment before that issue is worked — issue authoring is where fine-grained staging is decided, and the milestone gates are copied from these stage lists, so a stale list is a stale definition of done. A capability Part 2 names in a shape's definition owes Part 3 a requirement stating it before that shape's tests are gated — Part 3 is the checklist a harness gate certifies against, so a capability absent from it is a shape nothing can report as unrunnable.

## Part 1 — Conventions

- Every test carries a stable ID, a shape tag (Part 2), and the design-spec references its assertions trace to. The coverage map (Part 7) references these IDs.
- Assertions are phrased as externally observable behavior: files written or provably not written, requests issued or provably not issued, request counts and ordering, surfaces raised and dismissed, log entries, byte comparisons. "Never" assertions are standing obligations and run as sweeps (Part 4) across every simulation in this plan, not as single cases.
- Unstated configuration means design-spec defaults. Stated defaults are test inputs — grace period 10 minutes (§5.3), horizon −3/+12 months (§5.7), delta granularity one day (§5.7), mass-vanish threshold more-than-¼ and at-least-5 (§5.2), retention windows (§15.2) — and every threshold gets boundary tests from both sides.
- Appendix A items are not pass/fail tests. They are verification protocols producing recorded facts, each landing on the branch the design spec pre-states (Part 6.1). The recorded-facts document is versioned with the plugin and names its re-verification triggers.
- Where a test is an "anchor" for a sweep, it constructs the sweep's most direct violation opportunity; the sweep itself still runs everywhere.

## Part 2 — Test shapes

- **[D] Deterministic unit.** Pure functions, no I/O, no clock: parsing, serialization, normalization, digests, checksums, validation, render pipeline, instance computation, identity keys. Evidence: byte-level equality wherever the spec claims determinism.
- **[E] Engine simulation, single device.** The full sync engine against the mock CalDAV server and feed fixture (Part 3), a fake vault, a controlled clock. Evidence: request logs, vault file states, record bytes, surface and log inventories.
- **[M] Multi-device simulation.** Two or more engine instances, each with isolated device-local state, sharing a simulated vault-sync channel with controlled delivery (Part 3.2) and one mock server. Evidence: convergence to identical vault bytes, per-device write counts, per-device surface behavior.
- **[C] Crash and fault injection.** [E]/[M] with kill points between individual file writes, truncated responses, mid-loop network failure, and process restart. Evidence: every post-restart state is a state the design spec defines, and the specified surface appears.
- **[V] Live verification.** Appendix A execution against real providers, sync tools, and Obsidian builds. Evidence: recorded facts routed to pre-stated branches.
- **[U] Interface behavior.** Views, banners, modals, commands. Automated where the plugin test harness reaches them; otherwise scripted manual checklists carrying the identical assertions. The assertion set is normative either way.
- **[L] Load and benchmark.** Envelope magnitudes (§5.7) against startup, sync-loop, and render costs; write-churn counting at steady state.

## Part 3 — Harness requirements

Every capability below is load-bearing for at least one test in Part 5.

### 3.1 Mock CalDAV server
Configurable per run: RFC 6578 sync-token support on/off and token rejection on demand; CTag behavior; `If-Match` / `If-None-Match: *` enforcement on/off (the §5.5 branch); ETag stability vs per-fetch change; byte-stable vs re-serialized `GET` bodies (§3.2 normalization, A16); `supported-calendar-component-set` per collection; `calendar-query` UID property-filter support on/off (§3.4, A25); RFC 8607 managed attachments on/off (§9.4, A3); a scheduling record — a ledger of which writes *would* have generated iTIP messages, so gate tests assert against the record and never against real mail (§5.5); discovery tree with redirect injection (A13); response truncation and 5xx injection; a full request log with ordering and counts.

### 3.2 Vault-sync simulator
Delivers file changes between simulated devices with: controlled order and latency (record before note; note before record); conflict-copy generation per tool filename pattern (A20's recorded facts feed the pattern corpus); merge-mangle injection modeling line-level auto-merge damage (§3.2 quarantine, A14); rename delivered as rename or as delete-plus-create (A21); mtime preservation toggle (A15).

### 3.3 Feed fixture
Serves ICS with: per-fetch `DTSTAMP` churn; UID omission, in-feed duplication, and per-fetch re-minting; truncation mid-file; login-wall HTML; valid-but-empty `VCALENDAR`; decade-spanning corpora; controllable per-poll content deltas.

### 3.4 Obsidian API fake, and the real-API split
[D]/[E]/[M] shapes run against a fake of `metadataCache`, vault events, and `processFrontMatter` whose byte behavior is deterministic by construction. The harness poisons global `fetch` in every [E]/[M]/[C] run so that any network call not routed through `requestUrl` — including `tsdav`, which must run on the injected transport — fails loudly (IV-13). Determinism of the *real* `processFrontMatter` is exactly Appendix A item 11 and is never assumed by the fake; item 11 gates stage 2 (Part 8).

### 3.5 Clock and corpus
A controllable clock driving debounce, grace periods, horizon edges, delta granularity, and retention. An adversarial ICS corpus: fuzzed unmodeled `X-` properties, foreign `VALARM`s, structured locations, legal-but-exotic folding and escaping, `VTIMEZONE` variety including historical zones, `RECURRENCE-ID` overrides and `EXDATE`s. Used by IV-4, normalization tests, and round-trip suites.

### 3.6 Vault-write interruption and restart
The kill points inside a vault write and the process lifecycle around it, the other two capabilities Part 2 defines [C] by. A write and its change event are separable: drop the write, drop the event, or deliver the two out of order. The engine restarts against the vault and device-local state as an interrupted run left them, rehydrating and re-deriving rather than resuming — nothing carries across the restart that was not on disk. Where a crash can land between two writes, which write goes first is a design decision, not an implementation accident (§5.4), so the mandated orders need a facility that can land a crash between them. Load-bearing for CD-9, CD-10, IN-12, IN-14, PU-8, TS-10, TK-7, and TK-16 — the tests whose setup or assertion is a vault state no running process observed — and for every [C] run's standing obligation that the post-restart state is one the design spec defines (Part 2).

## Part 4 — Invariant sweeps

Standing assertions evaluated across every [E]/[M]/[C] run in this plan. A sweep failure anywhere fails the run that produced it. Each traces to a principle (§1) or a stated prohibition.

- **IV-1 Presence is never intent (principle 3).** No server write occurs without its named signal: push requires dirty ∧ mode (§5.3, §4.2) or `ready` execution (§6.1); `DELETE` requires a local-intent tombstone (§5.6); RSVP, refresh, and transmutation require their commands (§12, §9.5, §10.4). Property obligation: generated operation sequences containing no signal produce zero server writes.
- **IV-2 Attendee gate (§5.5).** Every `PUT`/`DELETE` whose resource has, would gain, or would lose `ATTENDEE` is preceded by a recorded confirmation — every mode, every path, including auto-push-on-valid (§4.2), drag/resize (§14.2), refresh (§9.5), and RSVP (§12). The mock's scheduling record contains no unconfirmed would-notify write, ever.
- **IV-3 Declared fields only (principle 2).** Engine note writes touch only declared keys and channels; the body is never a sync surface outside them; templates fire once (§8.1); the sole sanctioned write into non-Davenport frontmatter is prefix-scoped tags (§13), which never adds, removes, or reorders tags outside the prefix.
- **IV-4 Round-trip preservation (§5.5).** Under the adversarial corpus, every unmodeled property survives arbitrary sequences of modeled-field pushes, compared on normalized bytes.
- **IV-5 Storage discipline (§3.1, §3.2).** No `etag`, href, hash, or base-snapshot material ever appears in note frontmatter; no per-device fact and no friendly calendar name ever appears in a record.
- **IV-6 Secrets (§4.3).** No credential material in frontmatter, records, logs, or exports, at maximum log verbosity.
- **IV-7 Nothing silently skipped (principle 5).** Every refusal, skip, and failure emits a log entry (§14.4), and every condition §14.3 routes also raises its surface.
- **IV-8 Remote-observed tombstones never write (§5.6).** Processing a remote-observed tombstone issues zero server requests in every reachable sequence.
- **IV-9 Zero-churn convergence (§3.2).** Devices holding identical server state hold byte-identical records and perform zero writes per loop at steady state.
- **IV-10 No silent last-writer-wins (§5.4, §6.3).** Dirty same-field three-value conflicts and pointer/map supersessions always surface; no path resolves either silently.
- **IV-11 Mode gating (§4.2, B.2).** No push-capable action is reachable on a remote-owned calendar; feed calendars are remote-owned unconditionally.
- **IV-12 Surface lifecycle (§14.3).** Flight-skew items self-dismiss when their condition resolves; preservation items (§4.2, §5.4) resolve only by acknowledgment; no item outlives its condition.
- **IV-13 Network discipline (§2.2).** Every network call routes through `requestUrl` — CalDAV servers send no CORS headers, so a stray `fetch` is a mobile-only breakage discovered in the field. Enforced two ways: the harness poisons global `fetch` in every simulated run (Part 3.4), and a static scan of the shipped bundle finds no direct `fetch` usage.

## Part 5 — Suites

Suites mirror the design spec's sections. Each test: ID, shape, behavior with assertions, references.

### 5.1 Frontmatter and schema [FM] — §3.1

- **FM-1 [D]** Full key-vocabulary parsing, including `duration` forms (`30m`, `1h30m`) and ISO 8601 variants with and without offsets.
- **FM-2 [D]** `date` alongside `start`, and `end` alongside `duration`, each fail validation naming both keys (§3.1, §6.2).
- **FM-3 [D]** All-day serialization: inclusive `endDate` → exclusive `DTEND` for single-day, multi-day, and month-boundary events — the off-by-one is the point (§3.1).
- **FM-4 [D]** Timezone resolution order: explicit offset/`Z` beats `timezone` key beats calendar default; emission carries `TZID` with `VTIMEZONE`; with the device zone set to differ from all three inputs, the emitted zone equals the resolved zone — never silently local (§3.1, §2.2).
- **FM-5 [E]** `summary` defaults from filename once at push-creation; renaming the live note afterward marks nothing dirty and pushes nothing (§3.1, §14.8).
- **FM-6 [E]** Inbound timed↔all-day switch is shape-exclusive: a single write event removes the departing shape's keys and adds the arriving ones (§3.1).
- **FM-7 [D]** `status` and `state` disjoint: `status: cancelled` passes its vocabulary, renders struck (§14.2), never touches lifecycle; `state` never serializes to the server (§3.1, §13).
- **FM-8 [E]** Materialization always writes explicit `summary` and `calendar:` (§8.1, §3.4).

### 5.2 Record ledger [LG] — §3.2

- **LG-1 [D]** Record filename equals the digest of (collection href, UID); the pair is stored inside; the digest is filename-safe against §14.8's per-platform illegal sets.
- **LG-2 [D]** Byte determinism: two independent engine instances computing a record from identical (server state, venue pointer, materialization map and content hash, tombstone) produce identical bytes; write-if-changed performs zero writes on match.
- **LG-3 [D]** Normalization: byte-different but semantically identical server ICS (re-serialized, re-folded, property-reordered, per corpus) normalizes to identical record bytes (§3.2, A16).
- **LG-4 [E]** Version-stamp skew: an older-stamped device reading a newer-stamped record with byte-only differences suppresses its rewrite; the newer device rewrites once; no ping-pong across ≥10 alternating loops (§3.2, A19).
- **LG-5 [M]** Two-channel convergence: a stale device's own fetch fast-forwards its record to identical bytes (zero vault-sync conflict); its linked note is corrected by the other device's arriving copy — assert the stale device's engine performed no note write (§3.2).
- **LG-6 [E]** Quarantine (a): unparseable and schema-invalid records quarantine, surface, and are excluded from every consumer — enumerate: views, inbound locate, push, adoption, routing (§3.2).
- **LG-7 [E]** Quarantine (b): filename ≠ contained identity quarantines; every conflict-copy pattern in the A20 corpus trips it.
- **LG-8 [E]** Quarantine (c1): merge-mangled records fail the self-checksum on every device at every version stamp; (c2): a checksum-surviving mangle fails recompute at equal stamp (§3.2, A14).
- **LG-9 [E]** Checksum verifies with the checksum field blanked, and an older-version device verifies a newer-stamped record without recomputing the canonical form (§3.2).
- **LG-10 [E]** Rebuild, resource present: re-fetch → live record; suspended-era dirty entries evaluate normally — push per mode, or conflict (row 16, B.1).
- **LG-11 [E]** Rebuild, resource absent: `404` → rebuilt record is a remote-observed tombstone, note becomes orphaned, accumulated dirty goes inert. Run against a setup near-identical to LG-10's to demonstrate the branches cannot fall through each other (row 16b).
- **LG-12 [E]** Conflict-copy records differing only in tombstone type auto-resolve by dominance with no surfacing (§3.2, §5.6).
- **LG-13 [E]** Records are machine-owned: a hand edit is overwritten wholesale or quarantined on the next loop, never merged (§3.2).
- **LG-14 [U]** Onboarding's excluded-files button adds the records folder; documentation of the Bases/Dataview trade-off follows A18's recorded fact (§3.2).

### 5.3 Device-local state [DL] — §3.3

- **DL-1 [M]** Cursor isolation and regenerability: each device syncs on its own tokens; wiping one device's device-local state and re-syncing converges to identical record bytes with zero server writes and zero wrong note writes.
- **DL-2 [M]** Dirty-set loss degrades to a question: wipe the dirty set with genuine divergence outstanding → no push; grace surfacing after the period; with a same-field remote overlap → §5.4 preservation item instead of silence (§3.3, §5.3, §5.4).
- **DL-3 [E]** Storage capacity: bulk device-local data routes per A17's recorded limits (IndexedDB for bulk); loss of the IndexedDB cache is regenerable to identical state (§3.3, §2.2).

### 5.4 Identity [ID] — §3.4

- **ID-1 [D]** Template-supplied `uid` rejected by validation (§3.4, §8.1).
- **ID-2 [E]** Resolution requires `calendar:` + `uid`: one UID synced in two collections yields two records; a note resolves unambiguously to one.
- **ID-3 [E]** Two notes, one identity: detected; the newer file is stripped to draft with fields kept; the older is untouched; the rule never applies to record files (row 18, §3.2).
- **ID-4 [E]** Rename does not disturb identity; the record pointer follows the rename event (§3.4).
- **ID-5 [E]** `uid` without record is inert — never pushed, never re-created, never offered adoption; when a record for that identity later appears, an adoption suggestion is raised, never an auto-bind (§3.4).
- **ID-6 [E]** Persistence past grace surfaces with the three named actions: UID-filter server lookup (found → adoption suggestion; not found → nothing to link), strip-to-draft, strip identity. Filter-unsupported server → "lookup unavailable," never a false not-found (row 8, A25).
- **ID-7 [M]** Creation race: two devices execute `ready` for one UID; exactly one `201`; the `412` loser fetches and converges; one server resource, byte-identical records (§3.4, §5.5, row 4).
- **ID-8 [E]** Same UID live in two synced collections with `ATTENDEE` data both sides: two distinct records; invited-copy relationship surfaced informationally, not modeled (row 20, §3.2).

### 5.5 Registry and ownership [RG] — §4.1–§4.2

- **RG-1 [E]** Discovery: `PROPFIND` walk from `/.well-known/caldav` through principal and calendar-home-set; `supported-calendar-component-set` read; task lists enumerated first-class (§4.1, §10.2).
- **RG-2 [D]** Unresolvable `calendar:` fails validation legibly, naming the value (§4.1).
- **RG-3 [E]** Newly added CalDAV calendars default to remote-owned (§4.2).
- **RG-4 [E]** Vault-owned: remote changes handled per the per-calendar setting (both values exercised); auto-push-on-valid pushes valid divergence without `ready` — the option exists on vault-owned only (assert absent elsewhere) and the attendee gate still fires per write (IV-2 anchor) (§4.2).
- **RG-5 [E]** Remote-owned: push transitions absent and the UI says so; `state: ready` → visible warning; `state: draft` → no warning (row 22) (§4.2).
- **RG-6 [E]** Remote-owned dirty divergence: immediate surfacing with revert and copy-out; the next inbound overwrites; the item preserves displaced values and resolves only by acknowledgment (§4.2, §14.3).
- **RG-7 [M]** Remote-owned not-dirty divergence: vault-sync flight skew never prompts; when the grace prompt fires it has no push action (§4.2, §5.3).
- **RG-8 [E]** Feed calendars are remote-owned with no configuration path to change it (IV-11) (§4.2).
- **RG-9 [E]** Ownership-mode change on a registered calendar flips behavior without record churn (zero record rewrites attributable to the mode change) (§4.2, §3.2).
- **RG-10 [E]** Registry rename: renaming a calendar's friendly name rewrites zero records — names resolve from the href at read time (§3.2) — while views, validation messages, and note `calendar:` resolution reflect the new name; notes carrying the old name fail validation naming the value (§4.1).

### 5.6 Secrets and OAuth [SC] — §4.3–§4.4

- **SC-1 [E]** SecretStorage used when available; `data.json` fallback carries the persistent settings warning on older versions (§4.3).
- **SC-2** IV-6 anchor: full-verbosity logs, exports, records, and frontmatter from every other suite scanned for credential material.
- **SC-3 [E]** OAuth against a mock IdP: Authorization Code with PKCE, transient loopback listener opens and closes, token refresh through `tsdav`, refresh token stored per §4.3 (§4.4).
- **SC-4 [U]** Mobile: authorization stated unavailable; post-authorization mobile behavior follows A7's recorded fact into §6.1's credentials-absent path (§4.4).
- **SC-5 [release checklist]** README makes no encryption-at-rest claim until A1 records support (§4.3); the Google setup guide instructs publishing the OAuth app to production (unverified) status, naming the seven-day Testing-status token expiry (§4.4).

### 5.7 Sync loop [LP] — §5.1

- **LP-1 [E]** Incremental happy path: token REPORT → changed hrefs → one `calendar-multiget` → §5.4 apply → token advance. Request counts asserted.
- **LP-2 [E]** A reported href with no record mints one — in-horizon and out-of-horizon variants (§5.1, §5.7).
- **LP-3 [E]** Token rejection: CTag unchanged → no query (cheap exit); CTag changed → horizon `calendar-query`, diff scoped to in-horizon records; out-of-horizon records untouched (no reads, no writes against them) (§5.1).
- **LP-4 [E]** Absence confirmation, `200` branch: a reschedule across the horizon boundary since the last good sync produces no tombstone; the record updates to the moved time and is excluded from subsequent fallback diffs (§5.1, §5.7).
- **LP-5 [E]** Absence confirmation, `404` branch: a true deletion mints the remote-observed tombstone (§5.1).
- **LP-6 [E]** Confirmation is one batched `calendar-multiget` over the whole absent set — request count is 1 regardless of set size (§5.1).
- **LP-7 [E]** Injected failures back off exponentially; writes to one server are strictly serialized; reads are batched (§5.1).

### 5.8 Feeds [FD] — §5.2

- **FD-1 [E]** `DTSTAMP`-per-fetch churn across repeated polls: zero record rewrites (content-hash marker).
- **FD-2 [D]** `SEQUENCE` tiebreaker: equal content hash with bumped `SEQUENCE` applies as a change.
- **FD-3 [E]** Parse gate: truncated ICS and login-wall HTML are discarded whole — one log line, zero diff, zero tombstones (§5.2).
- **FD-4 [E]** Horizon clip: a decade-spanning feed mints records only for in-horizon events, stably across polls (§5.2, §5.7).
- **FD-5 [E]** Unclipped existence: an event outside the window but present in the file is never tombstoned; an event rescheduled outward across the boundary is retained, not tombstoned, and updates when the window covers it again (§5.2).
- **FD-6 [E]** Threshold boundaries: hold requires vanished > ¼ of the feed's records AND vanished ≥ 5. Exercise: exactly ¼ (proceed), above ¼ with 4 events (proceed), above ¼ with 5 (hold) (§5.2).
- **FD-7 [E]** Instability branch: per-fetch re-minted UIDs → vanish/appear content-pairing succeeds → one anomaly offering the sticky per-feed switch to content-derived identity; accepting re-keys the feed's records in one poll — no per-event banners, no tombstones for the re-keyed set, venue pointers and materialization entries transferred along the pairing; unmatched events fall out as ordinary vanish-plus-appear under the new identity; subsequent polls are stable with zero churn (§5.2, A23).
- **FD-8 [E]** Outage branch: valid-but-empty `VCALENDAR` → 100% vanish → hold with one anomaly and zero per-event banners; the restoring poll clears the hold silently (§5.2).
- **FD-9 [E]** Held tombstones apply only on the user's explicit accept, which then produces the per-event remote-observed tombstones and typed banners (§5.2).
- **FD-10 [E]** Genuine vanish below threshold: remote-observed tombstone, feed-typed banner, and zero server requests (IV-8) (row 32, §5.2, §5.6).
- **FD-11 [D]** Synthesized identity for UID-less events is stable across byte-identical re-serves; an edit is a vanish-plus-appear, and continuity loss is asserted — pointer and materialization do not transfer (§5.2).
- **FD-12 [E]** Duplicate UIDs within one feed: disambiguated by content hash, both records live, the feed-level anomaly raised once (§5.2).
- **FD-13 [E]** Feed records refuse push on every path; the refusal states the reason (§5.2, §4.2).

### 5.9 Local change detection [CD] — §5.3

- **CD-1 [E]** Watcher scope: only notes bearing `uid` or `state` are observed; plain notes — including acknowledged notes with event fields intact — are unwatched (row 1, B axes).
- **CD-2 [E]** Debounce: an edit burst produces one batched push after editor idle (§5.3).
- **CD-3 [E]** Self-write exclusion by expected-content matching: inbound application, adoption backfill, and `state`-strip never enter the dirty set. Both misattribution directions constructed and shown benign: a user edit byte-identical to expected content is swallowed and later takes the surfaced path; a self-write mistaken for a user yields dirty-over-zero-divergence and pushes nothing (§5.3).
- **CD-4 [E]** Generation stamps: an edit during push flight survives clear-on-success and pushes next loop — no lost update, no downgraded prompt (§5.3).
- **CD-5 [E]** Dirty entries clear when the divergence disappears (hand revert) (§5.3).
- **CD-6 [M]** Not-dirty divergence held inert; at grace expiry (clock-driven, boundary both sides of the configured value) it surfaces with per-field values and inspect as default; a late-arriving file resolves it and the item self-dismisses without a click (§5.3, IV-12).
- **CD-7 [E]** Derived-content divergence is exempt from grace surfacing and participates only when a push is already occurring — dirty declared fields or the refresh command (§5.3, §9.5).
- **CD-8 [E]** Orphaned and suspended notes are exempt from grace surfacing; the banner is their surface (§5.3, B.1).
- **CD-9 [E]** External edits while Obsidian was closed (files changed before startup): no dirty entry; the surfaced path, never an auto-push (§5.3).
- **CD-10 [E]** The pending set is derived: kill and restart mid-cycle with the dirty set intact recomputes an identical pending set (§5.3, §14.4).

### 5.10 Inbound and conflicts [IN] — §5.4

The full branch matrix is Part 6.4; these are its cells plus the surrounding behavior.

- **IN-1 [E]** Local equals base, remote changed: apply to record and linked note; base snapshot updated (row 6 baseline).
- **IN-2 [M]** Flight-skew silence: a stale note copy carrying the previous base value plus a remote change applies silently — no item, no prompt (§5.4).
- **IN-3 [E]** Three distinct values on a not-dirty note: remote applies; an acknowledgeable preservation item carries the displaced value with revert and copy-out; it never self-dismisses (row 6, §5.4, §14.3).
- **IN-4 [E]** Dirty, remote unchanged: no inbound action; the push proceeds per §5.5.
- **IN-5 [E]** Both changed, different fields: silent merge — remote fields applied, local fields kept and pushed; assert the *absence* of any surface (§5.4).
- **IN-6 [M]** Same field, same value: convergence no-op — the same user's edit arriving once by CalDAV and once by vault sync raises nothing (§5.4).
- **IN-7 [E]** Dirty, same field, three distinct values: conflict surfaced; never last-writer-wins; local-wins updates note and record and pushes; remote-wins updates both and pushes nothing (§5.4, IV-10).
- **IN-8 [E]** Remote deletion with a linked note, flag default: remote-observed tombstone written, note bannered, file survives, materialized sections stay (§5.4, §5.6, §7.5).
- **IN-9 [M]** Row 25: concurrent same-note edits on two devices resolve at the sync-tool layer; the tool's output re-enters as dirty; a stale-base push meets `412` into resolution — the named backstop demonstrated (§5.4, §5.5).
- **IN-10 [E]** Field-level application: a multi-field remote change applies only the changed fields; local-only keys untouched (IV-3 anchor) (§5.4).
- **IN-11 [M]** Every-device symmetry: two devices concurrently apply the same inbound change to the same linked note and produce byte-identical note writes — zero vault-sync conflict artifacts (§5.4's "every device applies every inbound change" claim; deterministic by the Part 3.4 fake, with the real API carried by A-11).
- **IN-12 [C]** Inbound-apply crash window under the mandated order (note first, record/base second — §5.4): the write log shows the base never leading the note; a kill after the note write resolves next loop as silent convergence (remote-equals-local), no prompt, no wrong write; an interrupted self-write escaping expected-content matching into the dirty set meets `If-Match` on the advanced etag and converges — the named backstop exercised (§5.4, §5.3, §5.5).
- **IN-13 [E]** Remove option (§5.4): an untouched, Davenport-created note is moved to trash through the trash API honoring the deleted-files preference — never permanently deleted; a note whose content diverges from the stored materialization hash, or one Davenport did not create (adopted or linked), degrades to flag with the reason logged; trashing acknowledges — the tombstone is claimant-free and prunes per TS-15; venue sections stay (§5.4, §7.3, §5.6).
- **IN-14 [C+M]** Remove-option order and flight: kill between the tombstone write and the trash operation — the intermediate is an ordinary orphaned note, never a live record with a dangling pointer; on a second device, the trashed note arriving before the tombstone record raises a transient dangling-pointer item that self-dismisses on the tombstone's arrival (IV-12) (§5.4, §14.3).

### 5.11 Push [PU] — §5.5

- **PU-1 [E]** Every update `PUT` carries `If-Match` with the record's etag; success bumps `SEQUENCE` and updates etag, base snapshot, and hashes (§5.5).
- **PU-2 [E]** Creation targets `{uid}.ics` with `If-None-Match: *`; `412` on creation → fetch and converge, `state` stripped, no error (row 4, §5.5).
- **PU-3 [E]** `412` on update → pull, §5.4, retry only after resolution; assert no blind retry and no forced write (§5.5).
- **PU-4 [D+E]** Round-trip patching (IV-4 anchor): every corpus property survives modeled-field pushes; the named regression — a foreign `VALARM` survives a time change (§5.5).
- **PU-5 [E]** Attendee-gate matrix (Part 6.3): every listed operation gates in every context; the confirmation shows what changes and who is notified (§14.6); no configuration path suppresses it (§15.4).
- **PU-6 [E]** Precondition-non-enforcement branch: enforcement off on the mock plus the provider documented as non-enforcing → the §14.4 per-account trust caveat is shown (§5.5, A24).
- **PU-7 [E]** Stage variants: the stage-3 build surfaces `412` as a blocking error on the item; the stage-4 build surfaces field-level resolution (§18).
- **PU-8 [C]** Push crash windows: kill between a successful update `PUT` and the record's etag/base update — the next loop's push meets `412`, pulls, and lands in the remote-equals-local convergence branch (§5.4): no conflict prompt, no duplicate write. Kill between a successful creation and the record mint — the note is still `ready`, the re-push meets `If-None-Match: *` `412`, and row 4's fetch-and-converge produces one server resource and one record (§5.5).

### 5.12 Tombstones and deletion [TS] — §5.6

- **TS-1 [E]** Local-intent → `DELETE` with `If-Match`; `404` is silent success.
- **TS-2 [E]** `DELETE` `412` → surface delete-anyway / keep; never auto-refetch-and-force (§5.6).
- **TS-3 [E]** Keep: tombstone cleared, record revives, resource re-fetched, §5.4 re-entered; pointer retained iff a note still claims the identity, otherwise routing/inbox (row 12).
- **TS-4 [M]** Monotone typing: remote-observed then local-intent arriving upgrades, and the banner corrects to the user's own deletion (§5.6's acknowledged mislabel); local-intent never downgrades; loss of strongest-seen memory degrades to banner correction only — no server effect (§5.6, §3.3).
- **TS-5 [M]** Deletion propagation: a tombstone decided on device A reaches B by vault sync; B's next pull never resurrects the event (§5.6's core rationale).
- **TS-6 [E]** Retention: an unacknowledged claim blocks pruning indefinitely; acknowledgment strips `uid` and `state` — plain note, fields intact — and starts prunability (row 13, §5.6).
- **TS-7 [E]** Reappearance within retention, unacknowledged: revival; relink; banner self-dismisses; orphan-era dirty cleared; post-revival divergence takes inert/grace, never a push (row 14, §5.6, B.1).
- **TS-8 [E]** Reappearance after acknowledgment: within retention → revival lands unlinked → inbox; after pruning → genuinely new record → inbox; no auto-bind in either (row 14, §3.4).
- **TS-9 [E]** Move suggestion: same account, tombstone in collection A, same UID appears in collection B → suggestion on the orphaned note; accept updates `calendar:` and transfers the pointer; `ATTENDEE` both sides → suppressed or caveated; cross-account → never suggested, manual acknowledge-then-adopt path present (row 15, §5.6).
- **TS-10 [E]** Dangling pointer (note deleted while closed): the rename check runs first under both A21 delivery modes and offers relink; no auto-`DELETE` ever (IV-1); a live record offers retract / unlink / restore; deleting an orphaned note counts as acknowledgment (§5.6).
- **TS-11 [E]** Venue relink heuristic: a venue delivered as delete-plus-create matches by name and timing → relink offered; materialization-map entries clear only after resolution concludes deletion, never eagerly (row 24, §5.6, §6.3).
- **TS-12 [E]** Horizon exit: an event drifting out of the window produces no tombstone and no deletion-adjacent observable at all (§5.6, §5.7).
- **TS-13 [E]** Record-only tombstone: processes per type; venue sections stay; legible in sync log and inbox — no note to banner (row 30, §7.5).
- **TS-14 [E]** Record-only quarantine: excluded from every consumer; rebuild per rows 16/16b; the venue pointer rides the rebuilt record (row 31, §3.2).
- **TS-15 [E]** Pruning: a claimant-free tombstone (record-only, or acknowledged, or its orphaned note deleted — §5.6) prunes when the retention window elapses, boundary tested both sides of the configured window (clock-driven); a tombstone with an unacknowledged claim never prunes regardless of elapsed time (TS-6's block, held indefinitely). Post-prune reappearance behavior per TS-8 (§5.6, §15.2).

### 5.13 Horizon and membership [HZ] — §5.7

- **HZ-1 [E]** A recurring series intersecting the window is pulled whole — instances beyond the edge present in the record base (§5.7).
- **HZ-2 [E]** Backfill mints past records on demand, per calendar (§5.7).
- **HZ-3 [E]** Delta query: an event created beyond the future edge and never modified; the clock advances a day; the newly included slice is queried and the record minted (token mode) (§5.7).
- **HZ-4 [E]** CTag mode needs no delta step: the fallback's full-window query enumerates the same slide-in (§5.7, §5.1).
- **HZ-5 [E]** Delta granularity: no delta query until the edge crosses the configured granularity; boundary both sides of one day (§5.7).
- **HZ-6 [E]** Out-of-horizon staleness: a stale out-of-horizon record pushed from a linked-note edit meets the `412` path; a remote change reported by the token refreshes it (§5.7, §5.5).
- **HZ-7 [L]** Envelope benchmarks per Part 6.6 (§5.7).
- **HZ-8 [E]** Per-calendar horizon override: an overridden calendar enumerates, clips, and delta-queries on its own window while others follow the global default; the override is one of §5.7's named envelope levers (§5.7, §15.2).

### 5.14 Lifecycle and validation [LC] — §6.1–§6.2

- **LC-1 [E]** Draft: rendered in views; zero server requests across N loops (row 2).
- **LC-2 [E]** Ready: validation → creation → record minted → `state` stripped; absence-of-`state` plus `uid` reads as live (row 3, §6.1).
- **LC-3 [E]** Signal equivalence: command, view button, quick-add confirm, and hand-typed field produce identical behavior (pairwise-sampled) (§6.1).
- **LC-4 [E]** Hand `ready` on a live note: stripped as satisfied, logged, no re-push (row 9).
- **LC-5 [E]** Hand `draft` on a live note: surfaced with revert; no server deletion under any response (row 10).
- **LC-6 [E]** Hand-changed or deleted `calendar:`/`type:`: surfaced with revert; commands named as the sanctioned path (row 11).
- **LC-7 [E]** Hand-appearing or changed `uid`: surfaced, never auto-bound, copied-note recovery offered (row 28); hand-deleted `uid`: surfaced with unlink, pointer one-way pending resolution (row 29).
- **LC-8 [M]** Execute-anywhere: a `ready`+`uid` note arriving by vault sync executes on the second device; the executing device prompts any attendee gate (§6.1; race per ID-7).
- **LC-9 [E]** Identity gate: `ready` against a tombstoned identity refuses with the un-cancel message; against a quarantined identity refuses with resolve-first; neither executes (rows 26–27, §6.2).
- **LC-10 [M]** Credentials absent: the account is disabled-on-this-device on the §14.4 card; zero retries across N loops; an edit made on the uncredentialed device reaches the server via the grace prompt on the credentialed device — never an automatic push (§6.1, §5.3).
- **LC-11 [D]** Validation matrix: each §6.2 requirement violated in isolation fails naming the field; "not pushed: draft" and "not pushed: invalid" are distinguished; every failure logs (IV-7).

### 5.15 Adoption and retraction [AD] — §6.3–§6.4

- **AD-1 [E]** Adoption onto a note bearing a different identity is refused; venue-linking offered (row 17, §7.1).
- **AD-2 [E]** Link command: pointer set; `uid` and `calendar:` backfilled; modeled fields backfilled so the post-link diff is empty; the modal previews the exact changes; zero server writes (§6.3).
- **AD-3 [M]** Pointer/map supersession: differing writes on two devices surface with both candidates named; no silent last-writer resolution (row 19, §6.3, IV-10).
- **AD-4 [E]** First-sync fuzzy suggestions (title and date proximity) are offered, never auto-applied, including via the §15.2 re-run command (§6.3).
- **AD-5 [E]** The three retractions: delete-note-and-event; revert-to-draft (`uid` stripped, fields kept, a later push mints a fresh identity); remove-from-calendar-keep-note — all via local-intent tombstones (§6.4).

### 5.16 Venues, routing, materialization [VN] — §7

- **VN-1 [E]** Mutual claim: a pointer without a reciprocal note claim yields record-only application; the note is never written — the stale-pointer protection (row 7, §7.1).
- **VN-2 [E]** Routing precedence: explicit assignment > note-resident claims > settings rules > inbox; claims beat settings rules on overlap; within settings rules, evaluation follows the configured order and the first match wins (§7.2, §15.2).
- **VN-3 [E]** Attendee predicates resolve through the person index (§7.2, §8.4).
- **VN-4 [E]** Lazy materialization: a pull creates records only; open or command creates the note or section; the record stores the materialization content hash at creation — the basis of §5.4's remove discriminator (IN-13); templates fire once; sync never re-renders template output (§7.3, §8.1).
- **VN-5 [E]** Accepted staleness: an event moving after materialization updates the record and leaves interpolated section text untouched (§7.3).
- **VN-6 [E]** Daily notes: date-matched routing; a missing daily note is created through the core plugin's settings (§7.4).
- **VN-7 [E]** Venue note deleted: records fall back to routing/inbox with zero server writes; instances revert to unmaterialized after resolution (row 24, §7.5; heuristic per TS-11).
- **VN-8 [E]** Remote cancellation: materialized sections stay, optionally annotated (§7.5).
- **VN-9 [U]** Scoped quick-add inherits the venue's claim context: calendar, attendees, template, venue link (§7.6).

### 5.17 Templating and people [TP] — §8

- **TP-1 [D]** Interpolation of every §8.1 field; `conferenceUrl` extraction corpus spanning provider `X-` property styles and description-embedded links.
- **TP-2 [D]** Templates carrying `uid` or `state: ready` are rejected (§8.1, §3.4).
- **TP-3 [E]** Templater installed → pass-through with event context; absent → plain interpolation; both environments exercised (§8.3).
- **TP-4 [E]** Person index derived from the configurable key with optional folder scope; updates on frontmatter change via `metadataCache` (§8.4).
- **TP-5 [E]** Attendee rendering: matched addresses → links; unmatched → plain text with the create-person action (§8.4).
- **TP-6 [E]** Two notes claiming one address: detected and surfaced (§8.4).
- **TP-7 [E]** Own addresses: `calendar-user-address-set` at discovery plus the manual per-account fallback; matching normalizes case and strips `mailto:`; alias list honored (§8.4, §12).
- **TP-8 [E]** Event types: defaults applied at quick-add; expected-field validation fails legibly ("this 1:1 has no person") (§8.2).
- **TP-9 [E]** Outbound attendee resolution: naming `[[Jane Doe]]` on an event resolves her address from the person index into `ATTENDEE`; the write is attendee-gated (IV-2 context); a person note with no address fails legibly rather than emitting an empty `ATTENDEE` (§8.4, §5.5).
- **TP-10 [D]** Quick-add parse corpus: natural-language inputs ("lunch with Sam tuesday 1pm", relative dates, ranges, all-day phrases) map through `chrono-node` into the correct pre-filled fields; ambiguous parses land in the preview for correction, never in a direct write — the modal is the safety, and the corpus pins the mapping (§8.2, §14.6).

### 5.18 Description and attachments [DA] — §9

- **DA-1 [E]** One-way projection: remote `DESCRIPTION`/`ATTACH` edits are never merged into markdown; flagged or overwritten per mode (§9.1).
- **DA-2 [E]** Source modes: `description:` field default; delimited region opt-in with extraction respecting heading boundaries (content under the configured heading, nothing above or beside it); whole-body opt-in shows the shared-calendar visibility warning (§9.2).
- **DA-3 [E]** Backlink option: `obsidian://` via `URL` or footer; carries the visibility warning (§9.2).
- **DA-4 [D]** Embed resolution: file, heading, and block embeds; embedded frontmatter stripped; depth limit enforced; a cycle terminates and surfaces (IV-7) (§9.3).
- **DA-5 [D]** Markdown-to-text: formatting stripped, `[text](url)` → `text (url)`, wikilink modes per setting; escaping and folding round-trip through `ical.js` (§9.3).
- **DA-6 [D]** Media embeds promote to attachments with the placeholder line; nothing silently omitted (§9.3).
- **DA-7 [E]** Attachment mechanisms: external URL → `VALUE=URI`; managed attachments used only when the discovery probe recorded the capability — never assumed; otherwise inline base64 with `FMTTYPE` and `FILENAME`; over-cap files fail validation naming the file; the shared-calendar visibility warning covers attachments explicitly (§9.4, §9.2, A3).
- **DA-8 [E]** Inbound `ATTACH`: URLs render as links; binaries are offered save-to-vault, never auto-written (§9.4).
- **DA-9 [E]** Snapshot semantics: an embedded source changing after push triggers no re-push; the refresh command re-renders and pushes; the optional re-render on lifecycle transitions is exercised on and off; on attendee-bearing events any re-render push is gated (§9.5, IV-2).
- **DA-10 [D+M]** Render hashes are defined over normalized base ICS values; a fresh render is normalized before comparison; two devices agree on the comparison outcome for identical state (§3.2, §9.5).

### 5.19 Tasks, blocks, transmutation [TK] — §10

- **TK-1 [E]** VTODO mapping: `due`→`DUE`, `completed`→`COMPLETED`, `priority`; `start` optional (§10.1, §10.3).
- **TK-2 [E]** Blocks: VEVENT with `task:` wikilink; default `OPAQUE`; completing a block offers task completion — an offer; declining writes nothing (§10.1, §13).
- **TK-3 [E]** Dangling `task:` link: renders plain, completion offer suppressed, no error (row 23).
- **TK-4 [E]** VTODO targets only: pushing a task at an events-only calendar fails naming the mismatch and offering the block fallback; the deadline-materialization option produces all-day events (§10.2).
- **TK-5 [E]** Inbound completion from another VTODO client updates frontmatter (§10.3).
- **TK-6 [E]** Transmutation pre-validation: target component-type failure blocks before any write — zero files touched (§10.4).
- **TK-7 [C]** Crash windows around the mandated order: before the tombstone → nothing written, command re-runnable; between tombstone and rewrite → orphaned note with the "converted" annotation, successor unresolvable past flight grace → the incomplete-conversion surface with complete (re-derived rewrite) and revert (§5.6 keep; post-`DELETE`, a fresh push stated as such); after both → normal decomposed processing (row 13b, §10.4).
- **TK-8 [M]** Late successor: the successor note in vault-sync flight raises no incomplete-conversion item within grace; its arrival resolves the check (§10.4).
- **TK-9 [M]** Cross-device conversion: a device observing the server deletion first writes remote-observed; the arriving annotated local-intent tombstone upgrades by dominance and corrects the banner to "converted, not cancelled" (§10.4, §5.6).
- **TK-10 [E]** Offline conversion queues by artifact existence and executes where first observed; `If-None-Match: *` and 404-on-`DELETE` make the races safe (§10.4).
- **TK-11 [E]** Attendee-bearing events refuse conversion (Part 6.3 row) (§10.4).
- **TK-12 [E]** `412` on the tombstone's `DELETE`: one prompt — retract-anyway / keep-both; keep-both leaves the note with the successor and routes the revived old record venue-less to the inbox (§10.4, §5.6).
- **TK-13 [E]** Conversion requires a linked note; a venue-routed record is refused with the reason (§10.4).
- **TK-14 [E]** The command's rewrite never trips the §6.1 hand-edit guard (self-write exclusion) (§10.4, §5.3).
- **TK-15 [E]** Move to calendar: pre-validation at the target; tombstone-first with the "moved to" annotation; the note rewrite mints a fresh `uid` (asserted distinct from the old identity) and changes `calendar:` only — every other field byte-untouched; the venue pointer carries forward; server work completes as standard tombstone processing plus push, and the mock's request log shows delete-plus-create, never `MOVE` (§10.4).
- **TK-16 [E/C]** Moves inherit the conversion properties: the row-13b detector reads the "moved" annotation identically, with TK-7's crash windows re-run under the move shape; attendee-bearing events refuse the move; a linked note is required; `412` on the `DELETE` surfaces retract-anyway / keep-both (§10.4, row 13b).

### 5.20 Recurrence [RC] — §11

- **RC-1 [D]** Instance computation from `RRULE` for display; the materialization map keys by instance date (§11).
- **RC-2 [D]** Closure rule: edits to series `start`, `rrule`, or `timezone` — including the timed↔all-day key swap — are refused with the stated reason while overrides or exclusions exist; safe fields patch (§11).
- **RC-3 [D+E]** Overrides and `EXDATE`s preserved round-trip from day one under modeled-field pushes (IV-4) (§11, §5.5).
- **RC-4 [D]** Preserved overrides are rendered: views apply existing overrides and exclusions read-only — a moved instance displays moved (§11).
- **RC-5 [E]** Recurring VTODO complete-and-respawn convention honored inbound (§11).
- **RC-6 [D]** Timezone matrix per Part 6.5: DST-straddling and all-day instances computed in the event's zone, never the device's (§11).

### 5.21 RSVP [RS] — §12

- **RS-1 [E]** Pending detection: own `ATTENDEE` with `PARTSTAT=NEEDS-ACTION` via address matching; banner and Needs Response listing (§12, §14.3).
- **RS-2 [E]** `rsvp:` set with no own-`ATTENDEE` match: validation failure with the alias hint; no write (row 21, §6.2).
- **RS-3 [E]** Responding is a confirm-gated server action; buttons and the hand-edited `rsvp:` key are equivalent signals; enum validated (§12).
- **RS-4 [E]** The scheduling record shows the reply reaching the organizer only after confirmation (IV-2) (§12).

### 5.22 Property mappings [PM] — §13

- **PM-1 [E]** `alarm` ↔ `VALARM` (DISPLAY, relative `TRIGGER`); the in-app notice fires at offset while Obsidian is open (clock) (§13).
- **PM-2 [E]** Categories↔tags: union-under-prefix and replace-within-prefix; adversarial non-prefixed tag lists untouched in membership and order (IV-3 anchor); per-calendar direction settings exercised (§13).
- **PM-3 [D]** `transp`, `class`, `status`, `location` mappings; structured-location `X-` properties preserved (IV-4) (§13).

### 5.23 Interface [UI] — §14

- **UI-1 [U]** Needs Attention completeness: construct every condition the spec routes there — the §14.3 enumeration (conflicts, validation failures, dangling pointers, grace divergence, remote-owned divergence, hand-edited `calendar:`/`type:`/`uid`, persisting uid-without-record, quarantines, duplicate address claims, supersession mismatches, orphan acknowledgments and move suggestions, suspended notices) plus the amendment-introduced surfaces: preservation items (§4.2, §5.4), the incomplete-conversion surface (row 13b), and feed-level anomalies (§5.2) — and assert each lists with a working resolve action; every bannered condition also lists; the section renders only when non-empty, always first.
- **UI-2 [U]** Per-class dismissal: flight items self-dismiss on resolution; preservation items require acknowledgment; no item survives its condition (IV-12) (§14.3).
- **UI-3 [U]** Sync activity: the pending count is derived (no queue artifact exists anywhere on disk); the log records refusals, skips, and conflicts, not only successes; filters work (§14.4).
- **UI-4 [E]** Dry-run renders counts and the expandable item list with zero server and zero vault writes (§14.4).
- **UI-5 [E]** Pause: global and per-calendar; paused calendars issue zero requests; edits accumulate as dirty and push on resume (§14.4).
- **UI-6 [E]** Snapshots precede destructive batches; restore reproduces pre-batch bytes exactly; snapshots expire per the §15.2 retention setting, boundary tested (§14.4).
- **UI-7 [U]** Calendar view drag/resize routes through the standard edit path — debounce, validation, attendee gate; disabled on remote-owned with the reason shown on attempt, not a silently missing handle (§14.2).
- **UI-8 [U]** Visual encodings: drafts dashed, `tentative` faded, `cancelled` struck, blocks patterned; RSVP/conflict/validation badges present (§14.2).
- **UI-9 [U]** Banners are rendered UI: note bytes are unchanged by any banner state transition (§14.5).
- **UI-10 [U]** Codeblock views: the full parameter set (`view`, `calendars`, `venue`, `from`/`to`, `format`); read-only; click-through opens notes (§14.5, §7.4).
- **UI-11 [U]** Modals, the full §14.6 set: quick-add previews parse results live and Esc abandons with zero writes; the attendee confirmation is not suppressible; retraction options state consequences; the conflict table resolves per field or wholesale; the adoption picker pins fuzzy-match suggestions on top; the venue picker searches notes; the dangling-pointer modal offers retract/unlink/restore (§14.6, §15.4).
- **UI-12 [U]** Command inventory conventions: visibility via `checkCallback` — sampled contexts: RSVP commands only with a pending or changeable `PARTSTAT`; convert refuses attendee-bearing events — and no command registers a default hotkey (§14.7).
- **UI-13 [D]** Filename sanitization: per-platform illegal characters, length caps, collision suffixes (§14.8).
- **UI-14 [E]** Rename-on-retitle: default off (remote retitle renames nothing); enabled, the rename preserves identity and links (§14.8, §3.4).
- **UI-15 [U]** Status bar: next-event countdown; menu actions; device-local toggle (§14.5).
- **UI-16 [U]** Calendar-view interactions beyond drag/resize: clicking an event opens its materialized note or offers materialization; clicking a draft opens its note; dragging empty space opens quick-add pre-filled with the selected time and the view's calendar context; the context menu carries the §14.2-enumerated actions, each visible only where applicable (§14.2).
- **UI-17 [U]** Agenda composition: the four sections render in §14.3's order; Today and upcoming is chronological with the configured days-ahead honored and inline join/open-materialize actions; Inbox lists exactly the unrouted records with assign-venue and materialize actions (§14.3, §7.2).

### 5.24 Configuration [CF] — §15

- **CF-1 [E]** Tier discipline: device-local view-state changes cause zero `data.json` writes; every synced-settings change writes the revision marker (§15.1).
- **CF-2 [E]** Tripwire: a marker ahead of local revision surfaces the stale-settings warning naming the divergent sections, with ownership-mode divergence called out; a damaged marker costs at most one wrong warning, corrected by the next settings write; the marker never gates behavior and never appears in quarantine — it lives outside the records folder by design (§15.1, §3.2).
- **CF-3 [U]** Onboarding runs the settings-sync check under the configured setup; per-tool procedure follows Part 6.2's recorded facts (§15.1, A22).
- **CF-4 [D]** Override pattern: global-plus-per-calendar everywhere; per-event-type overrides exist only for the §8.2-named options — a schema assertion (§15.3).
- **CF-5 [D]** Deliberate non-configurability: the settings schema contains no toggle for any §15.4 item — attendee confirmation, URI write behavior, dangling-pointer auto-deletion, round-trip preservation, validation gating, surfacing of skips and failures (§15.4).
- **CF-6 [D]** Every settings item states its default (schema-driven) (§15.2).

### 5.25 Integration [IG] — §16

- **IG-1 [E]** URI actions land in drafts or confirm modals only; zero direct server writes from any URI invocation (IV-1) (§16).
- **IG-2 [E]** Public API: ledger queries and quick-add reachable; queries issue no writes (§16).
- **IG-3 [E]** Full Calendar importer: fixture vault converts to correct drafts and adoption suggestions (§16).
- **IG-4 [E]** ICS export of a calendar and a filtered projection; exports re-import cleanly; no secrets or sync state in exported bytes (IV-6) (§16).
- **IG-5 [E]** Dropping an `.ics` file, and the Import ICS command, offer parse-to-draft through the same path; no reply flow is offered from a bare file (§16, §14.7, §12).

### 5.26 Stage-interim behavior [SI] — §18

- **SI-1 [E]** Stages 2–3 interim rule: inbound changes to notes in the local dirty set are deferred and flagged, never applied over dirty local state. This test exists only in stage-2/3 builds and is replaced by the Part 5.10 suite when three-way comparison lands in stage 4 (§18).
- **SI-2 [E]** Stage-1 read-only assertion: the stage-1 build (feeds only) issues no non-GET request of any kind across every stage-1 suite run (§18, §5.2).

## Part 6 — Matrices and verification protocols

### 6.1 Appendix A verification protocol [V]

Each item produces a recorded fact in the versioned recorded-facts document: date, environment and versions, the fact, and the branch taken. No item is pass/fail; every outcome lands on the branch the design spec pre-states. Item 11 runs first; item 24 second; the rest before the stage that consumes them (Part 8).

- **A-11** — `processFrontMatter` byte determinism. Procedure: a note-fixture corpus (comments, key orders, quote styles, nested values) written through `processFrontMatter` across an Obsidian version × platform matrix; outputs byte-compared. Branch: determinism holds → recorded, [E]/[M] fakes stand validated; fails → the designated-writer redesign is required **before stage 2** — the appendix's only failure-is-design-change item (§5.4, A11).
- **A-24** — precondition enforcement per provider. Procedure: `PUT` with a stale `If-Match` expecting `412`; `If-None-Match: *` against an existing resource expecting `412`; ETag stability across fetches — on iCloud, Fastmail, Nextcloud, Radicale, Baïkal, Google CalDAV. Branch: non-enforcing providers documented; §14.4 trust caveat activates (PU-6) (§5.5).
- **A-1** SecretStorage at rest: inspect desktop storage after storing a secret. Branch: §4.3 warning posture; SC-5 README gate. **A-2** `requestUrl` with self-signed certificates (LAN Nextcloud). Branch: onboarding documentation. **A-3** RFC 8607 probe per provider. Branch: DA-7's inline fallback. **A-4** `X-ALT-DESC` rendering in current Outlook/Apple/Google clients. Branch: §9.3's option stays gated. **A-5** iCloud sync-token support and discovery redirects. Branch: expected fallback frequency; LP-3 live confirmation. **A-6** Plugin-id collision check at submission. **A-7** SecretStorage cross-device travel. Branch: LC-10's credentials-absent path is the designed degradation. **A-8** Google RFC 6578 support. Branch: §5.1 fallback on Google. **A-9** Google verification requirements. Branch: v2 stretch gate only. **A-10** Google iTIP behavior on `ATTENDEE` writes (test account, observe mail). Branch: gate assumed maximally live until recorded otherwise.
- **A-12** External-modification events and Obsidian Sync's replace-unmerged behavior on fresh files: scripted external changes while running; event capture. Branch: §5.3 flight machinery and materialization racing. **A-13** `requestUrl` redirect handling, large-body mobile behavior, `tsdav` under sustained load. Branch: onboarding limits and the attachment-cap default. **A-14** Obsidian Sync diff-match-patch applied to record files: produce real concurrent record edits; capture merge outputs into the mangle corpus. Branch: LG-8 must catch every captured mangle — a design input to quarantine. **A-15** mtime preservation per tool. Branch: grace tuning and prompt copy. **A-16** Byte-stable vs re-serialized `GET`s per provider. Branch: normalization handles both (LG-3); record the fact. **A-17** `saveLocalStorage` capacity. Branch: DL-3 routing thresholds. **A-18** Excluded Files vs Bases and Dataview per current Obsidian version. Branch: LG-14 documentation. **A-19** Emitter stability across plugin builds N/N+1. Branch: the version stamp (LG-4) is its consequence; verify the assumption that stamps are needed. **A-20** Conflict-copy filename patterns per tool → LG-7's corpus. **A-21** Rename delivery per tool → TS-10/TS-11 harness modes. **A-22** `data.json` travel per tool × configuration (Obsidian Sync toggles and defaults, git conventions, Syncthing filters) → CF-2/CF-3 expectations; branch: §15.1's tripwire, and its recorded escalation. **A-23** UID presence and stability across real feed generators, repeated fetches → FD-7 realism and threshold defaults. **A-25** UID property-filter support per provider → ID-6's degraded form. **A-26** WebDAV `MOVE` support per provider, and whether `MOVE` on scheduling-enabled collections stays silent to attendees. Branch: gates §10.4's atomic-move optimization only — no shipped behavior depends on it, and until recorded the attendee-bearing refusal stands unconditionally (TK-16).

Provider facts table (columns are the A-items that own them):

| Provider | 6578 tokens (A5/A8) | ETag stable (A24) | `If-Match` (A24) | `If-None-Match:*` (A24) | RFC 8607 (A3) | UID filter (A25) | Byte-stable GET (A16) | iTIP on write (A10/§5.5) | Redirects (A13) | WebDAV `MOVE` (A26) |
|---|---|---|---|---|---|---|---|---|---|---|
| iCloud / Fastmail / Nextcloud / Radicale / Baïkal / Google CalDAV | record | record | record | record | record | record | record | record | record | record |

### 6.2 Sync-tool facts matrix

For Obsidian Sync, Syncthing, iCloud Drive, and git: conflict-copy filename pattern (A20), merge behavior on records (A14), rename delivery (A21), mtime preservation (A15), `data.json` travel per configuration (A22). Every recorded fact feeds harness configuration (Part 3.2) so [M] suites replay realistic delivery, and CF-3's onboarding procedure per tool.

### 6.3 Attendee-gate matrix

Rows: create-with-attendees; add attendee; remove attendee; change `start`/`end`; change `duration`; change `rrule`; change `timezone`; timed↔all-day swap; delete event; edit summary; edit location; edit description; §9.5 refresh; RSVP write; transmutation or move attempt. Columns: bidirectional manual push; vault-owned manual; vault-owned auto-push-on-valid; drag/resize (§14.2); execute-anywhere second device (§6.1). Assertion per cell: the confirmation precedes the write (scheduling record clean until confirmed), except transmutation and moves, which **refuse** (TK-11, TK-16). The gate is a predicate, not this list: the matrix is a floor, and the property obligation IV-2 runs over generated operations beyond it (§5.5).

### 6.4 Conflict-branch matrix (§5.4)

Local state (rows) × remote state (columns); cells name outcome and covering tests.

| local \ remote | unchanged | changed, different field | changed, same field, same value | changed, same field, different value |
|---|---|---|---|---|
| equals base | steady state; nothing (row 5; IV-9) | apply (IN-1, IN-2) | apply ≡ converge (IN-1) | apply (IN-1) |
| changed, not dirty | inert → grace (CD-6) | remote field applies; local divergence → grace (IN-1 + CD-6) | convergence, silent (IN-6) | apply + preservation item (IN-3) |
| changed, dirty | push (IN-4) | silent merge, both survive (IN-5) | convergence, silent (IN-6) | conflict surfaced (IN-7) |

### 6.5 Timezone matrix (RC-6, FM-4)

Zones: `America/New_York`, `Europe/London`, `Asia/Kolkata` (+:30), `Australia/Lord_Howe` (:30 DST), `Pacific/Apia` (dateline history), `UTC`. Cases per zone where applicable: timed event across spring-forward and fall-back; recurring series straddling both transitions; nonexistent local time (spring gap) and ambiguous local time (fall overlap); all-day stability across transitions; emission of a zone never received inbound (bundled tzdata, §2.2); round-trip of inbound historical `VTIMEZONE` definitions.

### 6.6 Scale matrix (HZ-7) [L]

Ledger sizes 100 / 1,000 / 5,000 records (in-envelope) and 10,000 (out-of-envelope, degradation documented, levers verified — §5.7). Operations: cold-start index build; steady-state loop wall time with **zero** writes (IV-9 under load); full CTag-fallback diff; month calendar render; agenda render; Dataview query presence. Evidence: recorded baselines with regression gates; the envelope claim is that in-envelope sizes stay within interactive tolerance and churn stays zero.

## Part 7 — Appendix B row coverage

Every row of the design spec's state table maps to covering tests. Rows B.3 marks as resolving to existing rules still get their tests — the resolution claim is itself an assertion.

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

Verification order: A-11 before the other appendix items, and before the implementation work that writes note frontmatter through the API it verifies — frontmatter emission, materialization, and the engine that drives them, which is where stage 1 first writes user notes through `processFrontMatter`; the rest of stage 1 proceeds without waiting on it. Its failure branch is the appendix's only design change and it gates stage 2. A-24 second — a non-enforcing server silently removes a named backstop, and the plan must know where that backstop is real before push ships. Remaining items land before the stage that consumes them, per the mapping in Part 6.1.

Stage gates, aligned with the roadmap (§18). A stage ships when its listed suites pass and its consumed verification items are recorded:

- **Stage 1 (feeds, read path):** FM complete except FM-5 (push-creation), LG, DL-3, ID-1..ID-6, FD complete, VN complete except VN-9 (scoped quick-add), TP-1..TP-6, RC-1/RC-4/RC-6 (display), TS-6/TS-7 (read halves — acknowledgment, claimant-gated retention, revival), CD-8 (the exemption over the orphaned and suspended conditions stage 1 produces), AD-3 (the materialization-map half), IN-13 (the materialization content hash written at creation, which stage 3's remove discriminator reads), UI-1/2/8/9/10/13/15/17 (read-side), UI-16 (read subset), CF-1/CF-2, CF-3 (the check itself — its per-tool procedure lands with stage 3), SC-5 (the README half — no encryption-at-rest claim; the setup-guide half lands with stage 6), SI-2 (the whole build issues no non-GET request), applicable IV sweeps including IV-13. Consumes: A-6, A-14, A-16, A-18, A-19, A-20, A-22, A-23.
- **Stage 2 (CalDAV pull):** LP, HZ (incl. HZ-8), AD-1..AD-4, RG-1..RG-3/RG-5/RG-7..RG-10, TP-7, CD-1/CD-3 (dirty set ships here), SI-1, DL-1, ID-8, SC-1/SC-2. Consumes: **A-11 (gate)**, A-5, A-8, A-12, A-13, A-15, A-16, A-21, A-25.
- **Stage 3 (push, trust surface):** PU (with PU-7's stage-3 variant and PU-8), ID-7 (the creation race), FM-5, LP-7's write-serialization half, HZ-6's `If-Match` half, TS (incl. TS-15), LC, AD-5, CD complete, DA, PM, TP-8..TP-10, VN-9, RG-4 (vault-owned behavior: auto-push-on-valid ships with push), IN-8/IN-13/IN-14 (remote-deletion handling ships with tombstones), UI complete, CF complete, IG, the Part 6.3 gate matrix, IV-1/2/4/6/8 at full strength. Consumes: A-1, A-2, A-3, A-4, A-17, **A-24**.
- **Stage 4 (conflicts):** IN complete and Part 6.4 fully exercised; SI-1 retired; preservation items (IN-3, RG-6, DL-2) and the conflict UI (UI-11's table, plus PU-7's stage-4 variant replacing the stage-3 behavior); IV-10/IV-12 at full strength.
- **Stage 5 (tasks, transmutation, moves):** TK complete (incl. TK-15/TK-16) and RC-5 (inbound complete-and-respawn — task machinery, not exception editing), including the [C] crash suite. Consumes: A-26 (optimization gate only; non-blocking).
- **Stage 6 (Google):** SC-3/SC-4, SC-5's setup-guide half (the production-status instruction), and the Google column of every provider matrix. Consumes: A-7, A-9, A-10.
- **Stage 7 (recurrence exceptions, RSVP, pipeline):** RC complete (RC-1/RC-4/RC-6 display is already live from stage 1, RC-3's preservation from stage 3, and RC-5's inbound respawn from stage 5 — what lands here is exception *editing*), RS complete, any deferred DA items.

Re-verification triggers, recorded in the facts document: platform items (A-1, A-7, A-11, A-12, A-17, A-18) on each Obsidian minor release; provider items on observed regression and at least annually; sync-tool items on tool major versions. A changed fact re-routes to its pre-stated branch; a fact with no branch is a design gap and goes back to the design spec before code changes.
