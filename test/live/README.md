# Live verification

Verification protocols run against real CalDAV servers. They do not run
against the harness fakes. This directory holds what those runs need: the
way that credentials reach them, and the three self-hosted servers that
need no account.

## Credential scheme

Credentials come only from the process environment. They never come from a
file in the repository. Three variables describe one provider:

```
DAVENPORT_TEST_<PROVIDER>_URL
DAVENPORT_TEST_<PROVIDER>_USERNAME
DAVENPORT_TEST_<PROVIDER>_SECRET
```

`<PROVIDER>` is one of `ICLOUD`, `FASTMAIL`, `NEXTCLOUD`, `RADICALE`,
`BAIKAL`, `GOOGLE`. `_SECRET` is the app password for the providers that
use an app password. For Google, `_SECRET` is the OAuth refresh token.

[`credentials.ts`](credentials.ts) resolves these variables. A provider
reports itself unavailable if the environment does not set all three of its
variables. A run therefore covers the providers that the environment
supplies. An environment that supplies no provider is still a valid
environment. Nothing throws at import. An empty variable counts as unset.
The lookups are pure functions over an injected record.
`processEnvironment()` is the one function that reads `process.env`. A
caller therefore decides when the code reads the real environment.

An unavailable provider reports the *names* of the variables that it wants.
It never reports their contents. No error or log line from the module
carries a value. This guarantee ends at the return value. Resolved
credentials are a plain object that holds the secret as a plain string. The
caller that asked for the credentials must keep the secret out of logs,
errors, recorded facts and workflow output.

## Running locally

Copy [`.env.example`](../../.env.example) from the repository root to
`.env`. Fill in the providers that you have. Then source the file:

```bash
cp .env.example .env
$EDITOR .env
set -a; . ./.env; set +a
```

Git ignores `.env`. `.env.example` is the committed template, and it
carries placeholders only. Nothing loads `.env` automatically, because the
project has no dotenv dependency. The developer sources the file.

## Self-hosted servers

[`docker-compose.yml`](docker-compose.yml) starts Radicale, Baikal and
Nextcloud. The compose file contains throwaway credentials. Those three
provider columns therefore need no account anywhere:

```bash
docker compose -f test/live/docker-compose.yml up -d
docker compose -f test/live/docker-compose.yml down -v
```

Radicale answers on `http://localhost:5232/`. Baikal answers on
`http://localhost:8801/dav.php/`. Nextcloud answers on
`http://localhost:8802/remote.php/dav/`. All three servers use
`davenport`/`davenport` as the username and the password. These credentials
are public on purpose. The reason is that the stack binds to loopback,
holds only test data, and goes down together with its volumes. The values
in `.env.example` already match this stack. Radicale keeps its upstream
default port. The upstream default port for Baikal is 80. Baikal therefore
takes a port that is clear of the range where dev servers and proxies
compete. Nextcloud takes the next port after the Baikal port. All three
image tags are pinned.

Radicale takes its configuration and its password file from
[`radicale/`](radicale). Baikal has no equivalent hook. Therefore
[`baikal/35-davenport-seed.sh`](baikal/35-davenport-seed.sh) runs from the
entrypoint directory of the image. The script writes the configuration and
the one DAV account. The Baikal web installer would otherwise produce that
configuration and that account. The version that the script pins must match
the image tag. This requirement comes from the behavior of Baikal. If a
release older than the running release wrote the configuration that Baikal
finds, Baikal sends a browser to its installer.

Nextcloud needs no such seed, because the Nextcloud image installs the
server itself on first boot. The image installs the server only when the
environment supplies both the admin account and a database. The compose
file therefore sets a SQLite database name together with the credentials.
SQLite also keeps the server in one container. The stack is sized for boot
and teardown, not for throughput. Apache does not accept a connection until
that install finishes. The CI probe therefore allows Nextcloud a window of
about five minutes, and it leaves the other two servers on their shorter
window. The window is headroom, not a measurement. On a CI runner, the
install finished in about ten seconds in the observed runs. The Nextcloud
image does more work than the other two images do. A slower machine is the
case that the window must survive.

## Continuous integration

[`.github/workflows/verify.yml`](../../.github/workflows/verify.yml) has
the `workflow_dispatch` trigger only. The workflow never runs on push. The
workflow never runs on `pull_request`. A pull request from a fork therefore
has no path to the provider secrets. This property is the reason for the
trigger. Any trigger that someone adds to that workflow must keep this
property.

The repository secrets have exactly the names of the variables above. A
secret that does not exist arrives as the empty string. The empty string
reads as unavailable. A partly configured repository is therefore a working
repository. **A job maps only the variables it reads.** A runner for one
provider carries the three variables of that provider and no other
variables. A job that consumes no variable carries no variable at all, and
the container job is such a job. This rule exists to prevent one thing: a
wider job mapping that includes variables the job does not read.

The `target` input selects the job. The `containers` job starts the compose
stack. It waits for all three servers. It confirms that each server answers
`OPTIONS` on its CalDAV root with a `DAV` header. It then tears the stack
down. The `containers` job takes no secret, and it passes without one. The
`credentials` job prints the providers that a dispatch can reach, and it
prints them by variable name. That job holds the secret mapping today. It
treats a whitespace-only variable as unset, so that the job and the
resolver never disagree about what counts as configured. Targets for the
protocol runners arrive with the issues that add those runners.

## Conventions for what lands here

Live verification is not part of `npm test` or `ci-ok`. Nothing that
reaches a server may run there. Pure unit tests of the code in this
directory are a different thing, and they belong in the ordinary suite. In
the ordinary suite, the required check gates regressions in those unit
tests.

Vitest collects `test/**/*.test.ts`. A file in this directory with the name
`*.test.ts` therefore runs in `npm test`. That result is correct for
[`credentials.test.ts`](credentials.test.ts). That test exercises the
resolver as a pure function over literal records. It touches no environment
and no network. Anything that talks to a server must not carry that name.
If it carries that name, the ordinary test run will try to reach a server.

Recorded facts name environments and versions: the image tag, the server
release, the provider. Recorded facts never name credential material. A
run that puts a credential into a fact, an artifact, or a workflow log is a
defect in the run.
