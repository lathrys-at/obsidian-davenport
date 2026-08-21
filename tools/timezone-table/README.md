# Timezone table

This directory holds the pin of one release of the IANA timezone database
and the generator that turns that release into the table that the plugin
ships.

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
| `pin.json`     | The release, the form, and the checksum of every file      |
| `download.mjs` | The command that gets the release and checks it            |
| `cache.ts`     | The place of the cache, and the reader of it               |
| `archive.ts`   | The reader of the archive that the release ships           |
| `source.ts`    | The reader of the file format of the release               |
| `zone.ts`      | The states of a clock, and the code that builds one        |
| `expand.ts`    | The rules of a zone, turned into changes of the clock      |
| `terminal.ts`  | The pair that repeats every year, and the truncation       |
| `encode.ts`    | The writer of the table text                               |
| `module.ts`    | The writer of the module that carries the table            |
| `generate.mjs` | The command that writes the module                         |
| `oracle.mjs`   | The command that writes the fixture that the tests compare |

The generator writes `src/core/timezone/table-data.ts`. That file is the
artifact that the plugin ships. Do not edit it by hand.

## The release, and where the bytes of it are

The repository holds the checksum of the release, and it holds no byte of
the release. `pin.json` states the release, the address of its archive,
the checksum of that archive, and the checksum of each of the twelve files
that the release ships for this tool. The data of the timezone database is
in the public domain, and the release carries the notice in its `LICENSE`
file.

The download command gets the archive from the server of the timezone
project and puts the twelve files in a cache outside the repository. The
command computes the checksum of the archive before it reads one byte of
the content, and it computes the checksum of each file before it writes
that file. Nothing reaches the cache that `pin.json` does not state.

The cache is in the cache home of the user:

- the directory that `DAVENPORT_TIMEZONE_CACHE` names, where the
  environment sets that variable;
- `$XDG_CACHE_HOME/davenport/timezone-database`, where the environment
  sets `XDG_CACHE_HOME`;
- `~/.cache/davenport/timezone-database` in all other conditions.

The name of the release names the directory that holds its files. A move
of the pin therefore takes nothing away from the cache.

The command uses a cached archive again where the checksum of that archive
agrees with the pin. The command then reaches no network. The command gets
the archive one time for one release.

The release ships its data in the **main** form. It also ships tools that
turn the data into a vanguard form and a rearguard form. Those forms state
a negative seasonal offset in another way, and they disagree with the main
form about the zones that run one. `pin.json` records the form, and a test
holds it at `main`.

The release does **not** ship a file named `tzdata.zi`. That file is a
product of the build of the release, and the archive holds the data files
that this tool reads.

## Get the release, and write the table

```bash
npm run timezone:download          # get the release into the cache
npm run timezone:generate          # write the module
node tools/timezone-table/generate.mjs --check   # compare, write nothing
```

The download command needs a network the first time. After that the
command reads the cache, and it needs no network. The generator reads the
cache and reaches no network. The generator stops when the cache holds no
copy of the release, and the message names the download command. The
generator also stops when a file of the cache does not agree with
`pin.json`.

`--check` writes nothing. It compares the module in the tree against what
the generator writes now. The exit status is 0 when the two agree, 1 when
they differ, and 2 when the script cannot run. The tests make the same
comparison at every test run: the test file `test/timezone-table.test.ts`
runs the generator over the cache and compares byte for byte. That test
states that it has no input, and runs nothing, where the cache holds no
copy of the release. The test fails where the cache holds bytes that the
pin refuses.

`pin.json` records the checksum that the person who moved the pin computed
from the archive. The timezone project publishes no checksum file for an
archive; it publishes a detached signature. `pin.json` names that
signature file, and the step that verifies it is step 1 below. The record
names where the signature is. The record does not state that somebody ran
the check.

## Move the pin to a new release

The database has three to ten releases each year. Each one is a change to
the bytes that the plugin ships.

1. Get the release and check it.

    ```bash
    curl -O https://data.iana.org/time-zones/releases/tzdataYYYYR.tar.gz
    curl -O https://data.iana.org/time-zones/releases/tzdataYYYYR.tar.gz.asc
    gpg --verify tzdataYYYYR.tar.gz.asc tzdataYYYYR.tar.gz
    shasum -a 256 tzdataYYYYR.tar.gz
    tar xzf tzdataYYYYR.tar.gz
    shasum -a 256 LICENSE africa antarctica asia australasia backward \
        etcetera europe factory northamerica southamerica version
    ```

2. Write `pin.json` again: the release, the name and the address of the
   archive, the checksum of the archive, and the checksum of every file.
   `form` stays `main`.

3. Get the release into the cache, and write the table again. Then read
   the difference.

    ```bash
    npm run timezone:download
    npm run timezone:generate
    git diff src/core/timezone/table-data.ts
    ```

    One line of the table states one timezone identifier, so the
    difference names every zone that changed and no other zone.

4. Write the fixture that the tests compare against again. This step needs
   `zic`, the compiler that the timezone project ships. The fixture states
   what a second reader of the same release answers, so the tests do not
   compare the plugin against itself.

    ```bash
    cache=~/.cache/davenport/timezone-database/YYYYR
    zic -b fat -d /tmp/zoneinfo \
        $cache/{africa,antarctica,asia,australasia,backward,etcetera,\
    europe,factory,northamerica,southamerica}
    node tools/timezone-table/oracle.mjs /tmp/zoneinfo
    ```

5. Raise the timezone component of the normalization stamp. A new release
   changes the bytes that a record can carry, and the component indexes
   those bytes. Then write the digest of the new value.

    ```bash
    DAVENPORT_WRITE_TIMEZONE_DIGEST=1 npm test -- table-digest
    ```

    A test computes one digest over the release of the table and the
    definition of every zone that the table holds. The test compares that
    digest against the committed file of the current component, which is
    `test/harness/fixtures/timezone-table/timezone-{N}.digest`. A move of
    the pin that leaves this step out fails at step 6. The failure states
    the raise, and it names the command above. The comparison of two
    records reads the two base snapshots whole where the two records carry
    one value of the component. Two builds can hold two tables under one
    value of the component. Those two builds then rewrite one record in
    turn, and neither build stops. This step keeps that pair out of a
    release.

    The golden set of the synthesiser and the golden set of the record
    ledger also move with the component. Step 6 reads both of them, and
    the failure text of each one states the command that writes it.

6. Run the gates: `npm test`, `npm run lint`, `npm run typecheck`,
   `npm run build` with `node scripts/scan-bundle.mjs`, and
   `npm run coverage` with `node scripts/coverage-ratchet.mjs`.

Steps 1 to 4 need a network one time, for the release itself. Nothing in
the build reaches a network, and no test reaches a network.

## What the table holds

The table covers the period from the start of 1970. It states the changes
of the clock of each zone up to the last change that its rules state, and
then, for a zone whose rules repeat one pair of changes every year with no
last year, that pair. The pair covers every year after the last change, so
the table needs no last year of its own.

`src/core/timezone/table.ts` states the form of a line of the table.
