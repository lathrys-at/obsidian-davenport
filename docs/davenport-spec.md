# Davenport — Design Specification

An Obsidian plugin for bidirectional calendar sync over CalDAV. A davenport is a small writing desk; this one speaks CalDAV.

## 1. Orientation

Davenport syncs calendar events and tasks between an Obsidian vault and CalDAV servers (iCloud, Fastmail, Nextcloud, Radicale, Baïkal, Google, and other CalDAV servers), authenticated with app-passwords or, for Google, user-supplied OAuth credentials (§4.4). It treats the calendar as a projection of the vault: the calendar owns when things happen; the vault owns what they mean.

Five principles govern the design. Each recurs throughout the spec.

1. Events are records; notes are venues. Event data lives in a plugin-owned ledger. Notes hold meaning and optionally receive events. Many events may point at one note.
2. Sync touches only declared fields. Templates fire once at creation; afterward the note belongs to the user. The note body is never a sync surface except through explicitly declared channels (description region, attachments list).
3. Presence of data is never intent. Creating or modifying a remote resource requires an explicit signal. Anything that could message another person requires confirmation, always.
4. Ownership is declared, not assumed. Every calendar has an explicit mode: vault-owned, remote-owned, or bidirectional. Behavior differences between modes are stated, not discovered.
5. Trust is demonstrated, not claimed. Unknown data survives round trips. Destructive operations are previewable, logged, and pausable. Failures are legible; nothing is silently skipped.

## 2. Background

### 2.1 Protocols

iCalendar (RFC 5545) is the data format: `VEVENT`, `VTODO`, and related components with properties such as `DTSTART`, `DTEND`, `RRULE`, `UID`, `SEQUENCE`. Every calendar system speaks it or maps onto it.

CalDAV (RFC 4791) is calendaring over WebDAV. Each event is an `.ics` resource with its own URL inside a calendar collection. Discovery walks `PROPFIND` from `/.well-known/caldav` to principal to calendar-home-set to collections. Reads and writes are `GET`/`PUT`/`DELETE` guarded by ETags (`If-Match`). Queries use `REPORT`: `calendar-query` (time-range and component filters) and `calendar-multiget` (batch fetch by URL). Change detection uses the collection CTag (coarse) or WebDAV-Sync (RFC 6578) sync-tokens (incremental: send last token, receive changed/deleted resources). Collections advertise which component types they accept via `supported-calendar-component-set`; the ecosystem convention is separate collections for events and tasks. Servers with scheduling support (iTIP/iMIP) send email to attendees when events carrying `ATTENDEE` properties are written.

ICS subscription feeds are read-only `.ics` URLs that clients re-poll. They have no per-item versioning or sync tokens.

Google Calendar and Microsoft Graph offer richer REST APIs but require OAuth 2.0 with app registration and (for Google) a verification process. Neither supports app-passwords. Davenport targets CalDAV and ICS feeds only — including Google, whose CalDAV v2 endpoint (`apidata.googleusercontent.com/caldav/v2/`) accepts OAuth 2.0 Bearer authentication. Google support therefore requires no second sync engine: it is the same CalDAV engine with a different credential type (§4.4). The REST APIs remain out of scope. Rationale: one protocol covers every provider; the engine, records, and conflict machinery are auth-agnostic.

Task silos: Google Calendar's CalDAV endpoint serves events only; Google Tasks is a separate OAuth-only API whose `due` field is date-only. Apple Reminders left CalDAV for CloudKit with iOS 13; reminders on upgraded iCloud accounts are unreachable by any public API. VTODO over CalDAV works with Nextcloud, Radicale, Baïkal, and clients such as Thunderbird and Tasks.org.

### 2.2 Platform constraints

- Network calls must use Obsidian's `requestUrl()`, not `fetch`. CalDAV servers do not send CORS headers; `requestUrl` bypasses CORS and works on mobile.
- Plugins run only while Obsidian is open. Background sync and background notifications are impossible, especially on mobile. The phone's native calendar client is the delivery mechanism for alarms and freshness; Davenport designs around this, not against it.
- `data.json` (via `loadData`/`saveData`) travels across devices only when the user's sync setup carries it: it is a non-markdown file in a hidden folder, Obsidian Sync gates plugin data behind configuration-sync toggles, and git and Syncthing setups routinely exclude `.obsidian` wholesale. Cross-device settings agreement is therefore configuration-dependent — verified at onboarding and tripwired at runtime (§15.1), never assumed (Appendix A item 22). `App.saveLocalStorage`/`loadLocalStorage` is official API for device-local, vault-scoped, non-synced storage. IndexedDB is available for larger device-local caches but may be wiped with app data.
- Obsidian Sync does not sync arbitrary hidden folders, and syncs non-markdown file types only when the corresponding settings toggle is enabled. Markdown files sync unconditionally under every sync method.
- Obsidian's Properties UI cannot edit nested YAML mappings and has no enum/select property type. There is no official API for custom property widgets; community implementations rely on undocumented internals.
- The SecretStorage API (Obsidian ≥ 1.11.4) stores shared secrets outside `data.json`. A January 2026 report showed desktop secrets stored unencrypted in Local Storage; current status requires verification (Appendix A).
- Libraries: `ical.js` for iCalendar parsing and serialization (RRULE, VTIMEZONE, escaping, line folding), `tsdav` for the CalDAV client with `requestUrl` injected as its fetch, `chrono-node` for natural-language date parsing. `ical.js` ships no timezone database: emitting `TZID` with `VTIMEZONE` (§3.1) reuses inbound `VTIMEZONE` definitions where the zone arrived with server data, and otherwise draws from a bundled tzdata set registered into its `TimezoneService` — originating an event in an arbitrary IANA zone must not depend on having previously received that zone.

## 3. Data model

### 3.1 Frontmatter schema

Frontmatter carries identity and user-declared intent. All keys are top-level (flat). Rationale: Obsidian's Properties UI cannot edit nested mappings; flat keys are also queryable by Bases and Dataview.

Keys, all optional except where stated:

- `uid` — event identity. Minted by the plugin when the `ready` signal is given — so the UID travels with the note before the server resource exists — or at adoption; never by templates; never regenerated. Required on any note linked to a remote event.
- `state` — lifecycle intent: `draft` or `ready` (§6). A note is live (synced) when a *live* record — existing, not tombstoned, not quarantined — resolves for its identity; liveness is not a frontmatter value. A note whose record is tombstoned is **orphaned**; quarantined, **suspended** (Appendix B.1).
- `calendar` — friendly calendar name, resolved through the registry (§4.1). Required to push.
- `summary` — event title. Defaults to the filename, evaluated once at push-creation and never re-derived afterward — otherwise renaming a live note silently becomes a push. Materialization always writes an explicit `summary` (§8.1).
- `start`, `end` — ISO 8601. `duration` (e.g. `30m`, `1h30m`) is accepted in place of `end` — in place of, not alongside: both present fails validation naming both keys (§6.2).
- `date`, `endDate` — all-day events. `date` and `start` are mutually exclusive shapes: a note carrying both fails validation naming both keys (§6.2) rather than being resolved by fiat, and plugin writes are shape-exclusive — an inbound change switching an event between timed and all-day removes the departing shape's keys in the same write. `endDate` is optional and inclusive; the serializer converts to iCalendar's exclusive `DTEND`. Rationale: the exclusive all-day end is the standard off-by-one-day bug, and users think inclusively. A single representation rather than an `allDay` boolean, because a boolean alongside timed keys permits self-contradictory notes.
- `timezone` — IANA name. Resolution order for times: explicit offset/`Z` in the value; `timezone` key; the calendar's configured default timezone. Serialization emits `TZID` with `VTIMEZONE`. Times are never silently normalized to local time.
- `rrule` — RFC 5545 RRULE string. One note or record represents the series (§11).
- `type` — `event` (default), `task`, or `block` (§10). Blocks carry `task:` — a wikilink to the task note they serve.
- `due`, `completed`, `priority` — task fields (§10).
- `rsvp` — `accepted`, `declined`, or `tentative` (§12).
- `description` — pushed as `DESCRIPTION` (§9).
- `attachments` — list of vault wikilinks or external URLs, pushed as `ATTACH` (§9).
- `alarm` — reminder offset, e.g. `-15m`, serialized as `VALARM` (§13).
- `location`, `categories`, `class`, `transp`, `status` — direct property mappings (§13). `status` is iCalendar event status (`tentative`/`confirmed`/`cancelled`) and is distinct from `state`. The two must never share a key or vocabulary.

Machine sync state (`etag`, `href`, hashes, base snapshots) never appears in frontmatter. Rationale: sync state in frontmatter rewrites user files on every sync, producing git noise and cross-device merge conflicts on notes the user did not touch.

### 3.2 The record ledger

Every synced or tombstoned event has exactly one record: a markdown file in a configurable, visible vault folder (default `davenport/records/`), named by a filename-safe digest of the pair (collection href, UID), with both stored exactly inside. The pair, not the UID alone, is the identity: CalDAV guarantees UID uniqueness only per collection, and iTIP scheduling *deliberately* delivers the same UID to every attendee's collection so replies and cancellations correlate — one meeting a user is invited to on two synced accounts is two records. The same UID appearing in two synced collections is therefore two distinct records; where both carry `ATTENDEE` data suggesting an invited-copy relationship, the relationship is surfaced, not modeled, in v1. Feed events lacking a UID receive a synthesized content-derived identity (§5.2) that stands in the UID position of the pair everywhere. The ledger indexes (collection, UID) → path; notes resolve to records through `calendar:` plus `uid` (§3.4). Records are the machine's truth; they travel with the vault under every sync method because they are plain markdown. Records are machine-owned: Davenport may rewrite them wholesale, and hand-editing them is not a supported interface — the plain-text format exists for sync granularity, inspection, and queries, not for editing. Onboarding recommends adding the folder to Settings → Excluded files to keep records out of search and the quick switcher.

Record frontmatter holds: `uid`, collection and resource hrefs, `etag`, modeled event fields as last synced, the note/venue pointer (§7), the per-instance materialization map for series (§11), the materialization content hash (§7.3), render hashes for derived content, a typed tombstone (§5.6), a normalization version stamp, and a self-checksum (below). The registry's friendly calendar name never appears in a record — it is settings-derived, and a registry rename would otherwise rewrite every record on the calendar; names resolve from the href at read time. Render hashes are defined over the normalized base ICS property values (`DESCRIPTION`, `ATTACH`) — which are server state — not over push-time rendered markdown, which only the pushing device could know; the §5.3/§9.5 freshness comparison normalizes and escapes the fresh render before comparing. No per-device facts — timestamps, cursors, device IDs — ever appear in a record; those are device-local (§3.3), because per-device content inside a shared file makes divergence structural. The record body holds the last-synced ICS, normalized through `ical.js` canonical serialization, in a fenced code block — the base snapshot for three-way comparison (§5.4) and the substrate for round-trip patching (§5.5). Normalization exists so that two devices holding the same server state hold byte-identical records (providers may re-serialize per fetch; Appendix A item 16).

Records are byte-deterministic pure functions of (server state, venue pointer, materialization map and content hash, tombstone), written only when the computed content differs from the file (write-if-changed). Determinism is indexed by the normalization version stamp: byte form depends on the `ical.js` and YAML-emitter versions in use (Appendix A item 19), and multi-device vaults routinely run mismatched plugin versions, so a device whose normalization version is older than a record's stamp treats byte-only differences as no-op and suppresses rewrites, while a newer device rewrites once and wins — without this, version skew produces permanent rewrite ping-pong. Rationale for determinism: every device applies every inbound change, so record files are the vault's most concurrently-written files; determinism plus write-if-changed makes convergent devices produce zero writes and zero sync conflicts. When two devices hold different server versions (one stale), convergence arrives by two cooperating channels and must not be "fixed": the stale device's own fetch fast-forwards its record to identical bytes (zero write), and its linked note is corrected by the other device's note copy arriving via vault sync, not by its own inbound engine — whose comparison against the fast-forwarded base correctly sees no remote change.

