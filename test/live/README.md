# Live verification

Live verification runs against real CalDAV servers. A live run produces the
recorded facts that the test plan asks for.
[`docs/dev/facts.md`](../../docs/dev/facts.md) is the ledger of those
facts, and it states the entry format. This directory holds what a live run
needs:

- [`docker-compose.yml`](docker-compose.yml), which starts three CalDAV
  servers on your machine, together with the server configuration under
  `radicale/` and `baikal/`;
- [`credentials.ts`](credentials.ts), which turns environment variables
  into the credentials of one provider.

## The six providers, and which of them need an account

The test plan tracks six providers: iCloud, Fastmail, Nextcloud, Radicale,
Baikal and Google. The plan records a set of facts for each provider, and
Part 6.1 of
[`docs/davenport-test-plan.md`](../../docs/davenport-test-plan.md) lists
those facts. The compose file and the verify workflow use the term
"provider column". The provider column of one provider is the set of facts
that the plan records for that provider. To fill in a provider column, a
run must reach a server of that provider.

The compose file in this directory starts a Radicale server, a Baikal
server and a Nextcloud server. The Radicale, Baikal and Nextcloud
provider columns therefore need no account anywhere. The iCloud, Fastmail
and Google provider columns need an account with the provider.

## Start and stop the servers

Run these commands from the root of the repository:

```bash
docker compose -f test/live/docker-compose.yml up -d
docker compose -f test/live/docker-compose.yml down -v
```

The second command removes the volumes together with the containers. Each
start therefore begins from empty servers.

| Server    | CalDAV root                             | User name   | Password    |
| --------- | --------------------------------------- | ----------- | ----------- |
| Radicale  | `http://localhost:5232/`                | `davenport` | `davenport` |
| Baikal    | `http://localhost:8801/dav.php/`        | `davenport` | `davenport` |
| Nextcloud | `http://localhost:8802/remote.php/dav/` | `davenport` | `davenport` |

These credentials are public on purpose. The compose file publishes each
port on `127.0.0.1` only, so nothing outside your machine reaches a server.
The servers hold test data only. The `down -v` command deletes that data
together with the containers.

### Why these ports

Radicale listens on 5232, and 5232 is the default port of Radicale. The
compose file publishes the same number. Baikal and Nextcloud listen on port
80 inside their containers. The compose file publishes Baikal on 8801 and
Nextcloud on 8802. These two numbers stay clear of the ports that
development servers and proxies commonly use. Nextcloud uses the next
number after the Baikal port.

### What each server needs before it answers

The compose file pins the image tag of all three servers.

Radicale reads its configuration and its password file from
[`radicale/`](radicale). The compose file mounts that directory read-only.
The password file holds the one account in plain text.

Baikal answers no CalDAV request until Baikal has a configuration file and
one DAV account. The web installer of Baikal makes both, and a person must
click through that installer.
[`baikal/35-davenport-seed.sh`](baikal/35-davenport-seed.sh) makes both
instead. The image runs that script from the entrypoint directory of the
image, before the image starts the web server. The `version` value in the
script must match the Baikal image tag in the compose file. Baikal compares
the release that wrote the configuration against the release that runs.
When the release that wrote the configuration is the older release, Baikal
sends the browser to the installer.

Nextcloud needs no seed script, because the Nextcloud image installs the
server itself on first boot. The image installs the server only when the
environment supplies an admin user name, an admin password and a database
setting. The compose file supplies all three, and it names a SQLite
database. SQLite therefore needs no second container for a database.
Apache accepts no connection until that install finishes. The first start
of Nextcloud therefore needs more time than the first start of the other
two servers. The stack is sized for boot and teardown, and not for
throughput.

## Credentials

Credentials reach a run only through the process environment.
[`credentials.ts`](credentials.ts) reads no file in the repository. The
repository holds no credential of a real account. The repository does hold
the throwaway pair of the local stack. That pair is in `.env.example`, in
`radicale/users`, in the Baikal seed script and in the compose file, and it
is public on purpose. Three variables describe one provider:

```
DAVENPORT_TEST_<PROVIDER>_URL
DAVENPORT_TEST_<PROVIDER>_USERNAME
DAVENPORT_TEST_<PROVIDER>_SECRET
```

`<PROVIDER>` is `ICLOUD`, `FASTMAIL`, `NEXTCLOUD`, `RADICALE`, `BAIKAL` or
`GOOGLE`. For the providers that use an app password, `_SECRET` holds that
app password. For Google, `_SECRET` holds the OAuth refresh token.

[`credentials.ts`](credentials.ts) resolves these variables. A provider is
unavailable when the environment does not set all three variables of that
provider. A run skips an unavailable provider. A variable that is empty,
and a variable that holds only whitespace, both count as unset. A run
therefore covers the providers that the environment supplies. An
environment that supplies no provider is still a valid environment.

