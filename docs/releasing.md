# Release checklist

Used for every release. Each step either passes or stops the release.

## Before

1. `main` is green on ReviewOS: lint, type check, tests, the compiled agent,
   the site build and the browser check. Look at the browser check's
   screenshots on the run, not just its status.
2. Locally, on the commit being released:

   ```bash
   bun run typecheck:app
   ```

   ```bash
   ./buddy test
   ```

   The suite includes the v0.1.1 upgrade test; if the database changed, add a
   row for the new shape to it.
3. Read the commits since the last tag. Anything that needs an owner to act
   (a new variable, a reconnect, a manual step) goes in docs/upgrading.md.

## Cutting it

4. After the owner approves the version, bump, tag and push it with the release script.

   ```bash
   bun run release:patch
   ```

   Use `release:minor` or `release:major` for the corresponding version change.
   Wait for ReviewOS CI to pass on the new tag's commit, then dispatch the
   release workflow with that tag. Substitute the approved version for `vX.Y.Z`.

   ```bash
   reviewos run release.yml --repo stacks/postline --ref main --input tag=vX.Y.Z --watch
   ```

   The workflow checks the tag's CI verdict and builds on the Mac runner.
   `buddy release:desktop` notarizes and staples the DMG, then publishes the
   signed stable update through the Postline feed. The GitHub release includes
   the DMG, `checksums.txt`, its `checksums.txt.sig` signature, and the signed
   `release-manifest.json`.

   The runner's `DESKTOP_NOTARY_PROFILE` variable must name an approved
   notarytool Keychain profile. Its `postline-desktop-updates` Keychain
   service must hold `main`, `storage-access-key-id`, and
   `storage-secret-access-key`. The `main` key must match the public key in
   `config/desktop.ts`. The storage credential can publish to the private
   update bucket. The production feed uses its own read-only credential.

## After

5. Download the DMG, `checksums.txt`, and `checksums.txt.sig` into one directory.
   Verify them with `bun scripts/release-checksums.ts verify /path/to/Postline.dmg`
   from a trusted Postline checkout. Install it on a Mac with an existing workspace.
   It opens, the data is
   there, and a scheduled post goes out with the window closed. Then run
   [the smoke test](smoke-test.md).
6. Open the download page and confirm its button names the new version.
7. If anything is wrong, say so on the release before fixing forward with a
   new patch release; a published version is never replaced.
