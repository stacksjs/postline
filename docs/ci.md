# CI on ReviewOS

Postline's CI and its desktop release run on [ReviewOS](https://reviewos.org),
not on GitHub Actions. The code stays on GitHub: ReviewOS mirrors the
repository, runs `.reviewos/workflows` on every commit and tag the mirror
fetches, and posts the verdict back to the commit as the status
"ReviewOS / CI".

| File | Runs |
|---|---|
| `.reviewos/workflows/ci.yml` | lint, type check, test, on every push and pull request |
| `.reviewos/workflows/release.yml` | builds the DMG and publishes the GitHub release, on a `v*` tag |

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
set; v0.1.0 and v0.1.1 were released with it.

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
