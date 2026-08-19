# Timezone table

This directory holds one release of the IANA timezone database and the
generator that turns it into the table that the plugin ships.

## Why the plugin ships a table

Two devices that hold the same event must write the same bytes into the
record of that event. A device that read its timezone rules from its own
operating system would break that promise: the rules of one device differ
from the rules of another, and they lag the database by months. The plugin
therefore carries one table, and every computation whose result can reach
the bytes of a record reads it.

A user receives new timezone rules through a new version of the plugin,
and through nothing else.

## What is here

| Path           | What it holds                                              |
| -------------- | ---------------------------------------------------------- |
| `vendor/`      | The data files of the pinned release, byte for byte        |
| `pin.json`     | The release, the form, and the checksum of every file      |
| `source.ts`    | The reader of the file format of the release               |
| `expand.ts`    | The rules of a zone, turned into changes of the clock      |
| `encode.ts`    | The writer of the table text                               |
| `module.ts`    | The writer of the module that carries the table            |
| `generate.mjs` | The command that writes the module                         |
| `oracle.mjs`   | The command that writes the fixture that the tests compare |

The generator writes `src/core/timezone/table-data.ts`. That file is the
artifact that the plugin ships. Do not edit it by hand.

## The release, and why it is in the repository

`vendor/` holds the data files of one release. They are the files of the
release, with no change of any byte. The data of the timezone database is
in the public domain, and `vendor/LICENSE` carries the notice of the
release.

The files are in the repository for one reason: a person must be able to
write the table again, get the same bytes, and need no network to do it.
A test in `test/timezone-table.test.ts` runs the generator over these
files at every test run and compares the result against the committed
module. A change to the generator that nobody meant therefore fails the
build, and so does an edit of the generated file.

The release ships its data in the **main** form. It also ships tools that
turn the data into a vanguard form and a rearguard form. Those forms state
a negative seasonal offset in another way, and they disagree with the main
form about the zones that run one. `pin.json` records the form, and a test
holds it at `main`.

The release does **not** ship a file named `tzdata.zi`. That file is a
product of the build of the release, and the tarball holds the data files
that this directory vendors.

## Run the generator

```bash
npm run timezone:generate          # write the module
node tools/timezone-table/generate.mjs --check   # compare, write nothing
```

The generator stops when the checksum of a vendored file does not agree
with `pin.json`.

## Move the pin to a new release

The database has three to ten releases each year. Each one is a change to
the bytes that the plugin ships.

1. Get the release and check it.

    ```bash
    curl -O https://data.iana.org/time-zones/releases/tzdataYYYYR.tar.gz
    curl -O https://data.iana.org/time-zones/releases/tzdataYYYYR.tar.gz.asc
    gpg --verify tzdataYYYYR.tar.gz.asc tzdataYYYYR.tar.gz
    shasum -a 256 tzdataYYYYR.tar.gz
    ```

2. Put the new files in `vendor/`. The set of files is the set that
   `pin.json` names under `files`. `version` and `LICENSE` come from the
   release too.

3. Write `pin.json` again: the release, the checksum of the archive, and
   the checksum of every file. `form` stays `main`.

4. Write the table again, and read the difference.

    ```bash
    npm run timezone:generate
    git diff src/core/timezone/table-data.ts
    ```

    One line of the table states one timezone identifier, so the
    difference names every zone that changed and no other zone.

5. Write the fixture that the tests compare against again. This step needs
   `zic`, the compiler that the timezone project ships. The fixture states
   what a second reader of the same release answers, so the tests do not
   compare the plugin against itself.

    ```bash
    zic -b fat -d /tmp/zoneinfo \
        tools/timezone-table/vendor/{africa,antarctica,asia,australasia,\
    backward,etcetera,europe,factory,northamerica,southamerica}
    node tools/timezone-table/oracle.mjs /tmp/zoneinfo
    ```

6. Raise the timezone component of the normalization stamp. A new release
   changes the bytes that a record can carry, and the component indexes
   those bytes.

7. Run the gates: `npm test`, `npm run lint`, `npm run typecheck`,
   `npm run build`, and the bundle and coverage checks.

Steps 1 to 5 need a network one time, for the release itself. Nothing in
the build and nothing in the tests reaches a network.

## What the table holds

The table covers the period from the start of 1970. It states the changes
of the clock of each zone up to the last change that its rules state, and
then, for a zone whose rules repeat one pair of changes every year with no
last year, that pair. The pair covers every year after the last change, so
the table needs no last year of its own.

`src/core/timezone/table.ts` states the form of a line of the table.
