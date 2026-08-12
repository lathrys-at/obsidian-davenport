# Recorded facts

The verification items in the design spec's Appendix A are protocols, not
tests: each produces a recorded fact, and every fact lands on the branch
the spec pre-states for it. This document is the ledger of those facts. It
is versioned with the plugin; the protocols that produce each fact live
beside it in `docs/dev/facts/` as they are authored.

The rule: a changed fact re-routes to its pre-stated branch; a fact with no
branch is a design gap and goes back to the design spec before code
changes.

## Entry format

Facts append under their item heading in the Recorded entries section.
Superseded facts are struck through, never deleted — the history of a
changed fact stays legible.

```
### A-N — short name

Protocol: [docs/dev/facts/a-N.md](facts/a-N.md)

- ~~**2026-08-10** · environment · the superseded fact · branch taken:
  what it routed to.~~
- **2026-08-11** · environment and versions · the fact, one or two
  sentences · branch taken: what this routes to.
```

## Item index

Status is `unrecorded` until a dated entry exists in Recorded entries.
Parenthetical annotations carry the ordering and gating notes the test
plan attaches to an item.

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
| A-11 | processFrontMatter byte determinism | stage 2 (gate); first, before stage 1's frontmatter-writing work | unrecorded |
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

- Platform items (A-1, A-7, A-11, A-12, A-17, A-18): each Obsidian minor
  release.
- Provider items: on observed regression, and at least annually.
- Sync-tool items: on tool major versions.
- Facts entries record the trigger that prompted them when re-verified.

## Recorded entries

One heading per item, in the entry format above, created with the item's
first recorded fact; the item's protocol document is linked at the top of
its heading. None yet.