Every lookup receives the environment as an argument.
`processEnvironment()` is the one function in the module that reads
`process.env`. A caller that wants the real process environment passes
that function.

A lookup that reports a provider as unavailable returns the names of the
variables that the provider wants. The lookup never returns the contents of
those variables, and no error message from the module holds a value.
Resolved credentials hold the secret as a plain string. The caller must
keep that secret out of logs, out of error messages, out of recorded facts
and out of workflow output.

### Run against the servers on your machine

Copy [`.env.example`](../../.env.example) from the root of the repository
to `.env`. Fill in the providers that you have. Then source the file:

```bash
cp .env.example .env
$EDITOR .env
set -a; . ./.env; set +a
```

Git ignores `.env`. `.env.example` is the committed template. It holds the
throwaway values of the local stack for Radicale, Baikal and Nextcloud, and
placeholders for the three providers that need an account. Nothing loads
`.env` for you, because the project has no dotenv dependency.

### The providers that need an account

iCloud, Fastmail and Google need an account with the provider. The code
needs no change when such an account arrives. `credentials.ts` already
knows all six providers, and the verify workflow already maps the secrets
of all six. Two steps make the account reachable:

- on your machine, put the three variables in `.env`;
- in CI, add three repository secrets with exactly the same names.

Each provider has its own kind of secret. For iCloud the secret is an
app-specific password from the Apple account page, and not the account
password. For Fastmail the secret is an app password with calendar access.
For Google the secret is a refresh token. The account that owns that token
must have granted the calendar scope. The Nextcloud variables can also
point at a hosted instance instead of the container. There the secret is an
app password from **Settings → Security**.

## The verify workflow

[`.github/workflows/verify.yml`](../../.github/workflows/verify.yml) runs
live verification in CI. The workflow has the `workflow_dispatch` trigger
only. The workflow never runs on push, and it never runs on
`pull_request`. A pull request from a fork therefore has no path to the
provider secrets. A trigger that somebody adds later must also keep the
provider secrets away from push runs and from pull-request runs.

Dispatch the workflow from **Actions → Verify → Run workflow**, or from the
command line:

```bash
gh workflow run verify.yml --field target=containers
```

The `target` input selects the job:

- `containers` starts the compose stack and waits for the three servers.
  The job makes sure that each server answers `OPTIONS` on its CalDAV root
  with a `DAV` header. The job then stops the stack and removes the
  volumes. The job reads no secret, and the job passes without a secret.
  The Nextcloud probe makes up to 150 attempts, and the other two probes
  make up to 60. The probe waits two seconds between attempts, so the
  Nextcloud window is about five minutes. Each attempt also waits up to ten
  seconds for an answer. The first boot of Nextcloud runs the installer,
  and the larger limit gives headroom for a slow runner. Nobody measured
  how long that installer needs.
- `credentials` selects the `credentials-report` job. That job prints, for
  each provider, whether this dispatch can reach the provider. The job
  prints variable names and no values. The job counts a variable that holds
  only whitespace as unset. The resolver counts such a variable as unset
  too, so the job and the resolver never disagree about what counts as
  configured.

A repository secret that does not exist arrives as the empty string, and
the empty string reads as unset. A repository that configures some of the
providers is therefore a working repository.

Each job maps only the variables that the job reads. The report job maps
the provider secrets, and no other job maps them. A runner for one provider
carries the three variables of that provider and no other variables.

The workflow has these two targets today, and neither target runs a
verification protocol against a server. The issue that adds such a runner
also adds the target of that runner.

## What depends on the compose file

Change the compose file, and these files need the matching change:

- [`.github/workflows/verify.yml`](../../.github/workflows/verify.yml)
  probes the three CalDAV roots by URL. A changed port needs a changed URL
  there.
- [`.env.example`](../../.env.example) holds the three URLs and the
  throwaway credentials of this stack.
- [`baikal/35-davenport-seed.sh`](baikal/35-davenport-seed.sh) pins the
  Baikal version, and that value must match the Baikal image tag.
- The compose file mounts [`radicale/config`](radicale/config) and
  [`radicale/users`](radicale/users) into the Radicale container. The port
  in `radicale/config` must match the container port in the Radicale
  mapping of the compose file.

## What runs in `npm test`, and what must not

Live verification does not run in `npm test`, and it does not run in the
required `ci-ok` check. Nothing that reaches a server may run there. A pure
unit test of the code in this directory is a different thing, and it
belongs in the ordinary suite.

Vitest collects `test/**/*.test.ts`. A file in this directory whose name
ends in `.test.ts` therefore runs in `npm test`.
[`credentials.test.ts`](credentials.test.ts) runs there, and that is
correct. That test exercises the resolver over literal records, and it
touches no environment and no network. Give no such name to a file that
reaches a server. A file that reaches a server and carries that name makes
`npm test` reach that server.

A recorded fact names environments and versions: the image tag, the server
release, the provider. A recorded fact never names credential material.
