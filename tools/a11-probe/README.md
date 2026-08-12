# Frontmatter probe

This kit has a small plugin and a script. The plugin records how one build
of Obsidian writes frontmatter. The script compares those records across
devices.

Every device applies every inbound change to the same linked note.
Therefore the sync design depends on one condition: Obsidian emits
identical bytes for identical frontmatter everywhere. This kit is the
tooling for the protocol that settles that question. The protocol is item
A-11 in `docs/davenport-test-plan.md` (Part 6.1).

The plugin is never released. You carry the plugin by hand into a scratch
vault. You run the plugin one time in each environment. You compare its
results files here.

The probe writes into one folder in the vault. The probe uses no network.
The probe touches nothing else.

## Build it

Run these commands one time, from the repository root:

```bash
npm ci
npm run probe:build
```

These commands write `tools/a11-probe/dist/`. That folder holds `main.js`
and `manifest.json`. The build embeds the note corpus into `main.js` at
this step. Therefore you must send the same `dist/` to every environment.
A probe that you build two times from the same commit carries the same
fixtures. The comparison script refuses to compare runs whose fixtures
differed.

## Install it in a vault

On a desktop with the repository checked out, `npm run vault` does all of
this for you. The command makes a scratch vault under `.vaults/`. The
command builds the probe. The command installs the probe. The command
lists the probe as one to enable. The command prints how to open the vault
and what to run in it.

Run `npm run vault` again on the same vault to refresh the probe to the
current build. The rest of this section gives the same steps by hand. A
phone needs these manual steps.

Use a scratch vault. Do not use a vault that holds anything you care
about.

Copy the two files in `dist/` into the vault, at:

```
<Vault>/.obsidian/plugins/davenport-a11-probe/
```

The folder name must be exactly `davenport-a11-probe`. Create the folders
that are not there yet. If this vault uses a different name for
`.obsidian`, use the name of the vault's config folder.

On a desktop, this step is a file copy. On a phone, it is easier to copy
the files on a desktop and then let the vault sync carry the files over.
iOS hides folders whose name starts with a dot, thus the Files app does
not show `.obsidian`. On Android, a file manager that shows hidden folders
can copy the files directly.

Then, in the vault, open **Settings → Community plugins**. Turn off
restricted mode if it is on. Enable **Davenport frontmatter probe** under
installed plugins. If Obsidian was already open when the files arrived,
close the vault and open it again first. As an alternative in that
condition, select the reload button beside the installed plugins heading.

## Run it

Open the command palette. On a desktop, push **Ctrl/Cmd+P**. On a phone,
select the palette icon in the toolbar. Then run
**Run frontmatter probe**.

A notice tells you that the run started. When the run finishes, a second
notice gives the number of samples and the path of the results file. The
second notice stays on screen for twenty seconds. Twenty seconds is long
enough to read a path off a phone. If the run fails, the notice tells you
why. In that condition, desktop consoles also carry the error.

Before the probe writes each note, the probe waits for Obsidian to read
the note back. This wait lets the writer work from the note as it now
stands. Usually the wait returns immediately, and the run takes a few
seconds.

Sometimes Obsidian reports no change, because a re-run can rewrite a note
with the bytes that are already on disk. When Obsidian reports no change,
the wait runs out after three seconds instead. If this occurs for every
fixture, the run takes about forty-five seconds. During such a run, only
the opening notice stays on screen.

The completion notice tells you how many samples waited that long. The
results file marks each of these samples. The comparison prints a caution
for each of these samples. The app's view of the note is possibly stale
when the probe writes these bytes. Therefore these bytes are not evidence
about the writer.

It is safe to run the probe again. Each run rewrites the fixture notes
from the embedded corpus before the run touches them. Therefore a second
run starts from the same text as the first run. Each run writes a new
results file.

## Where the results are

The probe writes everything into a folder called `frontmatter-probe` at
the top of the vault. The folder holds one note for each fixture. The
folder also holds one results file for each run. Each results file has the
name `emission-samples-<timestamp>Z.json`.

