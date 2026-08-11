# Live verification

Verification protocols run against real CalDAV servers rather than the
harness fakes. This directory holds what those runs need: how credentials
reach them, and the two self-hosted servers that need no account.

## Credential scheme

Credentials come from the process environment only, never from a file in
the repository. Three variables describe one provider:

```
DAVENPORT_TEST_<PROVIDER>_URL
DAVENPORT_TEST_<PROVIDER>_USERNAME
DAVENPORT_TEST_<PROVIDER>_SECRET
```

`<PROVIDER>` is one of `ICLOUD`, `FASTMAIL`, `NEXTCLOUD`, `RADICALE`,
`BAIKAL`, `GOOGLE`. `_SECRET` is the app password for the providers that
use one and the OAuth refresh token for Google.

[`credentials.ts`](credentials.ts) resolves them. A provider whose three
variables are not all set reports itself unavailable, so a run covers
whichever providers the environment supplies and an environment supplying
none is still a valid environment — nothing throws at import, and an empty
variable counts as unset. The lookups are pure functions over an injected
record; `processEnvironment()` is the one function that reads
`process.env`, so a caller decides when the real environment is consulted.

An unavailable provider reports the *names* of the variables it wants,
never their contents, and no error or log line from the module carries a
value. That guarantee ends at the return value: resolved credentials are a
plain object holding the secret as a plain string, and keeping it out of
logs, errors, recorded facts and workflow output is the obligation of
whatever asked for it.

## Running locally

Copy [`.env.example`](../../.env.example) from the repository root to
`.env`, fill in the providers you have, and source it:

```bash
cp .env.example .env
$EDITOR .env
set -a; . ./.env; set +a
```

`.env` is gitignored; `.env.example` is the committed template and carries
placeholders only. Nothing loads `.env` on its own — there is no dotenv
dependency, and sourcing it is the developer's step.

## Self-hosted servers

[`docker-compose.yml`](docker-compose.yml) brings up Radicale and Baikal
with throwaway credentials baked in, so those two provider columns need no
account anywhere:

```bash
docker compose -f test/live/docker-compose.yml up -d
docker compose -f test/live/docker-compose.yml down -v
```

Radicale answers on `http://localhost:5232/` and Baikal on
`http://localhost:8801/dav.php/`, both as `davenport`/`davenport`. Those
credentials are public on purpose: the stack binds to loopback, holds
nothing but test data, and is torn down with its volumes. The values in
`.env.example` already match it. Radicale keeps its upstream default port;
Baikal's upstream default is 80, so it takes one clear of the range dev
servers and proxies compete for. Both image tags are pinned.

Radicale takes its configuration and its password file from
[`radicale/`](radicale). Baikal has no such hook, so
[`baikal/35-davenport-seed.sh`](baikal/35-davenport-seed.sh) runs from the
image's entrypoint directory and writes the configuration and the one DAV
account its web installer would otherwise produce. The version pinned in
that script must match the image tag: Baikal sends a browser to its
installer when the configuration it finds was written by an older release
than the one running.

## Continuous integration

[`.github/workflows/verify.yml`](../../.github/workflows/verify.yml) is
`workflow_dispatch` only. It never runs on push and never on
`pull_request`, so a pull request from a fork has no path to the provider
secrets — that is the reason for the trigger, and any trigger added to that
workflow has to preserve it.

Repository secrets are named exactly for the variables above. A secret that
does not exist arrives as the empty string, which reads as unavailable, so
a partly configured repository is a working repository. **A job maps only
the variables it reads.** A runner for one provider carries that provider's
three and no others, and a job that consumes none — the container job is
one — carries none at all. Widening a job's mapping to variables it does
not read is the thing this rule exists to prevent.

The `target` input picks the job. `containers` brings up the compose stack,
waits for both servers, confirms each answers `OPTIONS` on its CalDAV root
with a `DAV` header, and tears the stack down; it takes no secret and
passes without one. `credentials` prints which providers a dispatch can
reach, by variable name — it is where the secret mapping lives today, and
it treats a whitespace-only variable as unset so that it and the resolver
never disagree about what counts as configured. Targets for the protocol
runners arrive with the issues that add those runners.

## Conventions for what lands here

Live verification is not part of `npm test` or `ci-ok`: nothing that
reaches a server may run there. Pure unit tests of the code in this
directory are a different thing and belong in the ordinary suite, where the
required check gates regressions in them.

Vitest collects `test/**/*.test.ts`, so a file here named `*.test.ts` runs
in `npm test`. That is correct for
[`credentials.test.ts`](credentials.test.ts), which exercises the resolver
as a pure function over literal records and touches no environment and no
network. Anything that talks to a server must not carry that name, or the
ordinary test run will try to reach one.

Recorded facts name environments and versions — the image tag, the server
release, the provider — and never credential material. A run that would
put a credential into a fact, an artifact, or a workflow log is a defect in
the run.
