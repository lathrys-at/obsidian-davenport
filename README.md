# Davenport

Sync calendar events and tasks between your Obsidian vault and CalDAV
servers (iCloud, Fastmail, Nextcloud, Radicale, Baïkal, Google, and more).

Davenport treats the calendar as a projection of the vault: the calendar
owns when things happen; the vault owns what they mean.

**Status: pre-release.** Nothing is released yet. The first release will
ship read-only ICS feed subscriptions; CalDAV sync follows.

## Development

```
npm install
npm run dev        # watch build
npm run build      # production build
npm test           # test suite (see test/README.md)
npm run typecheck
npm run lint
npm run format
```

Design documentation: [docs/davenport-spec.md](docs/davenport-spec.md) and
[docs/davenport-test-plan.md](docs/davenport-test-plan.md). Development
process: [docs/dev/process.md](docs/dev/process.md).
