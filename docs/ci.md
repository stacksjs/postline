# CI on ReviewOS

Postline's CI and its desktop release run on [ReviewOS](https://reviewos.org),
not on GitHub Actions. The code stays on GitHub: ReviewOS mirrors the
repository, runs `.reviewos/workflows` on every commit and tag the mirror
fetches, and posts the verdict back to the commit as the status
"ReviewOS / CI".

| File | Runs | Where |
|---|---|---|
| `.reviewos/workflows/ci.yml` | lint, type check, test, on every push and pull request | the instance's Linux runners, `[self-hosted, aws]` |
| `.reviewos/workflows/release.yml` | builds the DMG and publishes the GitHub release, on a `v*` tag | Postline's Mac runner, `[self-hosted, macos-arm64, postline]` |

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

## Setting it up

These are done once, and three of them need an instance administrator.

1. **Mirror the repository.** `mirrors.yml` in the ReviewOS repository lists
   `stacksjs/postline` with `ci: true`; it is applied on every deploy of the
   instance (`buddy mirror:apply mirrors.yml`).
2. **Give the Linux jobs a pool.** The `aws` pool has to be assigned to
   `stacks/postline` (`assign-repository` on the fleet API).
3. **Register the Mac runner.** On the instance host:

   ```bash
   ./buddy runner:local --register --repository stacks/postline --name postline-macos-arm64 --labels self-hosted,macos-arm64,postline
   ```

   That prints a runner token. On the Mac, put it in
   `~/.local/share/reviewos/postline/runner.token` (mode 0600) beside a copy of
   the `reviewos-runner` binary and a `start.sh` that exports `REVIEWOS_URL`,
   `REVIEWOS_RUNNER_TOKEN`, `REVIEWOS_ACTION_HOSTS=github.com`,
   `REVIEWOS_ACTION_DEFAULT_HOST=github.com` and `REVIEWOS_ACTION_PINNED=1`,
   then runs the binary. A LaunchAgent keeps it running; the two already on
   this Mac (`~/.local/share/reviewos/stacks-source`, `hq-mobile`) are the
   pattern.
4. **Set what the release needs**, on the repository in ReviewOS: the variable
   `DESKTOP_URL` and the secret `GH_RELEASE_TOKEN` (a GitHub token with
   `contents: write` on `stacksjs/postline`).

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

## Until the first green run

`.github/workflows/ci.yml` and `release.yml` are still in the repository, so a
push is checked somewhere while the mirror and the runner are being set up.
Delete both once a ReviewOS run has passed.
