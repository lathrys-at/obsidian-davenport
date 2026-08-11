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

Credential values never leave that module. An unavailable provider reports
the *names* of the variables it wants, never their contents, and no error
or log line from it carries a value. Anything built on top of it inherits
that obligation.

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
`.env.example` already match it.

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
workflow has to preserve it. Repository secrets named for the scheme above
are mapped into the job environment; a secret that does not exist arrives
as the empty string, which the resolver reads as unavailable.

The workflow takes a `target` input. Its one target today is `containers`:
it brings up the compose stack, waits for both servers, confirms each
answers `OPTIONS` on its CalDAV root with a `DAV` header, and tears the
stack down. That job needs no secret and passes without one. Targets for
the protocol runners arrive with the issues that add those runners.

## Conventions for what lands here

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
