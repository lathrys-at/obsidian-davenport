# Frontmatter probe

A small plugin that records how one build of Obsidian writes frontmatter,
and a script that compares those records across devices.

Every device applies every inbound change to the same linked note, so the
sync design rests on Obsidian emitting identical bytes for identical
frontmatter everywhere. This kit is the tooling for the protocol that
settles that, item A-11 in `docs/davenport-test-plan.md` (Part 6.1). The
plugin is never released; it is carried by hand into a scratch vault, run
once per environment, and its results files are compared here.

The probe writes into one folder in the vault, reaches no network, and
touches nothing else.

## Build it

Once, from the repository root:

```bash
npm ci
npm run probe:build
```

That writes `tools/a11-probe/dist/`, holding `main.js` and
`manifest.json`. The note corpus is embedded into `main.js` at this point,
so the same `dist/` must go to every environment: a probe built twice from
the same commit carries the same fixtures, and the comparison script
refuses to compare runs whose fixtures differed.

## Install it in a vault

Use a scratch vault, not one holding anything you care about.

Copy the two files in `dist/` into the vault, at:

```
<Vault>/.obsidian/plugins/davenport-a11-probe/
```

The folder name has to be exactly `davenport-a11-probe`. Create the
folders that are not there yet. If `.obsidian` is a different name in this
vault, use whatever the vault's config folder is called.

On desktop this is a file copy. On a phone it is easier to copy the files
on a desktop and let the vault sync carry them over — iOS hides folders
whose name starts with a dot, so the Files app will not show `.obsidian`.
On Android, a file manager that shows hidden folders can do it directly.

Then, in the vault: **Settings → Community plugins**, turn off restricted
mode if it is on, and enable **Davenport frontmatter probe** under
installed plugins. If Obsidian was already open when the files arrived,
close and reopen the vault first, or select the reload button beside the
installed plugins heading.

## Run it

Open the command palette — **Ctrl/Cmd+P** on desktop, the palette icon in
the toolbar on a phone — and run **Run frontmatter probe**.

A notice says the run has started. When it finishes, a second notice gives
the number of samples and the path of the results file. It stays up for
twenty seconds, which is long enough to read a path off a phone. If the
run fails, the notice says why, and desktop consoles also carry the error.

Before writing each note the probe waits for Obsidian to read it back, so
that the writer works from the note as it now stands. That wait usually
returns at once and the run takes a few seconds. Where Obsidian reports no
change — a re-run can rewrite a note with the bytes already on disk — the
wait runs out after three seconds instead, and a run in which that happens
for every fixture takes about forty-five seconds, with only the opening
notice on screen. The completion notice says how many samples waited that
long, each such sample is marked in the results file, and the comparison
prints a caution for it, because bytes written while the app's view of the
note was possibly stale are not evidence about the writer.

It is safe to run again: each run rewrites the fixture notes from the
embedded corpus before touching them, so a second run starts from the same
text as the first, and each run writes a new results file.

## Where the results are

Everything lands in a folder called `frontmatter-probe` at the top of the
vault: one note per fixture, and one results file per run, named
`emission-samples-<timestamp>Z.json`.

That folder is ordinary vault content, so it is not hidden the way
`.obsidian` is. On a phone the results file can be reached through the
Files app or an Android file manager, opened in Obsidian and shared as
text, or simply carried back by whatever syncs the vault.

Collect one results file per environment and give each a name you will
recognise later, such as `macos-1.9.14.json` or `ios-1.9.14.json`.

When an environment is done with, delete the plugin folder and the
`frontmatter-probe` folder from the vault. Nothing else was written.

## Compare the runs

From the repository root, on the node version in `.nvmrc`:

```bash
node tools/a11-probe/compare.mjs macos-1.9.14.json ios-1.9.14.json
```

The script loads its comparison from a TypeScript module, which node reads
directly from version 24 on. An older node reports an unknown file
extension rather than doing anything strange.

Any number of files, in any order. The output has five parts:

- **environments** — which file is `#1`, `#2` and so on, and what each ran
  on.
- **fixtures** — one row per fixture. `agree` means every environment
  emitted the same bytes. `diverge` means they did not, and the row groups
  the environments by what each emitted. `error` means the writer refused
  the fixture everywhere; `mixed` means it refused in some environments and
  not others. `incomplete` means a file had no record of that fixture at
  all.
- **cautions** — fixtures where some environment waited its cache timeout
  out, marked with `!`. Where every side of a difference rests on such an
  environment, it is not read as a divergence: run that environment again
  and compare the new file. A difference that two environments which did
  not time out show between them stands, whatever a third one's wait did.
- **divergences** — for anything that diverged, the offset of the first
  differing byte and a hexdump of the bytes around it, with the row holding
  the difference marked.
- **notes** — anything that makes the comparison untrustworthy, such as
  runs that started from different fixture text, a file recording no
  fixtures or the same fixture twice, a recorded hash that does not match
  its recorded bytes, or two files that look like one run counted twice;
  then the errors each environment reported.

The last line is the verdict, which is what the verification record
transcribes.

The exit status is 0 when every fixture agreed, 1 when any of them
diverged, and 2 when the files could not be compared at all — unreadable,
not results files, missing fixtures, holding no fixtures in common, written
from different corpora, or differing only where every side of the
difference rests on an environment whose wait timed out.

Errors are reported but never compared. A version that refuses a fixture
everywhere has behaved consistently, and the wording it refuses with is not
evidence about emitted bytes.

## What is in here

- `main.ts`, `run.ts`, `environment.ts`, `sha256.ts`, `results.ts` — the
  plugin. It uses the Obsidian API and nothing else, so it runs on phones.
  `results.ts` holds the shape of a results file, the name one takes, and
  the wording of a failure, none of which touch a platform; its tests are
  `test/probe-results.test.ts`.
- `manifest.json` — the plugin manifest. Its minimum app version is the
  release that introduced the frontmatter writer the probe exercises.
- `build.mjs` — the build, which reads the note fixtures from
  `test/harness/fixtures/notes/` through the harness loader and generates
  them into the bundle.
- `compare.mjs`, `compare-core.ts`, `compare-format.ts` — the comparison.
  The reading and printing are in the script; the comparison itself is a
  pure function, and its tests are `test/probe-compare.test.ts`.