Quarantine is triggered by three operational checks, all buildable from machinery this section already requires: (a) the file fails to parse or fails schema validation; (b) the filename does not equal the digest of the identity the file contains — the naming convention is an integrity invariant, and conflict copies and hand-copies break it by construction (per-tool conflict-copy filename patterns: Appendix A item 20); (c1) the self-checksum fails — every record write stores a hash of the file's canonical bytes with the checksum field blanked, so verification needs no ability to recompute the canonical form and runs on every device at every version; merge mangles break it with overwhelming probability, closing the window in which an older device would otherwise admit a mangled newer-stamped record into its three-way base; or (c2) recomputing the canonical record from the file's own parsed inputs does not reproduce its bytes at equal version stamp — recompute-mismatch is the semantic check, and the operational definition of a merge mangle the checksum somehow survived. Quarantined records are surfaced and excluded from every consumer, with a rebuild path. Rebuild is asymmetric and the spec says so: `etag`, hrefs, and base ICS re-fetch from the server; the venue pointer and materialization map exist only in the record, and their loss falls back to routing and adoption suggestions, which is lossy. Rebuild has two branches with opposite dirty dispositions, so neither may fall through the other's wording: re-fetch succeeds → live record, and dirty entries accumulated while suspended evaluate normally (B.1); re-fetch answers `404` — routine, since inbound processing is excluded for a quarantined identity while the sync token advances past a deletion — → the rebuilt record is a remote-observed tombstone, the suspended note becomes orphaned, and accumulated dirty entries go inert per B.1's orphaned rule. One exception to quarantine noise: a conflict-copy record differing from its sibling only in tombstone type auto-resolves by type dominance (§5.6) rather than surfacing — the event is already gone.

