# Recorded facts

The verification items in the design spec's Appendix A are protocols, not
tests. Each item produces a recorded fact. Every fact lands on the branch
that the spec pre-states for that fact. This document is the ledger of
those facts, and the project versions this document together with the
plugin. The protocols that produce each fact live beside this document in
`docs/dev/facts/`. Each protocol appears there when its author writes it.

The rule is this: a changed fact re-routes to its pre-stated branch. A
fact that has no branch is a design gap. That fact goes back to the design
spec before code changes.

## Entry format

Add each fact under its item heading in the Recorded entries section.
Strike through a superseded fact. Do not delete a superseded fact. This
rule keeps the history of a changed fact legible.

```
### A-N — short name

Protocol: [docs/dev/facts/a-N.md](facts/a-N.md)

- ~~**2026-08-10** · environment · the superseded fact · branch taken:
  what it routed to.~~
- **2026-08-11** · environment and versions · the fact, one or two
  sentences · branch taken: what this routes to.
```

## Item index

The status of an item is `unrecorded` until a dated entry for that item
exists in the Recorded entries section. A parenthetical annotation carries
the ordering notes and the gating notes that the test plan attaches to an
item.

| Item | Subject | Consumed by | Status |
|---|---|---|---|
| A-1 | SecretStorage encryption at rest | stage 3 | unrecorded |
| A-2 | requestUrl with self-signed certificates | stage 3 | unrecorded |
| A-3 | RFC 8607 managed attachments per provider | stage 3 | unrecorded |
| A-4 | X-ALT-DESC handling in major clients | stage 3 | unrecorded |
| A-5 | iCloud sync-tokens and discovery redirects | stage 2 | unrecorded |
| A-6 | Plugin-id collision check | stage 1 | unrecorded |
| A-7 | SecretStorage cross-device travel | stage 6 | unrecorded |
| A-8 | Google CalDAV RFC 6578 support | stage 2 | unrecorded |
| A-9 | Google verification requirements | stage 6 (v2 gate) | unrecorded |
| A-10 | Google iTIP behavior on attendee writes | stage 6 | unrecorded |
| A-11 | processFrontMatter byte determinism | stage 2 (gate; first, before stage 1's frontmatter-writing work) | recorded |
| A-12 | External-modification vault events | stage 2 | unrecorded |
| A-13 | requestUrl redirects, large bodies, tsdav under load | stage 2 | unrecorded |
| A-14 | Obsidian Sync merge behavior on records | stage 1 | unrecorded |
| A-15 | mtime preservation per sync tool | stage 2 | unrecorded |
| A-16 | Byte-stable vs re-serialized GETs per provider | stages 1 and 2 | unrecorded |
| A-17 | saveLocalStorage capacity | stage 3 | unrecorded |
| A-18 | Excluded Files vs Bases and Dataview | stage 1 | unrecorded |
| A-19 | Emitter stability across plugin builds | stage 1 | unrecorded |
| A-20 | Conflict-copy filename patterns per tool | stage 1 | unrecorded |
| A-21 | Rename delivery per sync tool | stage 2 | unrecorded |
| A-22 | data.json travel per tool and configuration | stage 1 | unrecorded |
| A-23 | UID behavior across feed generators | stage 1 | unrecorded |
| A-24 | Precondition enforcement per provider | stage 3 (ordered second) | unrecorded |
| A-25 | calendar-query UID filter per provider | stage 2 | unrecorded |
| A-26 | WebDAV MOVE support and attendee silence | stage 5 (non-blocking) | unrecorded |
| A-27 | Frontmatter value types in the callback | stage 2 (with A-11) | recorded |

## Provider facts

| Provider | 6578 tokens | ETag stable | If-Match | If-None-Match: * | RFC 8607 | UID filter | Byte-stable GET | iTIP on write | Redirects | WebDAV MOVE |
|---|---|---|---|---|---|---|---|---|---|---|
| iCloud | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded |
| Fastmail | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded |
| Nextcloud | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded |
| Radicale | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded |
| Baïkal | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded |
| Google CalDAV | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded |

## Sync-tool facts

| Tool | Conflict-copy pattern | Merge behavior on records | Rename delivery | mtime preserved | data.json travel |
|---|---|---|---|---|---|
| Obsidian Sync | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded |
| Syncthing | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded |
| iCloud Drive | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded |
| git | unrecorded | unrecorded | unrecorded | unrecorded | unrecorded |

## Re-verification triggers

- Platform items (A-1, A-7, A-11, A-12, A-17, A-18, A-27): re-verify each
  of these items at each Obsidian minor release.
- Provider items: re-verify each of these items when you observe a
  regression. Also re-verify each of these items one time each year or
  more often.
- Sync-tool items: re-verify each of these items at each major version of
  the tool.
- Facts entries for a re-verified item record the trigger that caused the
  re-verification.

## Recorded entries

Write one heading for each item, in the entry format above. Create that
heading with the item's first recorded fact. Link the item's protocol
document at the top of that heading.

### A-11 — processFrontMatter byte determinism

Protocol: [docs/dev/facts/a-11.md](facts/a-11.md)

- **2026-08-18** · macOS (Obsidian API 1.13.7, Electron 43.3.0, run
  2026-08-16) and iOS 18.7 (Obsidian API 1.13.7, run 2026-08-18; the
  vault lives in the iCloud Drive container) — one API version on two
  platforms; ~~the minimum matrix of the protocol, which is the current
  Obsidian API version and the previous one on macOS, is still open~~ a
  previous-version cell is not required, and #11 records the decision ·
  The probe ran the 14-fixture corpus in both environments, and the 13
  parseable fixtures emitted identical bytes, fixture for fixture. Both
  environments refused the `unparseable` control with the same parse
  error · branch taken: determinism holds in the tested environments —
  this entry records the fact, and the result validates the [E]/[M]
  fakes.

### A-27 — Frontmatter value types in the callback

Protocol: the probe of A-11 ([docs/dev/facts/a-11.md](facts/a-11.md))
records the value types since #225.

- **2026-08-21** · macOS (Obsidian API 1.13.7, Electron 43.3.0, run
  2026-08-21; the results file is
  `frontmatter-probe/emission-samples-20260821-180150Z.json` in the
  vault `even-copper-harbor`) · The probe read the corpus with the §3.1
  event keys. Every value of a day key and of a time-of-day key arrived
  as text, and a bare `date-like` value and a bare `timestamp-like`
  value arrived as text too. A number arrived as a number, a boolean as
  a boolean, and a null value as null · branch taken: real notes take
  the text path in this environment. The date-value path of the reader
  stands as a guard, and the residue of Appendix A item 27 — the day
  that moves under a reduced timestamp — is not reachable in this
  environment. The typed number confirms that the no-coercion fault
  guards a live path. iOS is not yet run for this item; add platforms
  when they are available.
