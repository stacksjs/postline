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

Still to set, on the repository in ReviewOS, before the first release: the
variable `DESKTOP_URL` and the secret `GH_RELEASE_TOKEN` (a GitHub token with
`contents: write` on `stacksjs/postline`).

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

A runner can be told to hold new work while the machine is busy:
`REVIEWOS_RUNNER_MAX_LOAD_PER_CPU`. It compares the one-minute load average
with that number per CPU.

On macOS the load average is a poor measure of headroom. Measured on the Mac
that runs these jobs, on 2026-11-15: a load average of 23 to 27 on 11 CPUs
while `top` reported the CPUs 38% idle. With the limit at 1.5 per CPU the
existing runners logged "Runner capacity hold" 9,905 times and took almost no
work. Leave the limit unset for Postline's runner, or set it well above what
the machine idles at (4 per CPU), and check the log:

```bash
tail -f ~/.local/share/reviewos/postline/runner.log
```

"Runner capacity hold" repeating there means the limit is refusing work, not
that there is none.
