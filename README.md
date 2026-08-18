# Davenport

Davenport syncs calendar events and tasks between your Obsidian vault
and CalDAV servers (iCloud, Fastmail, Nextcloud, Radicale, Baïkal,
Google, and more).

Davenport treats the calendar as a projection of the vault. The
calendar owns when things happen. The vault owns what the things mean.

**Status: pre-release.** Davenport has no release yet. The first
release will include read-only subscriptions to ICS feeds. CalDAV sync
comes after the first release.

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

The design documentation is in
[docs/davenport-spec.md](docs/davenport-spec.md) and
[docs/davenport-test-plan.md](docs/davenport-test-plan.md). The
development process is in [docs/dev/process.md](docs/dev/process.md).

## Third-party software

Davenport uses [ical.js](https://github.com/kewisch/ical.js) 2.2.1 to
read and write iCalendar data, and the build puts ical.js into
`main.js`. ical.js is Copyright (C) Philipp Kewisch, and it is under the
[Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/). The code of
ical.js in `main.js` stays under that license. You can get the source of
that version at
<https://github.com/kewisch/ical.js/releases/tag/v2.2.1>. The file
`main.js` carries the same notice.

Davenport itself is under the 0-BSD license. The file
[LICENSE](LICENSE) holds the text.
