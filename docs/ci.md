# CI on ReviewOS

Postline's CI and its desktop release run on [ReviewOS](https://reviewos.org),
not on GitHub Actions. The code stays on GitHub: ReviewOS mirrors the
repository, runs `.reviewos/workflows` on every commit and tag the mirror
fetches, and posts the verdict back to the commit as the status
"ReviewOS / CI".

| File | Runs |
|---|---|
| `.reviewos/workflows/ci.yml` | lint, type checks, tests, desktop and site builds, and browser checks on every push and pull request |
| `.reviewos/workflows/release.yml` | builds and publishes the DMG for an approved `v*` tag with passing CI, on manual dispatch |
| `.reviewos/workflows/deploy.yml` | deploys a passing `main` commit or rolls back Postline's server, on manual dispatch |

Every job runs on Postline's own Mac runner, labelled
`[self-hosted, macos-arm64, postline]`. A runner takes a job only when it
carries every label the job asks for.

ReviewOS reads `.reviewos/workflows` in place of `.github/workflows` when the
directory exists, so nothing under `.github/workflows` runs there.

## Reading a run

```bash
reviewos runs --repo stacks/postline
```

```bash
reviewos watch <run-number> --repo stacks/postline
```

```bash
reviewos logs <run-number> --repo stacks/postline --job test
```

```bash
reviewos run ci.yml --ref main --watch --repo stacks/postline
```

`reviewos login` signs the CLI in once; the token is kept in the keychain.

The site job checks the gzipped asset budgets and runs Lighthouse on the built
marketing homepage through the same gateway used in production. The mobile
and desktop profiles each need at least 95 in every category. The job retains
the Lighthouse reports as artifacts.

## What the workflows assume

- **No checkout step.** The runner checks the commit out before the first step.
- **Bun from Pantry.** Each job starts with the Pantry action, pinned to a full
  commit. The runners refuse an action that is not pinned.
- **SQLite for tests.** A runner has no `.env`, so the test job sets
  `DB_CONNECTION=sqlite` and migrates a fresh database before the suite.
- **The release publishes to GitHub by name.** Inside a ReviewOS job
  `GITHUB_TOKEN`, `GITHUB_API_URL` and `GITHUB_REPOSITORY` are ReviewOS's. The
  publish step sets the last two to GitHub's and uses the `GH_RELEASE_TOKEN`
  secret.

## How it is set up

Recorded so it can be repeated on another machine. All of it is done.

1. **The mirror.** `mirrors.yml` in the ReviewOS repository lists
   `stacksjs/postline` with `ci: true`; the instance applies it on every
   deploy (`buddy mirror:apply mirrors.yml`).
2. **The Mac runner**, registered on the instance host for this repository
   alone:

   ```bash
   ./buddy runner:local --register --repository stacks/postline --name postline-macos-arm64 --labels self-hosted,macos-arm64,postline
   ```

   On the Mac it lives in `~/.local/share/reviewos/postline/`: the
   `reviewos-runner` binary, `runner.token` (mode 0600) and `start.sh`, kept
   running by the LaunchAgent `org.reviewos.postline-runner`. Running the
   command again rotates the token.

The release publishes with the repository secret `GH_RELEASE_TOKEN` in
ReviewOS, a GitHub token with `contents: write` on `stacksjs/postline`. It is
set and was used for v0.1.0 and v0.1.1. Repository-only permissions are tracked
in [#235](https://github.com/stacksjs/postline/issues/235).

## Linux container check

GitHub Actions runs the [container workflow](https://github.com/stacksjs/postline/actions/workflows/container.yml)
on Linux. It builds the self-hosting image and verifies first run, scheduler
health, and data retention after replacing the container.

## Checking on the runner

```bash
launchctl list | grep org.reviewos.postline-runner
```

```bash
tail -f ~/.local/share/reviewos/postline/runner.log
```

"Waiting for work" is healthy. "Runner capacity hold" names what it is short
of. The runner needs 8 GB of free disk before it takes a job, and this Mac has
run close to that.

## Updating the Postline runner

Wait for the Postline runner’s current jobs to finish. In the ReviewOS checkout,
use its locked dependencies and the project’s Bun to build the replacement.

```bash
./buddy build:runner --target macos-arm64
```

Record the ReviewOS source commit and the binary’s SHA-256. Keep a copy of the
installed binary, then replace `~/.local/share/reviewos/postline/reviewos-runner`
with the new executable using an atomic rename in that directory. The existing
LaunchAgent uses the runner’s registration and credentials in the same directory.

```bash
launchctl kickstart -k "gui/$(id -u)/org.reviewos.postline-runner"
```

Check the runner log for `Waiting for work` and confirm its next Postline CI job
checks out the requested commit. If startup fails, restore the saved executable
and restart the LaunchAgent with the same command.

## Bringing up a replacement Mac runner

Use another Apple Silicon Mac with enough disk space for Pantry, Chrome, the
compiled agent and the DMG. From the ReviewOS checkout, register it with a
unique name and the same Postline job labels.

```bash
./buddy runner:local --register --repository stacks/postline --name postline-macos-arm64-spare --labels self-hosted,macos-arm64,postline
```

Install the launch agent under the runner's Mac account. Confirm it can run
the compiled agent check with its login Keychain available. To build release
artifacts, provision the approved Developer ID identity and the matching
Postline update signing key through the release secret store.

While the primary runner is offline, dispatch `ci.yml` on `main` and confirm
the job ran on the replacement. Check the exact commit's `ReviewOS / CI`
verdict on GitHub. Then use the normal release workflow for an approved tag.
It will use the same Bun version, build, checksum signing, and CI checks.
[Release checklist](releasing.md).

## Deploying the public site

The production environment uses the Postline runner's SSH identity for the
shared Hetzner server. ReviewOS also needs the site's
`DOTENV_PRIVATE_KEY_PRODUCTION` and a Hetzner token that can read the attached
server's inventory. The production environment is limited to `main`. DNS for
both Postline hostnames is managed in Porkbun.

```bash
reviewos run deploy.yml --repo stacks/postline --ref main --input operation=deploy --watch
```

This workflow checks the selected commit's `ReviewOS / CI` verdict before
deploying. It probes the public API and the short hostname after deployment.
If deployment or verification fails, it asks Stacks to roll back only sites
that switched to the failed release. To request the previous release manually,
dispatch the same workflow with `operation=rollback`.

## The Mac runner and load

A runner can hold new work while the machine is busy:
`REVIEWOS_RUNNER_MAX_LOAD_PER_CPU`, compared with the one-minute load average
per CPU. Postline's runner sets it to 6, and both extremes are why.

- **Too low refuses everything.** On macOS the load average is a poor measure
  of headroom: this Mac idles at 20 to 39 on 11 CPUs while `top` reports the
  CPUs 40% idle. The other runners here use 1.5 per CPU, and one of them
  logged "Runner capacity hold" 9,905 times.
- **No limit loses jobs.** With none, a lint job was taken while another
  runner had the load at 300. It could not renew its lease in time and the
  instance cancelled it: "The instance did not renew this job before its
  lease expired". That is a busy machine, not a broken workflow; run it again.

6 per CPU (66 here) passes the first case and holds for the second.