That folder is ordinary vault content. Thus the folder is not hidden, but
`.obsidian` is hidden. On a phone, you can reach the results file through
the Files app or an Android file manager. You can also open the file in
Obsidian and share it as text. As an alternative, you can let whatever
syncs the vault carry the file back.

Collect one results file from each environment. Give each file a name that
you will recognise later, such as `macos-1.9.14.json` or
`ios-1.9.14.json`.

When you are done with an environment, delete the plugin folder and the
`frontmatter-probe` folder from the vault. The probe wrote nothing else.

## Compare the runs

Run this command from the repository root, with the node version in
`.nvmrc`:

```bash
node tools/a11-probe/compare.mjs macos-1.9.14.json ios-1.9.14.json
```

The script loads its comparison from a TypeScript module. Node reads such
a module directly from version 24 on. An older node reports an unknown
file extension. An older node does not do anything strange.

You can give the script any number of files, in any order. The output has
five parts:

- **environments** — this part tells you which file is `#1`, which file is
  `#2`, and so on. It also tells you what each file ran on.
- **fixtures** — this part gives one row for each fixture. `agree` means
  that every environment emitted the same bytes. `diverge` means that the
  environments did not emit the same bytes, and the row groups the
  environments by the bytes that each one emitted. `error` means that the
  writer refused the fixture in every environment. `mixed` means that the
  writer refused the fixture in some environments and not in other
  environments. `incomplete` means that a file had no record of that
  fixture at all.
- **cautions** — this part gives the fixtures where some environment
  waited until its cache timeout ran out, marked with `!`. If every side
  of a difference rests on such an environment, the comparison does not
  read the difference as a divergence. In that condition, run that
  environment again and compare the new file. If two environments that did
  not time out show a difference between them, that difference stands. A
  third environment's wait does not change that.
- **divergences** — for anything that diverged, this part gives the offset
  of the first differing byte and a hexdump of the bytes around that
  offset. This part also marks the row that holds the difference.
- **notes** — this part gives anything that makes the comparison
  untrustworthy. Examples are runs that started from different fixture
  text, and a file that records no fixtures. More examples are a file that
  records the same fixture two times, and a recorded hash that does not
  match its recorded bytes. Another example is two files that look like
  one run counted two times. Then this part gives the errors that each
  environment reported.

The last line is the verdict. The verification record transcribes this
verdict.

The exit status is 0 when every fixture agreed. The exit status is 1 when
any fixture diverged. The exit status is 2 when the script could not
compare the files at all.

The script cannot compare the files if any one of these conditions is
true. The files are unreadable, or they are not results files. The files
have missing fixtures, or they hold no fixtures in common. The files came
from different corpora. The files differ only where every side of the
difference rests on an environment whose wait timed out.

The script reports errors, but the script never compares them. A version
that refuses a fixture in every environment behaved consistently. The
wording that the version refuses with is not evidence about emitted bytes.

## What is in here

- `main.ts`, `run.ts`, `environment.ts`, `sha256.ts`, `results.ts` — the
  plugin. The plugin uses the Obsidian API and nothing else, thus it runs
  on phones. `results.ts` holds the shape of a results file, the name that
  a results file takes, and the wording of a failure. None of these items
  touch a platform. The tests for `results.ts` are
  `test/probe-results.test.ts`.
- `manifest.json` — the plugin manifest. Its minimum app version is the
  release that introduced the frontmatter writer that the probe exercises.
- `build.mjs` — the build. The build reads the note fixtures from
  `test/harness/fixtures/notes/` through the harness loader. Then the
  build generates the fixtures into the bundle.
- `compare.mjs`, `compare-core.ts`, `compare-format.ts` — the comparison.
  The script holds the reading and the printing. The comparison itself is
  a pure function. The tests for the comparison are
  `test/probe-compare.test.ts`.
