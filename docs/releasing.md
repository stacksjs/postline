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

4. Bump, tag and push with the release script, never by hand:

   ```bash
   bun run release:patch
   ```

   (`release:minor` or `release:major` as appropriate.) The tag starts
   `.reviewos/workflows/release.yml`, which builds the DMG with a build number
   and attaches it to the GitHub release with `checksums.txt`.

## After

5. Download the DMG from the release page, check it against `checksums.txt`,
   and install it on a Mac with an existing workspace. It opens, the data is
   there, and a scheduled post goes out with the window closed.
6. Open the download page and confirm its button names the new version.
7. If anything is wrong, say so on the release before fixing forward with a
   new patch release; a published version is never replaced.