Rationale for per-event markdown files over `data.json`: `data.json` is a single blob, so concurrent offline changes on two devices resolve as whole-file conflicts and silently drop intent (e.g. one device's tombstone). Per-event files give sync tools per-event merge granularity. Markdown specifically, rather than `.json` or `.ics` sidecars or a hidden folder, because only markdown syncs unconditionally (§2.2). Records with frontmatter are queryable by Dataview; note that Obsidian's Excluded Files setting currently also hides files from Bases, so exclusion-from-search and Bases queryability trade off rather than coexist (Appendix A item 18) — the exclusion recommendation stands, and ledger queries are documented as a Dataview capability until that changes.

### 3.3 Device-local state

Stored via `saveLocalStorage` (or IndexedDB for bulk): sync-tokens and CTags per calendar, device ID, UI state, regenerable caches, and the dirty set (§5.3). Rationale: each device is a distinct sync client from the server's perspective; cursors that travel between devices corrupt incremental sync. Everything device-local must be regenerable from the server plus the ledger, or its loss must degrade to a surfaced question rather than a wrong write (the dirty set does the latter).

### 3.4 Identity rules

- The plugin mints UIDs. Templates must not contain `uid` keys; validation rejects template-supplied UIDs.
- Notes resolve to records through `calendar:` plus `uid` — never `uid` alone, since one UID legitimately exists in multiple collections (§3.2). Materialization and adoption therefore always write `calendar:` (§6.3, §8.1).
- Two *notes* claiming one (calendar, uid) identity is always detected (the ledger indexes identity → path). Recovery treats the newer file as a copy: strip `uid`, keep event fields, set `state: draft`. Rationale: the dominant cause is duplicating last week's meeting note to prep this week's; without recovery, the sync loop moves last week's meeting. Duplicate *record* files are a different failure with a different handler — §3.2's quarantine; this rule never applies to records.
- File renames do not affect identity; the record's pointer is updated by watching vault rename events.
- `uid` present with no matching record is an inert state: never pushed, never re-created, never offered for adoption. The converse binding is also never automatic: a record newly minted from a server-observed resource does not auto-bind to an existing note bearing the same identity — the pairing is surfaced as an adoption suggestion. Rationale: UID reuse by other clients is legal, and auto-binding trusts an identity the vault neither minted nor verified. It is routine during vault-sync flight (a note file can arrive before its record file) and is surfaced in Needs Attention only if it persists past the grace period (§5.3). A persistent item names its resolutions: look up the identity on the server — a `calendar-query` with a UID property filter — where found yields an adoption suggestion (no-auto-bind holds; the user confirms) and not-found yields nothing to link; strip to draft (fields kept, a later push mints a fresh identity); or strip the identity entirely. A server that does not honor the UID filter degrades legibly: the lookup action reports the filter as unavailable rather than returning a false not-found (Appendix A item 25). Creation itself is race-safe independent of this rule: creation `PUT`s use `If-None-Match: *` (§5.5), so two devices racing to create one UID converge instead of duplicating.

## 4. Accounts, calendars, secrets

### 4.1 Registry

Settings define accounts (server URL, username, credential reference). Calendars and task lists are discovered per account (`PROPFIND` walk; `supported-calendar-component-set` read per collection) and assigned friendly names. A registry entry holds: friendly name, account, collection href, ownership mode, component types accepted, default timezone, default templates, and per-calendar options referenced throughout this spec. `calendar:` values in frontmatter resolve through this registry; unresolvable names fail validation legibly.

### 4.2 Ownership modes

Every calendar has exactly one mode, set at registration and changeable:

- Vault-owned — the vault is authoritative. Local changes push; remote changes are surfaced as conflicts or overwritten per a per-calendar setting. Auto-push-on-valid (skipping the `ready` gate) is available as an opt-in on vault-owned calendars only. This opt-in is the one sanctioned exception to principle 3, and it earns its rationale like every other exception: the opt-in is itself a standing signal, scoped to a calendar with a single writer, and the attendee gate still applies per-write.
- Remote-owned — read-only mirror. Push transitions are unavailable and the UI says so; `state: ready` on a note targeting a remote-owned calendar produces a visible warning, not silence (`state: draft` does not — drafts are local-only planning and legitimate on any calendar). Field edits on a live note linked to a remote-owned record are divergence, not intent: *dirty* divergence (§5.3) surfaces immediately in Needs Attention with revert and copy-out actions and is overwritten by the next inbound — the attention item preserving the overwritten values; preservation items resolve by acknowledgment, never self-dismissal, since the displacement is historical and has nothing to resolve to (§14.3) — while not-dirty divergence follows §5.3's inert/grace path unchanged, so vault-sync flight skew on mirrored calendars never prompts. The §5.3 grace prompt's "push" action does not exist here; the §4.2 item preempts it. ICS feed calendars are always remote-owned.
- Bidirectional — full reconciliation per §5.

Default for newly added CalDAV calendars: remote-owned. Rationale: the danger analysis in §6 is an analysis of shared calendars; the safe default is the one that cannot write.

### 4.3 Secrets

Accounts use one of two credential types: app-password (HTTP Basic) or OAuth token source (Bearer; §4.4). Credentials are stored in Obsidian SecretStorage when available (≥ 1.11.4), with fallback to `data.json` accompanied by a persistent settings-screen warning on older versions. Credentials never appear in frontmatter, records, logs, or exported files. The README must not claim encryption at rest until Appendix A item 1 is verified. App-passwords are recommended in onboarding as blast-radius limitation regardless of storage.

### 4.4 OAuth accounts (Google)

Google accounts authenticate with OAuth 2.0 against the CalDAV v2 endpoint. The engine is unchanged; `tsdav`'s OAuth support handles Bearer authentication and token refresh.

- Flow: Authorization Code with PKCE and a loopback redirect. The plugin runs a transient local HTTP listener (Node API; desktop only), opens the system browser to the consent page, and exchanges the returned code. The refresh token is stored per §4.3. Mobile devices cannot run the listener; authorization happens on desktop. Whether the stored token reaches mobile depends on SecretStorage cross-device behavior (Appendix A item 7).
- v1 posture — bring-your-own credentials: the user creates a Google Cloud project and a Desktop OAuth client and enters their own client ID and secret. Rationale: no verification process, no user cap, and no client secret embedded in an open-source repository. The setup guide must instruct users to publish their OAuth app to production (unverified) status; apps left in Testing status expire refresh tokens after seven days, forcing weekly re-authorization.
- v2 stretch goal — shared client ID: ship one client ID so users skip Cloud Console entirely. Requires Google's verification for the sensitive Calendar scope (privacy policy, brand verification, periodic re-review; Appendix A item 9). Not a v1 commitment.
- Limitations: Google over CalDAV is events-only — no VTODO (Google Tasks stays out of scope, §17) and no managed attachments. RFC 6578 support and iTIP behavior on attendee writes require verification (Appendix A items 8 and 10); until verified, the attendee gate (§5.5) is assumed maximally live on Google calendars.

## 5. Sync engine

### 5.1 Loop

Per calendar, on a configurable interval and on manual command:

1. Incremental: `sync-collection` REPORT with the stored sync-token. Fallback where RFC 6578 is unsupported or the token is rejected: compare CTag; on change, `calendar-query` over the sync horizon and diff against records — diffing only records whose events intersect the horizon window. Out-of-horizon records are untouched by the fallback; without that scoping, every token rejection would misread all historical records as remote deletions. Absence from fallback results never mints a tombstone directly: a `calendar-query` reports what intersects the window, not what exists, and a record whose event was rescheduled across the horizon boundary since the last good sync intersects the window while its server resource does not. The absent set — normally small: true deletions plus boundary-crossers — is confirmed at href level in one batched `calendar-multiget` (records store resource hrefs): a `404` confirms the deletion and mints the remote-observed tombstone; a `200` reveals the move, updates the record, and the record thereafter follows the out-of-horizon staleness acceptance (§5.7). Rationale: remote-observed tombstones drive banners, orphaning, and eventual pruning of exactly the fields rebuild cannot recover; an inference that one cheap batched request can replace with observation must not be load-bearing.
2. For changed hrefs: `calendar-multiget`, locate records by (this collection, UID) — equivalently by resource href, which records store — and apply inbound changes (§5.4). A reported href with no record mints one, in or out of horizon, per §5.7's membership policy.
3. For local pending changes (§5.3): validate, serialize, push (§5.5).
4. Process tombstones (§5.6).

Failed requests retry with exponential backoff. Writes to one server are serialized; reads are batched via multiget. Rationale: self-hosted servers are routinely slow or flaky; hammering them converts flakiness into data races.

### 5.2 Feeds

ICS subscription feeds are re-fetched whole on the same interval and diffed against records by (collection, UID), using a content hash of the normalized component as the change marker with `SEQUENCE` as tiebreaker — many feed generators stamp a fresh `DTSTAMP` on every fetch, which as a marker would rewrite every feed record on every poll. Feed records are never push targets.

Three gates precede any feed diff, cheapest first. First, a fetch that does not parse as a complete `VCALENDAR` is discarded whole — no diff, one logged line — which disposes of truncated responses and login-wall HTML before they can masquerade as mass deletion. Second, enumeration is horizon-clipped while existence is not: records are minted and updated only for events intersecting the horizon (§5.7 — a decade-spanning holiday feed does not deserve a decade of records), but *vanished* is computed against the unclipped fetched file, because an event outside the window yet present in the file is out-of-horizon, not deleted — the feed analogue of §5.1's confirmation rule, where there is no href to confirm and the whole file is the confirmation. Third, mass vanishing is anomalous before it is deletion: when more than a threshold share of a feed's records vanish in one poll (default one quarter of them and at least five, both configurable), tombstones for the vanished set are held and one feed-level anomaly surfaces instead of per-event banners. The vanished and appeared sets are then content-paired: pairs found means the generator mints fresh UIDs per fetch, and the anomaly offers a sticky per-feed switch to content-derived identity; no pairs means truncation or outage upstream, and a following poll that restores the events clears the hold silently. Held tombstones apply only on the user's explicit accept. Accepting the identity switch is a bulk re-key, not a bulk deletion: the feed's records migrate to content-derived identity in the accepting poll, the content pairing that diagnosed the instability supplies the old-to-new mapping, and venue pointers and materialization entries transfer along it — no per-event banners, no tombstones for the re-keyed set. Events the pairing could not match fall out as ordinary vanish-plus-appear under the new identity: the stated cost of content keying, incurred once. Rationale: feeds are stage 1 — the release whose entire job is demonstrating trust on the read path — and a misbehaving generator must produce one legible question, not a banner storm.

An event genuinely vanishing from a re-fetched feed — fetch parsed complete, absent from the unclipped file, below the mass-vanish threshold — produces a remote-observed tombstone: `DELETE` is unreachable for feeds regardless, and the typing drives the banner.

Feed identity tolerates what feed generators actually emit, not what RFC 5545 requires of them. A UID present and unique within the feed is the identity, per §3.2. An event lacking a UID receives a synthesized identity — a content-derived hash of the normalized component, standing in the UID position of the (collection, UID) pair — with the limitation stated plainly: a content-keyed event has no cross-edit identity, so an edit is a vanish-plus-appear and continuity (venue pointer, materialization) does not survive it. Duplicate UIDs within one feed are disambiguated by the same content hash and raise the feed-level anomaly, being the same species of generator misbehavior. Rationale: real generators omit UIDs, duplicate them, and re-mint them per fetch (Appendix A item 23), and the identity keystone must not shatter on the first thing users touch.

### 5.3 Local change detection

The plugin watches `metadataCache` change events on notes bearing a `uid` or a `state` key — the latter because first pushes happen on notes that have no UID yet. Event-relevant frontmatter changes are pushed after a debounce (editor idle plus a few seconds, batched). Derived content (description, attachments) is additionally checked by comparing a fresh render hash against the record's stored hash at sync time, because embeds mean the inputs span multiple files (§9.5).

Divergence alone is never intent. The pending set is derived — any live note whose declared fields differ from its record's base snapshot — but a divergence is *pushed* only when the note is in the device-local dirty set and the calendar's mode permits push (§4.2 governs remote-owned): paths whose modification events this device itself observed. Writes performed by Davenport itself — inbound application, adoption backfill, `state`-key removal — never enter the dirty set; since Obsidian tags no write origins, self-writes are recognized by expected-content matching (the watcher compares the changed file against the plugin's just-written content), whose misattributions are benign in both directions — a swallowed user edit degrades to the surfaced path, and a self-write mistaken for the user yields a dirty entry over a divergence that lasts only until the base snapshot write lands (the apply order writes the note first), the entry clearing with it under the clear-on-no-divergence rule below; where a crash interrupts that pair, the surviving entry's push meets `If-Match` and converges — §5.4's backstop. Dirty entries are generation-stamped (a per-path sequence or the content hash captured at push start): clear-on-success removes an entry only if no modification event postdates the push snapshot, so an edit made during push flight stays dirty and pushes next loop instead of degrading to a delayed prompt. Entries also clear when the divergence disappears.

Divergence without a local dirty entry is held inert as presumed vault-sync flight (the record and note arrive as separate files in no guaranteed order; a record can precede its note, and treating that skew as an edit would push stale values and silently revert edits made on another device). If an unexplained divergence persists past a grace period after the last vault write to either file (default 10 minutes, configurable in Sync settings), it is surfaced in Needs Attention — never auto-resolved. The surfaced item must show the divergent values per field (the user cannot otherwise know which side is stale), must default to inspect rather than push, and self-dismisses when the divergence resolves (§14.3): its designed resolution is a late-arriving file, not a click. Derived-content divergence is exempt from grace surfacing entirely — a fresh render differing from the stored hash is *explained* by §9.5's documented snapshot semantics; the fresh-render comparison's only job is deciding whether description and attachments participate when a push is already happening (dirty declared fields, or the explicit refresh command). Orphaned and suspended notes are likewise exempt from grace surfacing — the banner is their surface, and a second prompt whose push action is wrong in both states would be noise (Appendix B.1). Edits made outside Obsidian while it is closed are indistinguishable from sync arrival and intentionally take the surfaced path rather than auto-pushing. Loss of the dirty set (device-local, §3.3) therefore degrades to a question, not a wrong write — and where a same-field remote change would erase the divergence before the grace prompt can fire, §5.4's not-dirty preservation carries the displaced value, so the question survives the overwrite.

### 5.4 Inbound changes and conflicts

Inbound application is a field-level three-way comparison: local declared fields vs. the record's base snapshot, and the remote event vs. the same base — with one gate inherited from §5.3: the "local changed" leg requires the note to be *dirty*. Not-dirty divergence is presumed flight and takes the inbound apply; without this, flight skew plus a concurrent remote change raises a conflict offering a stale value nobody intends, while the user's actual last edit isn't on the ballot. (A real offline edit whose dirty entry was lost thereby loses conflict detection — and lands in §5.3's surfaced-question path, the designed loss mode.)

- Remote changed, local unchanged (the note's value equals the base): apply remotely changed fields to the record and, where a note is linked (per §7.1's mutual-claim rule), to its frontmatter via `processFrontMatter`; update the base snapshot. Vault-sync flight lands here by construction — a stale note copy carries the previous base value — so flight skew stays silent.
- Remote changed, local changed but not dirty (three distinct values on a not-dirty note): apply the remote value exactly as above — the dirty gate's rationale stands, and flight-adjacent states must never raise conflicts — but preserve the displaced note value in an acknowledgeable attention item with revert and copy-out actions, mirroring §4.2's remote-owned handling. Rationale: this is the one path where an edit the engine cannot attribute (made outside Obsidian while closed, or whose dirty entry was lost) meets a same-field remote change; without preservation the overwrite is silent — the counterexample to §5.3's degrades-to-a-question guarantee. The three-way comparison already computes the discriminator; the rule adds no machinery, only a surface.
- Local changed (dirty), remote unchanged: no inbound action; the local change pushes per §5.5.
- Both changed, different fields: merge silently — apply the remote fields, keep the local fields, push the local ones. Rationale: "remote moved the meeting, I edited my description" is the common case and surfacing it trains users to ignore conflict prompts.
- Both changed, same field, same value: convergence, not conflict — inbound application is a no-op whenever remote equals base or remote equals local. Rationale: the same user's edit routinely arrives at a device twice, once by CalDAV and once by vault sync; raising a modal for it is the prompt-fatigue failure this section exists to avoid. A same-field conflict requires three distinct values.
- Both changed (dirty), same field, different values: conflict. Surface it (modal or note-level marker with both values); never resolve by last-writer-wins. The user's choice updates frontmatter, record, and — if the local side wins — pushes.

Application writes in a mandated order: the linked note first, the record and its base snapshot second — the base snapshot may lag the note it summarizes, never lead it. A crash after the note write leaves local equal to remote over a stale base, which the next loop resolves as silent convergence (remote-equals-local is a no-op above); the reverse order fabricates a divergence the user never made — a note trailing a prematurely advanced base reads as changed-but-not-dirty against an "unchanged" remote — and self-heals only where another device's symmetric apply delivers the missing note write, degrading to a §5.3 grace question on a single-device vault. If the interrupted self-write escapes expected-content matching and enters the dirty set, the resulting push meets `If-Match` on the server's advanced etag and converges — backstop, not design. Stated for §10.4's reason: where a crash can land between two writes, which write goes first is a design decision, not an implementation accident.

Every device applies every inbound change to the same linked note, so per-note write determinism is load-bearing: convergence requires `processFrontMatter` to emit identical bytes for identical inputs across devices (Appendix A item 11, a design input; if verification fails, a designated-writer rule is required before stage 2). Concurrent edits to the same note on two devices resolve at the sync-tool layer, outside the plugin; the tool's output can re-enter §5.3 as dirty, and the `If-Match` path plus the attendee gate are the named backstops — the engine does not see every divergence first.

Remote deletion of an event with a linked note is governed by a per-calendar setting with two values. **Flag** (the default): write the remote-observed tombstone (§5.6) and banner the note; the file survives. **Remove**: additionally move the note to trash — through Obsidian's trash API, honoring the user's deleted-files preference, never a permanent delete — but only when Davenport created the note and its content still matches the materialization-time content hash the record stored at creation (§7.3). A note the user has touched, or one Davenport did not create, degrades to flag with the reason logged: the option exists to clean up hollow mirror notes, and it must never delete words a user wrote. The tombstone is written before the trash operation, for §10.4's reason — the crash-reachable intermediate (tombstone present, note still present) is an ordinary orphaned note, while the reverse order would leave a live record with a dangling pointer masquerading as a user deletion. Trashing under this setting carries acknowledgment semantics (§5.6: deleting an orphaned note acknowledges), so the tombstone becomes claimant-free and prunable after retention. Another device receiving the trashed note before the tombstone record surfaces a transient dangling-pointer item that self-dismisses on the tombstone's arrival (§14.3). The setting governs the linked note file only; materialized venue sections always stay (§7.5).

### 5.5 Push semantics

Every `PUT` sends `If-Match` with the record's etag (or `If-None-Match: *` for creation). Creation `PUT`s target `{uid}.ics` within the collection — servers can be picky about basename/UID agreement — and a `412` on creation means another device already created this UID: fetch and converge rather than error. A `412` on update is a conflict signal: pull the resource, run §5.4, retry only after resolution. Every successful write bumps `SEQUENCE` and updates the record's etag, base snapshot, and hashes. The precondition machinery is a named backstop (§5.4, §6.1, Appendix B row 25) only where the server enforces preconditions; enforcement per provider is verified, not assumed (Appendix A item 24), and the pre-stated branch for a non-enforcing server is per-provider documentation plus a per-account trust caveat in §14.4 — nothing mechanical substitutes for a precondition the server ignores, so the caveat's job is keeping the limitation legible rather than discovered.

Round-trip rule: pushes are patches applied to the record's base ICS, never regeneration from the frontmatter schema. Every property the plugin does not model — vendor `X-` properties, VALARMs it didn't create, structured locations — survives untouched. Rationale: regeneration silently strips other clients' data on every write; users experience this as "Davenport deleted my alarms."

Attendee gate: any `PUT` or `DELETE` targeting a resource that has, would gain, or would lose `ATTENDEE` properties requires per-write confirmation, in every mode, with no opt-out. The gate is a predicate, not a list — enumerations of gated verbs have been found incomplete twice. Illustrative cases: creating an event with attendees; adding an attendee; removing one (the removed party receives `CANCEL`); changing time — where "time" includes `rrule`, `duration`, and `timezone`; deleting an attendee-bearing event (iTIP `CANCEL` to all); any other organizer modification servers may propagate as updates, including summary, location, and description — the §9.5 refresh command included. Err toward over-gating. Rationale: scheduling-capable servers email attendees on write; email cannot be unsent.

### 5.6 Deletion and tombstones

Tombstones are typed by origin: local-intent (a user's retraction or deletion decided on some device) or remote-observed (the server no longer has the resource). Only local-intent tombstones issue `DELETE` (with `If-Match`); remote-observed tombstones never write to the server. A `DELETE` answered by `404` is success — another device got there first. A `DELETE` answered by `412` means the resource changed after the deletion was decided; surface it — delete anyway, or keep — never force with a refetched etag. `Keep` clears the tombstone: the record revives to live, re-fetches the changed resource, and re-enters §5.4; the pointer is retained where a note still claims the identity, otherwise the revived record lands venue-less in routing/inbox — for §10.4's keep-both this is exactly right, since the note belongs to the successor identity and the inbox holds the old event for re-homing. Tombstone type is monotone: remote-observed may upgrade to local-intent, never the reverse; typing is a genuine two-writer race on one record file (one device tombstones local-intent while another observes the server deletion first), so every device re-canonicalizes to the strongest type it has seen on its next loop — the strongest-seen memory is device-local (§3.3), and its loss degrades to a best-effort banner correction, which is acceptable because the stakes are label-only in every reachable race (the `DELETE` has already succeeded; nothing resurrects) — one rewrite, then stable — and a conflict-copy record differing from its sibling only in type auto-resolves by dominance (§3.2). Tombstoned records retain the tombstone for a retention window before pruning; a tombstone whose identity a note still claims is never pruned until the note's banner is acknowledged (acknowledgment strips the note's `uid` and `state`, returning it to a plain note with fields intact) — pruning under an unacknowledged claim would let a later same-UID resource silently bind to a stranger. If a remote-observed tombstone's resource reappears server-side within the window, the record revives to live; an unacknowledged orphaned note relinks with its banner self-dismissing, and orphan-era dirty entries clear — orphaned's contract was "the event is gone, edits are local-only," and revival must not convert that promise into a push, so post-revival divergence takes the inert/grace path and surfaces as a question (the deliberate asymmetry with suspended, whose contract is "temporarily unreadable, will resync" and whose dirty survives rebuild, stands). Reappearance after acknowledgment is a revival that lands unlinked within retention and a genuinely new record after pruning; both route to inbox, and no-auto-bind holds in both. When a remote-observed tombstone in one collection pairs with a same-UID resource appearing in another collection of the same account, Davenport surfaces a *move suggestion* on the orphaned note — accept updates `calendar:` and transfers the venue pointer; never automatic, and suppressed (or caveated) when both sides carry `ATTENDEE` data suggesting invited copies rather than a move. Cross-account same-UID never suggests — it is more likely an invited copy than a move — and the manual path is stated for discoverability: acknowledge the banner, then adopt. Tombstones live in the ledger, not device-local storage. Rationale: a deletion decided on one device must reach the others via vault sync, or the next pull on another device resurrects the event; the origin typing exists because a tombstone whose origin the reader cannot determine could otherwise escalate a misdiagnosed remote deletion into a `DELETE` against a live event.

One acknowledged mislabel: a device may observe a server deletion (and banner the note "remotely deleted") before the originating device's local-intent tombstone record arrives by vault sync. The states converge; when the local-intent tombstone arrives, the banner is corrected to reflect that the deletion was the user's own.

A note file deleted while Obsidian is closed produces no vault event; the plugin discovers a record whose note pointer dangles. A dangling pointer never auto-deletes the server event. Resolution first checks whether a different path now bears the identity — a rename while Obsidian was closed looks exactly like deletion-plus-new-file — and offers relink first. Venue notes bear no identity, so their relink check is different by necessity: records pointing at the vanished path are matched against a same- or near-named file appearing near-simultaneously, using §6.3's fuzzy machinery, since some sync tools deliver renames as delete-plus-create pairs (Appendix A item 21). Materialization-map entries for a vanished venue are cleared only after resolution concludes *deletion* — user-confirmed, or relink declined or failed — never eagerly, because the map is a crown-jewel field rebuild cannot recover and the "deletion" may be a rename still resolving. Otherwise, for a *live* record, the plugin surfaces the choice: retract (local-intent tombstone), unlink (record continues without a venue), or restore the note from the record. For a tombstoned record those options are nonsense; deleting an orphaned note counts as acknowledgment — deletion is a stronger act than the banner click — leaving the tombstone claimant-free and prunable after retention.

An event leaving the sync horizon (§5.7) is not a deletion. Horizon exit and tombstoning share no code path.

### 5.7 Sync horizon

Each calendar syncs a configurable window (default: past 3 months, future 12 months) via `calendar-query` time-range filters. Backfill beyond the window is on-demand per calendar. Recurring series that intersect the window are pulled whole, not clipped.

Membership policy: sync-tokens govern ledger membership; the horizon governs enumeration and views. `sync-collection` is protocol-unscoped — the server reports changed hrefs with no regard for any time window — and every reported href is fetched and applied; a reported href with no record mints one, in or out of horizon (§5.1). Rationale: the token has advanced past the change, so ignoring a reported href discards knowledge the protocol will not repeat, and which hrefs to ignore is exactly the kind of choice that must not be made silently at implementation time. Initial enumeration is horizon-scoped, so the ledger starts horizon-sized and grows past the horizon only by increments the server itself reported, by §5.1's confirmed boundary-crossers, and by explicit backfill. Feeds are horizon-clipped with an unclipped existence check (§5.2).

Two consequences are accepted and written down. First, out-of-horizon records are retained but excluded from fallback diffing and from views until the window covers them; they can go stale, and staleness is caught by `If-Match` on the next push (§5.5) or by the token on the next remote change — §9.5's acceptance pattern applied to the ledger. Second, an event created beyond the future edge and never modified is invisible to the token (nothing has changed since) and to the initial enumeration (nothing intersected), so when the future edge of the window advances past a granularity (default one day), the engine runs a `calendar-query` over the newly included slice and mints records for unknown resources found there. The CTag fallback needs no such step — its full-window query re-enumerates slide-ins by construction; the delta query makes token mode do deliberately what the degraded path does by accident.

Scale envelope, stated so implementation knows what to test against: bounded membership keeps the ledger horizon-sized — a busy calendar at the default window runs to hundreds of records, several accounts of busy shared calendars to low thousands. Thousands of small markdown files sit comfortably in `metadataCache` and sync-tool working sets, and determinism plus write-if-changed (§3.2) holds steady-state churn at zero. Tens of thousands — deep backfills across many calendars — is outside the envelope; the levers are per-calendar horizon overrides, backfill restraint, and leaving high-volume calendars unsynced. Magnitudes are verified under load in the test plan.

## 6. Event lifecycle

### 6.1 States

- `state: draft` — the note has event fields; Davenport renders it on local calendar views; no server interaction occurs. Drafts are a supported planning workflow, visible alongside live events.
- `state: ready` — the user has signaled push intent. Validation runs; on pass, the event is created on the server, a record is minted, and the note is live.
- Live — a record exists for the note's `uid`. Subsequent edits flow per §5.3 without re-signaling, subject to the attendee gate. Rationale: the dangerous transition is creation (claims a UID, may notify people); modification of an already-shared object is what users expect to propagate.

The `ready` signal is written identically by any of: a "Push to calendar" command, a button on calendar/agenda views, the quick-add confirm (§8.2), or hand-editing frontmatter. Field and command are one mechanism, not two. On successful push the plugin removes the `state` key: absence of `state` plus presence of `uid` reads as live, and a permanent `ready` value would be stale text masquerading as state.

Hand-editing `calendar:` or `type:` on a live note is not a supported operation: both imply delete-and-recreate across collections (a calendar move, or conversion between event and task). The change is surfaced in Needs Attention with revert offered. `uid` joins the same guard, in both directions: an identity that appears or changes by non-plugin write is surfaced and *never auto-bound* — §3.4's rationale applies verbatim to the note-side claim, and the sharp case is a duplicated note whose original was deleted, which would otherwise bind to a live shared event and push an un-signaled reschedule — with the §3.4-style recovery offered ("this looks like a copied note — strip to draft?"); an identity *deleted* by hand is surfaced with unlink offered. The self-write exclusion (§5.3) is the discriminator throughout. Rationale: field-and-command equivalence holds for signals, not for operations with server-side sequences, and least of all for identity. Two hand-edit cells with defined outcomes: `state: ready` re-added to an already-live note is stripped as satisfied (logged, no re-push — the identity already exists, and creation would only 412 into convergence anyway); `state: draft` added to a live note is surfaced like other unsupported hand edits — demotion has server-side legs, so the revert command is offered and a hand-typed field never triggers server deletion. Deleting `calendar:` or `type:` counts as changing it. Separately: `ready` executes wherever it is observed, dirty-set-independent — a `ready`+`uid` note arriving by vault sync on a second device is executable there, creation being race-safe via `If-None-Match: *` (§5.5); the device that executes is the device that prompts any attendee gate. Execution is gated by §6.2's identity clause: `ready` on a note whose identity resolves to a tombstoned or quarantined record never executes — the un-cancel gesture must not resurrect.

Execute-anywhere presumes credentials, and credentials may not travel (SecretStorage cross-device behavior is Appendix A item 7). A device lacking an account's credentials marks that account disabled-on-this-device — stated on the §14.4 card, not discovered through failures — performs no retries against it, and leaves the account's push and pull work for credentialed devices. The designed path for an edit made on an uncredentialed device is likewise stated rather than left emergent: its dirty entry can never push locally, so the edit reaches the server through the note file arriving on a credentialed device, where the divergence is not dirty and takes §5.3's grace-surfaced path — a prompt, not an automatic push, and acceptably so; the alternative is teleporting dirty state between devices, which §3.3 prohibits for cause.

### 6.2 Validation

Validation gates every push and never triggers one. A push requires: resolvable `calendar` accepting the component type, a `start` (or `date`), an `end`, `duration`, or all-day end, a parseable `rrule` if present, no self-contradictory shape (`date` alongside `start`, or `end` alongside `duration`, fails naming both keys — §3.1), enum fields within their vocabularies, no template-minted or duplicate `uid`, and no identity resolving to a tombstoned or quarantined record — the failure states the reason legibly ("this identity ended in a tombstone; acknowledge the banner first — a later push mints a fresh identity" / "this record is quarantined; resolve it first"), since a hand-typed `ready` on an orphaned note is a plausible un-cancel attempt and executing it would resurrect what §5.6 exists to keep dead. Failures surface as note-level warnings distinguishing "not pushed: draft" from "not pushed: invalid," with the failing field named. Nothing is silently skipped.

### 6.3 Adoption

First contact with an existing calendar and an existing vault requires linking, not duplication:

- Adoption onto a note that already bears a different identity is refused, with venue-linking offered instead — one note holds one identity slot; many events per note is the venue mechanism (§7.1), not multiple `uid`s.
- A "link note to existing event" command sets the record's venue pointer, backfills `uid` and `calendar:` into the note (§3.4: both are required for resolution), backfills the record's modeled fields into the note's frontmatter so the post-link diff is empty (the modal previews exactly what will change before linking), and strips any `state` key. It performs no server write. Rationale for the field backfill: without it, the note's pre-existing fields diverge from the base the moment linking completes, and the pending machinery would push those stale fields over an existing — most likely shared — event with no signal ever given.
- The venue pointer and materialization map are user-chosen determinism inputs, so two devices choosing differently is a race determinism cannot resolve — different choices are different inputs, and the sync tool's file resolution would otherwise discard one user's action silently, on exactly the fields rebuild cannot recover. v1's rule is detection, not merge: a device whose own pointer or map write is superseded by a differing arrived value surfaces the mismatch with both candidates named for the user to pick. Silent last-writer-wins is prohibited here as everywhere.
- On first sync of a calendar, Davenport suggests fuzzy matches (title and date proximity) between unlinked records and unlinked event-shaped notes. Suggestions are offered, never auto-applied.

### 6.4 Retraction

Three distinct commands, all tombstoning the record: delete note and event; revert to draft (event deleted, note keeps event fields, `uid` stripped, `state: draft` — a later push mints a fresh identity, because the old one ended in a tombstone); remove from calendar, keep note (event deleted, `uid` and `state` stripped).

## 7. Venues and routing

### 7.1 Model

A record optionally points at a venue: a note (or a note plus section) that holds the event's meaning. The venue does not enumerate its events; calendar views, agenda widgets, and "linked events" panels are projections querying the ledger for records pointing at the venue. One venue may receive many unrelated events (a running 1:1 note per person). "Linked," wherever the spec uses it, is defined by *mutual claim*: the record's pointer targets the note *and* the note's `calendar:`+`uid` resolve to that record. A pointer without a reciprocal claim is venue-routed or dangling — record-only apply (§5.4), never a note write. This is the operational discriminator between the pointer's two roles, and it is what keeps a stale pointer (e.g. §10.4's old record aiming at a note that now claims the successor identity) from writing another event's fields into the wrong note. Rationale: per-event frontmatter arrays on shared notes churn the file on every reschedule; body-embedded event syntax makes prose a sync surface. Both were rejected.

### 7.2 Routing

Inbound events find venues by precedence:

1. Explicit assignment (drag onto a note; picker modal).
2. Rules: predicates over calendar, summary pattern, and attendees, mapping to a venue and a materialization template. Attendee predicates resolve through the person-note index (§8.4). Rules may live in settings or as a claim block in the venue note's frontmatter ("this note claims events matching X"); note-resident claims keep configuration next to its subject, and claims evaluate before settings rules — the more specific declaration wins.
3. No match: the inbox — records without venues, listed in the agenda/inbox view, materializable on demand.

### 7.3 Materialization

Materialization is lazy: pulling an event creates a record, not a note. Notes and sections are created when the user opens the event (or via an explicit materialize command). Rationale: eager scaffolding fills the vault with hollow notes for meetings that never get notes taken.

Per rule, materialization targets either a new note from a template (§8.1) or an appended dated section in the venue note from a section template. The record stores what was materialized, including a content hash of the created note taken at materialization — the untouched discriminator for §5.4's remove option. Materialized content belongs to the user immediately; if the event later moves, the record updates and any date rendered into the section heading goes stale. This staleness is accepted and documented: content written about a meeting that then moved is a historical artifact. Live-rendered inline time widgets are a possible later alternative to static interpolation; static interpolation into prose is never updated by sync.

### 7.4 Daily notes

The daily-note integration is a routing rule whose venue is date-matched rather than attendee-matched, plus a codeblock the user's daily-note template can call to render the day's events with a configurable line format. Materializing into a date-matched venue that does not exist yet creates the daily note through the daily-notes core plugin's settings. Davenport does not own daily-note rendering.

### 7.5 Venue deletion semantics

Event cancelled remotely: record gains a remote-observed tombstone (§5.6); materialized sections stay, optionally annotated. Venue note deleted: records lose their pointer and fall back to routing or inbox; no server write occurs. The venue was authoritative for narrative, not existence.

### 7.6 Scoped quick-add

Quick-add invoked from a venue note inherits that note's claim-rule context: calendar, attendees, template, and venue link.

## 8. Templating

### 8.1 Inbound templates

Materialization templates interpolate event fields: `{{summary}}`, `{{start}}`, `{{end}}`, `{{attendees}}`, `{{location}}`, `{{description}}`, `{{conferenceUrl}}`, `{{calendar}}`, `{{date}}`. `conferenceUrl` is parsed from conference-related `X-` properties and description contents, since providers place meeting links inconsistently. Templates are selected per routing rule, with per-calendar defaults.

Templates fire once, at materialization. Materialization always writes an explicit `summary` key (§3.1: filename-derived titles are never re-evaluated for live notes) and an explicit `calendar:` key (§3.4: note→record resolution requires it). Materialization-map writes are subject to the §6.3 supersession rule: a device whose map entry is overwritten by a differing arrived value surfaces the mismatch rather than accepting silent last-writer resolution. Sync never re-renders template output. Templates must not set `uid` or `state: ready`.

### 8.2 Outbound: event types and quick-add

Event types are user-defined presets: default duration, calendar, `type`, recurrence, alarm, `class`/`transp` defaults, expected fields, and a body template. Expected fields give validation ("this 1:1 has no person") and make typed events queryable.

Quick-add parses natural language ("lunch with Sam tuesday 1pm") via `chrono-node` into a pre-filled confirm modal typed by event type. Confirming is the `ready` signal. Quick-add never writes to the server without the modal.

### 8.3 Template engine posture

Davenport implements plain `{{field}}` interpolation so it works standalone. When Templater is installed, templates may be Templater templates and Davenport passes event context as arguments. Davenport does not implement conditionals, loops, or its own scripting. Rationale: reimplementing Templater badly and hard-depending on it are both known failure modes; the two-tier approach avoids both.

### 8.4 Person notes

Attendee identity is derived from the vault, not stored in configuration. A person note declares its addresses in frontmatter (`email:` or an `emails:` list; the key name is configurable, default `email`). Davenport indexes notes bearing the key via `metadataCache`, optionally scoped to a folder. Rationale: who a person is belongs to the vault, versioned and edited where the person lives — the same principle as venue claim blocks — and a derived index removes a settings table that would otherwise be maintained by hand forever.

The index serves: inbound templates (`{{attendees}}` renders matched addresses as links), routing predicates (§7.2), scoped quick-add (§7.6), and outbound attendee resolution (naming `[[Jane Doe]]` on an event supplies her address for `ATTENDEE`, subject to the attendee gate). Unmatched addresses render as plain text, with a "create person note" action in agenda and note context menus. Two notes claiming one address is detected and surfaced, like duplicate UIDs (§3.4).

The user's own addresses — required to locate the user's `ATTENDEE` entry for RSVP (§12) — come from the account principal's `calendar-user-address-set` at discovery, with a per-account manual fallback. CardDAV integration remains out of scope (§17); it could later populate person notes, not replace them.

## 9. Description and attachments

### 9.1 Direction

`DESCRIPTION` and `ATTACH` are one-way, render-on-push projections from vault to server. Remote edits to them are never merged back into markdown; per ownership mode they are flagged or overwritten. Rationale: a rendered description cannot be merged back into its markdown sources, and treating the note body as bidirectional would make all prose a sync surface.

### 9.2 Description sources

Per calendar (overridable per event type), the description source is one of:

1. The `description:` frontmatter field. The global default for every calendar — explicit and small, so safe unconditionally.
2. A delimited body region (content under a configurable heading, default `## Description`). A per-calendar opt-in, suited to personal calendars.
3. The whole body. Opt-in only; enabling it presents a warning that descriptions on shared calendars are visible to every attendee.

Independently, a per-calendar option appends an `obsidian://` backlink to the note via the `URL` property or a description footer. The backlink embeds the vault and note names; on shared calendars attendees can read both, so this option carries the same visibility warning — filenames are content.

### 9.3 Embeds

Description rendering resolves `![[File]]`, `![[File#Heading]]`, and `![[File#^block]]` via `metadataCache`, stripping embedded frontmatter, with a recursion depth limit and cycle detection. Markdown renders down to plain text (`DESCRIPTION` is text): formatting stripped, `[text](url)` → `text (url)`, wikilinks → plain names or `obsidian://` URIs per setting. `ical.js` performs escaping and line folding. An HTML alternative via `X-ALT-DESC` is optional and gated on Appendix A item 4. Media embeds (`![[diagram.png]]`) promote to attachments (§9.4) and leave a `(attached: diagram.png)` placeholder in the text. Nothing is silently omitted.

### 9.4 Attachments

The `attachments:` list maps to `ATTACH`, one mechanism per entry:

1. External URL → `ATTACH;VALUE=URI`.
2. Vault file, server advertises RFC 8607 managed attachments → POST the file; the server hosts it and rewrites the URI. Capability is probed at discovery, never assumed (Appendix A item 3).
3. Vault file, otherwise → inline `ATTACH;ENCODING=BASE64;VALUE=BINARY`, with `FMTTYPE` from MIME detection and `FILENAME` set, subject to a configurable size cap. Files over the cap fail validation with the file named. Rationale: inline attachments ride along on every fetch by every client and hit server size limits.

Attendees receive attachments; the §9.2 shared-calendar warning covers attachments explicitly.

Inbound `ATTACH`: URL attachments render as links in materialized content; inline binaries are offered as a save-to-vault action, never auto-written.

### 9.5 Snapshot semantics

Derived content is rendered at push time from potentially many files. The record stores a hash of each rendered output; change detection compares a fresh render at sync time (§5.3). Embedded sources changing after push do not trigger automatic re-push. A "refresh description/attachments" command re-renders and pushes on demand — on attendee-bearing events this is a gated write (§5.5) — and optional re-render occurs on lifecycle transitions. Rationale: dependency-triggered auto-re-push requires an embed build graph and generates "event updated" noise on attendees' calendars; eager freshness is the wrong default for shared events. The snapshot behavior is documented user-facing.

## 10. Tasks and time blocks

### 10.1 Types

`type: event` — fixed time, external commitment; maps to VEVENT. `type: task` — deadline, flexible scheduling; maps to VTODO (`due` → `DUE`, `start` optional, `completed`, `priority`, subtasks later via `RELATED-TO`). `type: block` — time claimed for a task; a VEVENT whose `task:` key links the task note it serves. Completing a block offers to mark its task complete — an offer, not an automatic write, because a block ending does not prove the work is done.

### 10.2 Targets

Tasks push only to collections whose `supported-calendar-component-set` includes VTODO; discovery enumerates task lists as first-class registry entries. Pushing a task at an events-only calendar fails validation with a message naming the mismatch and offering the block fallback: schedule the task's work time as a VEVENT. Rationale: iCloud reminders and Google tasks are unreachable (§2.1); time blocks are the workflow that routes around both silos and stand on their own (drag task to calendar → block; completing the block completes the task).

A per-calendar option materializes task deadlines as all-day events on an events-only calendar.

### 10.3 Completion

Task-note completion lives in frontmatter (`completed` timestamp; `status` mapping to `COMPLETED`). Inbound completion from other VTODO clients updates the frontmatter. Checkbox-line integration (Tasks-plugin syntax) is a later, explicit opt-in that declares specific lines as a sync surface; it is not in the base design.

### 10.4 Transmutation

"Convert task to event" and "convert event to task" are commands, restored to the roadmap now that their design is no longer transactional. The original specification treated conversion as an atomic ordered sequence — the spec's only online-only, out-of-loop server writer — and every cost two review rounds found in it flowed from that framing. The atomicity protected against entanglements (resurrection, misread deletions, identity confusion) that the current machinery independently eliminates, so the operation decomposes into two ordinary, idempotent engine behaviors with no required order:

The convert command first pre-validates the rewritten form per §6.2 — including component-type acceptance at the target collection, the likely failure — before writing anything, then executes entirely locally, with no server calls, in a mandated order: first the local-intent tombstone on the old record, annotated with the successor identity ("converted to (collection, uid)"); then the note rewrite as a plugin self-write — new `type`, remapped fields (`start`↔`due`), target `calendar:`, freshly minted `uid`, `state: ready` — carrying the venue pointer forward as the new record's input. The order is load-bearing. A crash between the writes leaves an orphaned note whose "converted" banner names a successor identity, and an annotated successor resolving to no record and no claiming note is a *detectable* incomplete conversion: past the standard flight grace (the successor note may be a file still arriving from another device), it surfaces with complete — re-derive the rewrite, which is mechanical from the record's base — and revert — the §5.6 keep path where the resource survives; where the `DELETE` already fired, a fresh push of the old data, stated as such — offered (row 13b). The reverse order has no detector: a rewritten note beside a live old record is indistinguishable from ordinary venue routing (§7.1 — a pointer without a reciprocal claim is legitimate), and the half-completed conversion would linger silently, old event alive. The server work then happens as standard engine behavior: §5.6 tombstone processing deletes the old event; §6.1 push creates the new one. Rationale for why this is sufficient: every intermediate state is an already-specified state ({new identity ready or live} × {old tombstoned or pending}), and the mandated order makes the one crash-reachable intermediate a surfaced state rather than a silent one; both artifacts are files, so offline conversion queues by existing and executes wherever first observed (M9 semantics, race-safe via `If-None-Match: *` and 404-on-DELETE); a device that observes the server deletion first writes a remote-observed tombstone that the arriving annotated local-intent tombstone upgrades by monotone dominance, correcting the banner to "converted, not cancelled"; and the §6.1 hand-edit guard does not fire because the command's rewrite never enters the dirty set. The two halves of the "inconsistent" intermediate state are individually acceptable; they need to both eventually happen, not to happen simultaneously.

Three boundaries: attendee-bearing events refuse conversion — under any ordering it generates `CANCEL`-plus-reinvite mail to every attendee, which no decomposition changes; a `412` on the tombstone's `DELETE` (the old event changed remotely after the user converted) surfaces one prompt — retract anyway, or keep both; and the command requires a linked note, since a venue-routed record has nowhere to hold the successor identity between command and creation.

Calendar moves share the decomposition. "Move to calendar…" — same component type, different collection, §6.1's `calendar:` cell — is the same command shape with the field remap removed: pre-validate at the target (component-type acceptance, resolvable registry entry), then, entirely locally and tombstone-first, the local-intent tombstone on the old record annotated "moved to (collection, uid)", then the note rewrite as a plugin self-write — new `calendar:`, freshly minted `uid`, `state: ready`, every other field untouched — carrying the venue pointer forward. Every property of the conversion design carries over verbatim: the row-13b detector reads the annotation ("moved" and "converted" are one mechanism), the crash windows and their surfaces are identical, offline queuing and cross-device tombstone convergence hold, and a linked note is required for the same reason — the note holds the successor identity between command and creation. The identity is freshly minted rather than carried: §6.4 already rules that an identity ended in a tombstone is not reused, and a carried UID in the target collection would be indistinguishable from iTIP's deliberate cross-collection UID reuse, degrading §5.6's inbound pairing, which must keep telling an observed move apart from an invited copy. Attendee-bearing events refuse the decomposed move exactly as they refuse conversion — delete-plus-recreate is `CANCEL`-plus-reinvite mail. WebDAV `MOVE`, which some servers support within a calendar home, could later serve as an atomic same-type move that may avoid scheduling side effects; whether providers support it and whether it stays silent to attendees is Appendix A item 26, and until verified the refusal stands unconditionally — `MOVE` is a recorded-fact optimization, not a v1 dependency.

## 11. Recurrence

One note or record represents a recurring series; `rrule` stores the rule. Instances are computed for display. Records of series carry a materialization map (instance date → materialized note/section) so per-instance notes are tracked without per-instance records.

v1 supports whole-series edits only, with one closure rule: series edits to `start` time, `rrule`, or `timezone` — including converting a timed series to all-day or back, which the schema expresses as a key swap (`start` ↔ `date`) rather than a value edit — are refused while the base contains overrides or exclusions, with the reason stated. Rationale: patching the master under existing `RECURRENCE-ID`s orphans them — the override then targets an instance that no longer exists, producing ghost or duplicated instances on other clients and wrong rendering in Davenport's own views — and rewriting the exceptions to match is precisely the exception-editing machinery v1 defers, while dropping them destroys other people's moves. Series edits to fields that do not shift instances (summary, description, alarm, categories) patch safely. Per-instance overrides and exclusions are preserved round-trip (§5.5) from day one and become editable in a later stage, represented as explicit exception entries alongside the series. Preserved overrides must also be *rendered*: views compute instances from the RRULE and then apply existing overrides and exclusions read-only, because preservation without display would show wrong times for exactly the instances someone bothered to move. Recurring VTODOs follow complete-and-respawn client convention. `TZID` is stored faithfully; all-day and DST-straddling instances are computed in the event's zone, not the device's.

## 12. Invitations and RSVP

Inbound invitations are events where the user is an `ATTENDEE` with `PARTSTAT=NEEDS-ACTION`. The user's own attendee entry is identified by matching against the account's own addresses (§8.4: `calendar-user-address-set` from principal discovery, manual per-account fallback). Matching normalizes case and strips the `mailto:` prefix; additional aliases can be added to the per-account fallback list, since intermittent RSVP misidentification on real servers is otherwise guaranteed. Materialized notes and agenda entries for such events show a pending banner.

Responding is a server action, not a field edit: writing `PARTSTAT` (an iTIP reply on scheduling servers) informs the organizer. It is therefore confirm-gated like all attendee-touching writes.

Primary UI: Accept / Decline / Tentative buttons on the agenda sidebar and the note banner, confirm-and-push in one gesture. Underlying mechanism: the `rsvp:` frontmatter key; hand-editing it is an equivalent signal, validated against the enum and confirm-gated identically. A Properties-panel dropdown is a progressive enhancement only, since no official property-widget API exists (§2.2); the buttons-plus-field layering is the foundation for every synced enum (`rsvp`, `status`, task status, `class`).

## 13. Property mappings

- `alarm: -15m` → `VALARM` (DISPLAY, TRIGGER relative). While Obsidian is open, Davenport fires in-app notices for alarms; background delivery is the native client's job (§2.2).
- `categories` ↔ `CATEGORIES`, optionally mapped to Obsidian tags with a configurable prefix and per-calendar direction. Inbound tag writes touch only prefixed tags: union under the prefix, replace-within-prefix, and never add, remove, or reorder tags outside the prefix — `tags:` is a key users own heavily, and this is the one mapping that writes into non-Davenport frontmatter.
- `transp` → `TRANSP`; blocks default `OPAQUE`; event types may set defaults.
- `class` → `CLASS` (`public`/`private`/`confidential`); event types may set defaults; pairs with §9's privacy warnings.
- `status` → event `STATUS` (`tentative`/`confirmed`/`cancelled`). Distinct from `state` in key, vocabulary, code identifiers, and documentation.
- `location` → `LOCATION`. Structured location `X-` properties are preserved, not modeled.

Unmodeled properties are governed by the round-trip rule (§5.5).

## 14. Interface

### 14.1 Scope

Davenport's interface exists to serve its workflow — planning drafts, materializing notes, responding to invitations, scheduling blocks, and supervising sync — not to compete with dedicated calendar clients on rendering features. Every view is a projection of the ledger plus drafts; no view holds state the ledger and device-local storage do not. Rationale: a stated non-goal prevents the calendar view from absorbing effort the sync engine needs.

### 14.2 Calendar view

A workspace leaf with month, week, and day modes (FullCalendar.js or equivalent as the rendering library; the library is an implementation choice, not a spec commitment).

Displays: events from selected calendars, drafts, blocks, and (per-calendar option) task deadlines. Visual encoding: per-calendar color; drafts dashed; `status: tentative` faded; `status: cancelled` struck; blocks patterned; badges for pending RSVP, conflict, and validation failure. Which calendars are visible, and the current mode and date, are device-local view state.

Interactions:

- Click an event: open its materialized note, or offer materialization if none exists. Click a draft: open its note.
- Drag on empty space: open quick-add (§14.6) pre-filled with the selected time and the view's calendar context.
- Drag or resize an event: edits `start`/`end` through the standard edit path — debounce, validation, attendee gate included. Disabled on remote-owned calendars, with the reason shown on attempt rather than the handle silently missing.
- Context menu on an event: open/materialize note, assign venue, push (drafts), retraction options, convert to task/event, RSVP actions, join meeting, reveal record.

### 14.3 Agenda sidebar

A right-sidebar leaf; the working surface for the day. Ordered sections:

1. Needs attention — every state the spec routes here, each with a resolve action: conflicts (§5.4), validation failures (§6.2), dangling pointers (§5.6), grace-period divergence (§5.3), remote-owned divergence (§4.2), hand-edited `calendar:`/`type:`/`uid` (§6.1), persisting uid-without-record (§3.4), quarantined records (§3.2), duplicate address claims (§8.4), and pointer/map supersession mismatches (§6.3), orphaned-note acknowledgments and move suggestions (§5.6), and suspended-note notices (§3.2, Appendix B). Note banners (§14.5) are the per-note rendering of the same conditions; every bannered condition also lists here, so closed-note problems remain discoverable. Items self-dismiss when their underlying condition resolves — mandatory for the flight-skew items, whose designed resolution is a late-arriving file, not a click; stale prompts that outlive their problem are the same trust failure as problems nobody surfaces. Preservation items (§4.2, §5.4) are the stated exception: they record a historical displacement with nothing to resolve to, so they resolve by acknowledgment and carry the displaced values until then. Present only when non-empty, always first. Rationale: the trust surface fails if problems live in a view nobody opens.
2. Needs response — pending invitations with Accept / Decline / Tentative inline.
3. Today and upcoming — chronological, configurable days ahead; inline join and open/materialize actions.
4. Inbox — unrouted records (§7.2), with assign-venue and materialize actions.

### 14.4 Sync activity view

The trust surface's home; ships with the first write-capable release. Per-account cards: connection and credential status ("no credentials on this device" is a per-account state, §6.1), last sync time, count of changes awaiting push (derived, §5.3 — there is no queue), pause toggle. Below: the sync log — a filterable table of operations (time, calendar, item, action, outcome, reason), including refusals, skips, and conflicts, not only successes. Actions: sync now, dry-run per calendar ("would update 3, delete 1" with an expandable item list), global pause. Local snapshots of affected records and notes are taken before destructive batches and listed here for restore. Rationale: a sync engine earns trust in its first month or never; demonstrability requires a place to look.

### 14.5 Status bar, banners, codeblocks

- Status bar item (toggleable, device-local): next event with countdown; click menu — join meeting, open agenda, sync now.
- Note banners, rendered UI and never file content: pending invitation (with RSVP buttons), conflict, validation failure with the failing field, remote-deleted flag.
- Codeblock views: a `davenport` fenced block with YAML parameters — `view` (agenda | day | week | month | list), `calendars`, `venue`, `from`/`to`, `format` (line template for list/agenda). Read-only rendering with click-through to notes. The daily-note integration (§7.4) is this mechanism.

### 14.6 Modals

- Quick-add: free-text input parsed live (§8.2) with a structured preview of the resulting fields, event-type and calendar pickers, and a confirm button that is the `ready` signal. Esc always abandons cleanly.
- Attendee-write confirmation: shows what changes and who will be notified before any write that triggers scheduling messages. Not suppressible (§15.4).
- Retraction chooser: the three §6.4 options, consequences stated on each.
- Adoption picker: searchable list of unlinked events for "link note to existing event," with fuzzy-match suggestions pinned on top.
- Venue picker: searchable notes list for assigning a record's venue.
- Conflict resolution: field-by-field table of local vs. remote values; pick per field or take a side wholesale.
- Dangling-pointer resolution: retract / unlink / restore (§5.6).

### 14.7 Command inventory

Conventions: verb-first sentence case (Obsidian prefixes the plugin name); context commands appear only when applicable (`checkCallback`); no default hotkeys; every command is a thin verb over behavior specified elsewhere — commands introduce no behavior of their own.

Global:

- Sync now — all calendars (§5.1).
- Sync calendar… — picker, single calendar.
- Preview sync (dry run)… — picker; renders the §14.4 preview without writing.
- Pause/resume syncing — global toggle; per-calendar pause lives in §14.4.
- Quick-add event — opens §14.6 quick-add.
- Open calendar / Open agenda / Open sync activity.
- Backfill calendar history… — picker plus date range (§5.7).
- Export calendar to ICS… / Import ICS file… (§16).

Active note (visible when the note qualifies):

- Make this note an event… — event-type picker; inserts typed fields, sets `state: draft`. No server contact.
- Push to calendar — sets `state: ready`; validation and push follow (§6.1–6.2).
- Link to existing event… — adoption picker (§6.3).
- Unlink from event — record keeps the event, loses the venue pointer.
- Revert to draft / Remove from calendar (keep note) / Delete note and event — the §6.4 retractions.
- Refresh description and attachments — re-render and push derived content (§9.5).
- Convert to task / Convert to event — transmutation (§10.4); refuses on attendee-bearing events.
- Move to calendar… — picker; same-type move via §10.4's decomposition; refuses on attendee-bearing events.
- Accept invitation / Decline invitation / Respond tentative — §12; visible only with a pending or changeable `PARTSTAT`.
- Reveal on calendar — opens the calendar view centered on this event.

Selection context (calendar/agenda focus): Open or materialize note; Assign venue…; Join meeting.

### 14.8 Materialized filenames

Note filenames from summaries are sanitized: per-platform illegal characters replaced, length-capped, collision-suffixed. Renaming notes when the remote summary changes is a per-calendar option, default off. Rationale: renames churn links and vault sync; the record decouples title from identity anyway.

## 15. Configuration

### 15.1 Placement rules

Three storage tiers; every configurable item belongs to exactly one, chosen by whether divergence across devices is acceptable:

- Synced settings (`data.json`): semantic configuration that must agree across devices — accounts (minus secrets), the calendar registry and per-calendar options, event types, routing rules, global defaults. Rationale: two devices disagreeing about routing rules or ownership modes produce divergent vaults. The person index is not stored at all; it is derived from vault frontmatter (§8.4). Because `data.json` travels only when the sync setup carries it (§2.2), agreement is verified and tripwired, never assumed. Onboarding includes a settings-sync check under the user's own setup. At runtime, every settings write also writes a settings-revision marker: a small markdown file beside the ledger (default `davenport/settings-revision.md`, outside the records folder so the quarantine scanner never sees it) carrying a monotonic revision and per-section hashes (accounts, registry, event types, routing, defaults). Markdown syncs unconditionally, so a device whose local revision trails the marker knows its settings channel is broken and surfaces exactly that, naming the sections that disagree — ownership-mode divergence called out specifically, as the most dangerous configuration split the system permits. The marker is advisory: it gates nothing, and merge damage to it costs at worst one wrong warning that the next settings write corrects. Pre-stated branch: if Appendix A item 22 verifies badly across common setups, the escalation is moving the registry into the vault under record-style treatment (deterministic emission, checksum, quarantine) — a v2 design change recorded here so a bad verification lands on a branch, not back on the drawing board.
- Device-local (`saveLocalStorage`): display and session state where divergence is correct — visible calendars, view mode and date, status-bar toggle, pane layout, log verbosity, plus the §3.3 sync cursors.
- In vault: templates (files in the configured template folder), venue claim blocks (§7.2), and the record ledger. Rationale: content that users edit as text belongs in the vault, versioned with it.

Secrets are the fourth tier (§4.3) and never appear in any of the above.

### 15.2 Settings organization

Plugin settings are organized into sections. Each item states its default.

- Accounts — add/edit/remove; server URL, username, credential type and entry (§4.3–4.4); test-connection button; re-run discovery.
- Calendars — the registry (§4.1). Per calendar: friendly name, color, ownership mode (default remote-owned), default timezone, default materialization template (§8.1), description source mode and backlink option (§9.2), categories↔tags mapping (§13), remote-deletion behavior (§5.4), remote-edit handling on vault-owned calendars (§4.2), rename-on-retitle (default off, §14.8), task-deadline materialization (§10.2), sync-horizon override, auto-push-on-valid (vault-owned only, default off).
- Event types — list editor: name, component type, default duration/calendar/recurrence/alarm/`class`/`transp`, expected fields, template (§8.2).
- Routing — ordered rule editor: predicates over calendar/summary/attendees → venue, template, materialization target (note vs. section) (§7.2–7.3). Documents note-resident claim blocks.
- People — derivation settings only (§8.4): frontmatter key name (default `email`), optional folder scope, unmatched-attendee behavior, and per-account own-address fallback for RSVP identity.
- Templates — template folder path; Templater integration (auto-detected, overridable); wikilink render mode for descriptions (§9.3).
- Storage — records folder path (default `davenport/records/`); a button adding it to Obsidian's excluded files; tombstone and snapshot retention windows.
- Sync — global interval; edit debounce; grace period for unexplained divergence (§5.3); sync-horizon defaults; attachment size cap; embed depth limit.
- Appearance — week start, 12/24h, agenda days ahead, status bar toggle (device-local), draft/badge styling toggles.
- Advanced — log verbosity (device-local), reset device-local state, re-run first-sync adoption suggestions.

### 15.3 Override pattern

Behavioral options follow one pattern: a global default plus per-calendar override, with per-event-type overrides only where §8.2 names them (duration, alarm, `class`, `transp`, description source). Rationale: two override layers are learnable; arbitrary cascade depth is not.

### 15.4 Deliberately not configurable

No setting exists for: the attendee-write confirmation; URI actions landing in drafts/confirms rather than server writes; the prohibition on auto-deleting server events from dangling pointers; round-trip preservation of unmodeled properties; validation gating pushes; the requirement that skips and failures surface. Rationale: each of these trades user safety or other people's data for convenience; a toggle is a promise to support both branches, and the unsafe branch of each of these becomes a data-loss report or an email that cannot be unsent.

## 16. Integration

- `obsidian://davenport/...` URI actions (quick-add, open event, materialize). URI-triggered actions create drafts or open confirm modals; they never write to a server directly. Rationale: URI handlers fire from any link the user clicks.
- A public plugin API exposing ledger queries and quick-add for other plugins.
- Importer for Full Calendar's note-per-event frontmatter format.
- ICS export of any calendar or filtered projection to a file.
- Dropping an `.ics` file into the vault offers parsing it into a draft. No reply flow is offered from a bare file: Davenport has no iMIP transport, so responding to an emailed invitation works only when the event already exists on a synced calendar via the server's scheduling inbox (§12).

## 17. Out of scope

Stated so the borders are decisions:

- Google and Microsoft REST APIs (Google Calendar API, Google Tasks, Microsoft Graph). Google is served through its CalDAV endpoint (§4.4); Outlook.com has no CalDAV endpoint and is unsupported.
- A shared OAuth client ID and the associated Google verification process — out of v1 scope; a v2 stretch goal (§4.4).
- A hosted auth proxy or any Davenport-operated server infrastructure.
- CardDAV/contacts sync. Person notes (§8.4) carry addresses in their own frontmatter; a future CardDAV integration would populate person notes, not replace them, and could share account configuration.
- VJOURNAL, VFREEBUSY/availability queries, and automatic scheduling (auto-placement of blocks into free time). Deferred; Davenport proposes, the user disposes.
- Background sync and notifications on mobile. Impossible on the platform; mitigations are the publish route (below) and the native client.
- Vault-as-server publishing (a secret-URL ICS feed of vault events via a companion relay). Attractive, one-way, deferred to post-roadmap consideration.

## 18. Roadmap

Each stage shippable:

1. ICS feed subscriptions → records, routing, materialization, templates. Exercises the whole read path with zero write risk.
2. CalDAV pull: discovery, registry, incremental sync, horizon, adoption/linking. The dirty set — watcher plus self-write exclusion — ships in this stage so the interim rule's dependency exists when referenced; grace surfacing and push gating complete in stage 3. Interim rule for stages 2–3, before three-way comparison lands: inbound changes to notes in the local dirty set are deferred and flagged, never applied over dirty local state — the interim behavior is stated here so it is not chosen silently at implementation time.
3. CalDAV push with the full trust surface: lifecycle, validation, quick-add, tombstones, round-trip patching, attendee gate, sync log, dry-run, pause. In this stage a `412` surfaces as a blocking error on the item; the field-level resolution UI arrives in stage 4.
4. Conflict handling: three-way comparison, surfacing UI.
5. Tasks, VTODO targets, time blocks, transmutation and calendar moves (§10.4, decomposed design).
6. Google accounts: BYO-credential OAuth flow over CalDAV (§4.4).
7. Recurrence exceptions; RSVP; description/attachment pipeline if not landed earlier.

Stretch (v2): shared OAuth client ID with Google verification (§4.4); vault-as-server publishing (§17).

## Appendix A — items requiring empirical verification

1. SecretStorage encryption at rest on current Obsidian desktop (affects §4.3 claims).
2. `requestUrl` behavior with self-signed certificates (LAN Nextcloud; affects onboarding).
3. RFC 8607 managed-attachment support per provider (iCloud, Fastmail, Nextcloud, Radicale).
4. `X-ALT-DESC` HTML description handling in current Outlook/Apple/Google clients.
5. iCloud CalDAV sync-token support and discovery redirect behavior (affects §5.1 fallback frequency).
6. Plugin registry collision check for the `davenport` id at submission time.
7. Whether SecretStorage secrets sync across devices (affects mobile use of desktop-authorized OAuth tokens, §4.4).
8. Google CalDAV support for RFC 6578 sync-tokens vs. CTag-only (affects §5.1 fallback on Google calendars).
9. Current Google verification requirements for the sensitive Calendar scope (affects the v2 shared-client stretch goal).
10. Google CalDAV iTIP behavior on writes carrying `ATTENDEE` (affects §5.5 gate messaging on Google calendars).
11. `processFrontMatter` formatting semantics — comment, formatting, key-order preservation, and cross-device, cross-Obsidian-version byte determinism on user notes: devices routinely run mismatched Obsidian versions, and note writes have no counterpart to §3.2's normalization-version stamp, so per-version determinism alone is insufficient. **Verify first, before all other items and before stage 2**: this is the spec's last standing design risk — the only item whose failure mode is a design change (a designated-writer rule, which reintroduces per-device asymmetry into a system built on every-device symmetry, touching §5.4, §6.1's execute-anywhere, and §3.2's two-channel convergence) rather than a recorded fact with a pre-stated branch.
12. Vault and `metadataCache` event behavior for files modified externally while Obsidian runs, including the documented Obsidian Sync behavior where a freshly created local file can be replaced un-merged by a remote version — interacts with materialization racing vault sync.
13. `requestUrl` redirect handling (iCloud discovery is redirect-heavy), large-body behavior on mobile (base64 attachments), and `tsdav`-with-`requestUrl` under real load.
14. Obsidian Sync's diff-match-patch auto-merge default as applied to record files — a design input to §3.2's determinism and quarantine requirements, not merely a verification item.
15. Whether in-scope sync tools preserve file mtimes (informational for the §5.3 surfaced-divergence prompt and grace-period tuning).
16. Whether providers return byte-identical ICS across GETs or re-serialize per request. A design input: §3.2's normalization exists because of it, and it is handled by normalizing whatever bytes arrive.
17. `saveLocalStorage` capacity limits (dirty set, cursors, caches).
18. Excluded Files interaction with Bases (currently hides excluded files — known problem, §3.2) and with Dataview (reads `metadataCache`, ignores exclusion) — verify per current Obsidian version and document per-tool.
19. YAML-emitter and `ical.js` serialization stability across *plugin* versions. A design input: §3.2's normalization version stamp and byte-rewrite suppression are its consequence.
20. Per-tool conflict-copy filename patterns (Obsidian Sync, Syncthing, iCloud Drive, git) — feeds §3.2's quarantine detector clause (b).
21. Whether in-scope sync tools deliver renames as renames or as delete-plus-create pairs — decides how often §5.6's venue relink heuristic fires at all.
22. `data.json` sync behavior per in-scope sync method and configuration (Obsidian Sync configuration-sync toggles and their defaults, git conventions, Syncthing filters), and observed consequences of settings divergence — feeds §15.1's verification step, tripwire, and escalation branch.
23. UID presence and stability across common feed generators (published Google/Outlook calendars, holiday and fixture feed services, event-platform exports) — feeds §5.2's identity fallback and its anomaly-threshold defaults.
24. Conditional-request enforcement per provider: whether `If-Match` and `If-None-Match: *` preconditions are honored, and ETag stability across fetches, on iCloud, Fastmail, Nextcloud, Radicale, Baïkal, and Google CalDAV. Rank near the top (after item 11): the `412` machinery is a named backstop in §5.4, §5.5, §6.1, and row 25, a non-enforcing server removes it silently, and the branch (§5.5: per-provider documentation plus the §14.4 trust caveat) is the whole remedy.
25. `calendar-query` UID property-filter support per provider — feeds §3.4's uid-without-record lookup, whose degraded form ("lookup unavailable") depends on distinguishing non-support from not-found.
26. WebDAV `MOVE` support per provider, and whether `MOVE` on scheduling-enabled collections stays silent to attendees — gates §10.4's atomic-move optimization only; no v1 behavior depends on it.

## Appendix B — Lifecycle state table

The composed machine, enumerated. Axes: **note** (plain — bears neither `uid` nor `state`; event-shaped fields may be present, acknowledgment producing exactly that (§5.6), and are inert regardless — unwatched by §5.3, unrendered by §6.1 — until adoption (§6.3) or "Make this note an event" re-enters the lifecycle; draft — `state: draft`; ready — `state: ready` + `uid`; bound — bears `uid`, no `state`, a frontmatter *shape*; a bound note is *live* only when a live record resolves for it (§3.1); none — venue-routed record with no 1:1 note), **record** (absent; live; tombstoned-L — local-intent; tombstoned-R — remote-observed; quarantined), **remote** (absent; base — matches the record's base snapshot; changed). Cells are a defined transition, a pointer to the governing section, or an explicit surface-to-user; a pointer is the preferred resolution — the best cell is an existing rule, not a new one.

### B.1 Named composite states

Two conditions recur enough to deserve names, used throughout:

- **Orphaned** — note bears an identity whose record is tombstoned (either type). Never pushes; edits are local-only and dirty entries are inert; the note carries a banner typed by the tombstone (retracted / cancelled remotely / converted, per annotation). Resolved by acknowledgment (strips `uid` and `state`, note becomes plain with fields intact), by revival — on which orphan-era dirty entries clear, since "edits are local-only" must not retroactively become a push (§5.6) — or by a move suggestion (§5.6).
- **Suspended** — note bears an identity whose record is quarantined (§3.2). Never pushes (no trustworthy base or etag); dirty entries accumulate; banner links to the quarantine item. On rebuild, the re-fetched base enters normal §5.3/§5.4 evaluation: accumulated dirty divergence pushes (per mode, §4.2) or conflicts as usual; a rebuild that 404s follows row 16b — the note becomes orphaned and dirty goes inert.

### B.2 The table

| # | Note | Record | Remote | Behavior |
|---|------|--------|--------|----------|
| 1 | plain | absent | — | Inert. Not Davenport's. |
| 2 | draft | absent | — | Local planning; rendered in views; no server contact (§6.1). |
| 3 | ready | absent | absent | Push: create `{uid}.ics` with `If-None-Match: *`; mint record; strip `state` (§6.1, §5.5). Executes wherever observed, dirty-independent (§6.1). |
| 4 | ready | absent | present | Creation `412`: another device created it — fetch, converge, strip `state` (§5.5). |
| 5 | live | live | base | Steady state. Dirty divergence pushes (§5.3); not-dirty divergence held inert / grace-surfaced (§5.3). |
| 6 | live | live | changed | Inbound three-way (§5.4): dirty gates the "local changed" leg; equal values converge; three distinct values conflict when dirty — not dirty, remote applies and the displaced value rides an acknowledgeable preservation item (§5.4). |
| 7 | none | live | changed | Record-only apply; no note write (§5.4). |
| 8 | bound (`uid`) | absent | — | Inert flight state: never push, never re-create, never adopt; grace-surface if persistent, offering server lookup by UID filter → adoption suggestion, strip-to-draft, or strip identity (§3.4, A25). |
| 9 | live + hand `ready` | live | — | Stripped as satisfied; logged; no re-push (§6.1). |
| 10 | live + hand `draft` | live | — | Surfaced; revert command offered; a hand-typed field never triggers server deletion (§6.1). |
| 11 | live, `calendar:`/`type:` changed or deleted by hand | live | — | Surfaced with revert; commands are the sanctioned path (§6.1). |
| 12 | any | tombstoned-L | present | Pending `DELETE`; `404` = success; `412` = changed-after-decision, surface delete-anyway/keep; `keep` = clear tombstone, revive, re-fetch, re-enter §5.4 — pointer retained where the note still claims the identity, else routing/inbox (§5.6). |
| 13 | orphaned | tombstoned (either) | absent | Banner per B.1; acknowledgment strips identity; tombstone unprunable until acknowledged (§5.6). |
| 13b | orphaned, banner "converted to S" / "moved to S" | tombstoned-L (conversion/move) | — | S resolving to no record and no claiming note past flight grace = incomplete conversion or move: surface with complete (re-derive rewrite from base) / revert (§5.6 keep; post-`DELETE`, fresh push) (§10.4). |
| 14 | orphaned | tombstoned-R | present (reappeared) | Revival: record returns to live; unacknowledged note relinks, banner self-dismisses; orphan-era dirty entries clear — post-revival divergence takes the inert/grace path, never a silent push (§5.6). Post-acknowledgment reappearance lands unlinked (revival within retention, new record after pruning); both → routing/inbox (§5.6). |
| 15 | orphaned | tombstoned-R in collection A | same UID appears in collection B | Move suggestion, never automatic (§5.6). Distinct from invited copies (no deletion pairing → two records, §3.2). |
| 16 | suspended | quarantined | present | Per B.1; rebuild re-fetches → live record; suspended dirty evaluates normally §5.3/§5.4 (§3.2). |
| 16b | suspended | quarantined | absent | Rebuild `404`: rebuilt record is a remote-observed tombstone; note becomes orphaned; accumulated dirty goes inert — the opposite dirty disposition from 16, stated so neither branch falls through the other (§3.2, B.1). |
| 17 | note bearing a different `uid` | — (adoption attempted) | present | Refuse uid backfill — one note, one identity slot; offer venue-link instead: many-events-per-note is the venue pointer, not the note's own identity (§6.3, §7.1). |
| 18 | two notes, one identity | live | — | Copy recovery: newer file stripped to draft (§3.4). Notes only; duplicate record files are §3.2 quarantine. |
| 19 | two devices set pointer/map differently | live | — | Supersession surfacing, both candidates named; no silent last-writer (§6.3, §8.1). |
| 20 | any | live | same UID live in a second synced collection | Two distinct records by keying; invited-copy relationship surfaced informationally, not modeled (§3.2). |
| 21 | live, `rsvp` set | live | no `ATTENDEE` matches own addresses | Validation failure, surfaced with alias hint; no write (§6.2, §12). |
| 22 | draft | — | targets remote-owned calendar | Legitimate; no warning — drafts are local planning everywhere; only `ready` warns (§4.2). |
| 23 | block, `task:` dangling | live | — | Link renders as plain text; completion offer suppressed; no error (§10.1). |
| 24 | venue note deleted | live records point at it | — | Pointer falls back to routing/inbox (§7.5); venue relink heuristic first — name-and-timing match, since venues bear no identity and some tools deliver renames as delete+create (§5.6, A.21); map entries clear only after resolution concludes deletion, never eagerly (§5.6); instances then revert to unmaterialized. |
| 25 | live, edited on two devices concurrently | live | — | Resolved at the sync-tool layer, outside the plugin; output may re-enter as dirty; `If-Match` and the attendee gate are the backstops (§5.4). |
| 26 | hand-`ready` | tombstoned (either) | — | Validation refuses with the un-cancel explanation; never executes; acknowledge-then-fresh-push is the stated path (§6.1, §6.2). |
| 27 | hand-`ready` | quarantined | — | Validation refuses ("resolve the quarantine first"); creation would 412 into a convergence that cannot converge against an excluded record (§6.2). |
| 28 | `uid` appears/changes by hand | any | — | Surfaced, never auto-bound; copied-note recovery offered ("strip to draft?"); §3.4's no-auto-bind, note-side (§6.1). |
| 29 | `uid` deleted by hand | live | — | Surfaced with unlink offered; the record's pointer is one-way pending resolution (§6.1). |
| 30 | none | tombstoned (either) | — | Record-only: tombstone processes per type; venue sections stay per §7.5; no note to banner — the deletion is legible in the sync log and inbox (§5.6, §7.5). |
| 31 | none | quarantined | — | Record-only suspension: excluded from every consumer; rebuild per §3.2 rows 16/16b; venue pointer rides the rebuilt record. |
| 32 | feed record | live | vanished from feed | Remote-observed tombstone only past §5.2's gates: fetch parsed complete, absent from the unclipped file, below the mass-vanish threshold — else tombstones hold behind one feed-level anomaly; `DELETE` unreachable for feeds; banner typed accordingly (§5.2, §5.6). |

**Ownership mode composes orthogonally** rather than as a fourth axis: §4.2's rules preempt per mode — push clauses are mode-qualified (§5.3), remote-owned divergence has its own surfacing (§4.2), and row 22 is the only mode-*sensitive* cell. Any behavior above that says "push" reads "push, per mode (§4.2)."

### B.3 Reductions

Rows 3–8, 12, 18–19, 22, 25 resolve entirely to existing rules — the transmutation lesson applied: enumerate first, and prefer discovering that a cell is already specified over minting a transition. The rows that forced new normative text, now in the body: the tightened liveness definition and the orphaned/suspended names (§3.1, B.1), `412`-on-`DELETE` (row 12, §5.6), the acknowledgment-gated pruning rule and revival and move-suggestion behaviors (rows 13–15, §5.6), the no-auto-bind rule (row 14's post-acknowledgment case, §3.4), the stale-`ready`/hand-`draft` cells (rows 9–10, §6.1), and the adoption-onto-claimed-note refusal (row 17, §6.3 via §7.1). Rows 26–32 were added by round-3 review — the table's first exercise of its own maintenance rule. Round-4 amendments: the plain axis redefined so acknowledged notes fit it, rows 6, 8, and 32 amended (§5.4 preservation, §3.4 lookup actions, §5.2 gates), and row 13b added (§10.4's mandated order and its detector). Round-5 amendments: row 13b generalized to calendar moves (§10.4), with the §5.4 remote-deletion options, the §5.4 mandated apply order, and the §5.2 identity-switch re-key added to the body. Any future feature that adds a note, record, or remote state owes this table a row before it ships.
