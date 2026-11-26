# Desktop app

Postline is a Mac app that runs itself. The app's executable is a compiled
agent that serves the workspace and the API on a loopback port, and its window
is a [Craft](https://github.com/craft-native/craft) web view pointed at that
agent. Nothing is deployed for it to open, and there is no account to create:
the person at the Mac is the owner.

What is theirs lives in `~/Library/Application Support/Postline`:

| File | What it is |
|---|---|
| `postline.sqlite` | Posts, the queue, connected accounts, metrics |
| `app.keychain-id` | Identifies the workspace's encryption key in the login Keychain |
| `storage/app/postline-media/` | Images attached to queued posts |
| `content/blog/` | Long-form posts published to the blog channel |
| `postline.before-<migration>.sqlite` | A copy made before an upgrade migrates the database |

The log is `~/Library/Logs/Postline.log`.

## How it is put together

| File | What it does |
|---|---|
| `config/desktop.ts` | The `webview` app: name, bundle id, window, where the agent and the views are |
| `app/Desktop/Agent.ts` | The agent's own code: answers `/api/*` with the app's routes, starts the recurring jobs |
| `app/Desktop/data.ts` | Prepares the data directory before any framework code loads: database, app key, working directory |
| `app/Desktop/keychain.ts` | Loads or creates the workspace key in the login Keychain and migrates the legacy key file after a successful upgrade |
| `app/Desktop/schedule.ts` | Runs the recurring jobs on timers while the app is open |
| `scripts/desktop-bundle.ts` | Writes what the agent carries: routes, actions, middleware, jobs, migrations, and a migrated empty database |
| `app/Desktop/build-views.ts` | Builds the pages the app carries: the workspace, without the marketing site |
| `scripts/desktop-check.ts` | Compiled and run from an empty directory, proves the agent serves the API and writes to its database. The release runs it before imaging |
| `resources/views/settings.stx`, `resources/layouts/settings.stx` | The Settings window |
| `app/Desktop/bundle.generated.js`, `database.template.sqlite` | That script's output. Build products, not committed |
| `app/Desktop/icon.svg`, `AppIcon.icns`, `scripts/app-icon.ts` | The icon, and the script that draws it |

Three things about a compiled agent shape all of this:

- **It has no project tree.** The framework finds routes, actions, middleware
  and migrations by reading files off disk. The agent is one binary, so
  `scripts/desktop-bundle.ts` names each of them as a static import the
  bundler can follow.
- **Order matters at startup.** The framework reads the database path and the
  app key when its modules are first evaluated. `Agent.ts` therefore imports
  nothing from the framework at the top: it prepares the data directory, then
  imports the rest.
- **Nobody signs in.** The framework's launcher gives the window a one-time
  token for a cookie and refuses any request without it, or with a Host that
  is not the agent's own port. A request that reaches the router is already
  the person at the Mac. `app/Desktop/data.ts` sets `POSTLINE_DESKTOP_AGENT`,
  and the auth middleware lets those requests through; the flag is read from
  the environment, never from a request.

## Build and run

```bash
bun scripts/desktop-bundle.ts
```

```bash
./buddy build:desktop
```

```bash
open storage/framework/desktop/webview/darwin-arm64/Postline.app
```

`./buddy dev:desktop` runs the same agent from source, with the views rendered
live. Run `bun scripts/desktop-bundle.ts` again after adding a route, an
action, a middleware or a migration.

To check the compiled agent the way the release does:

```bash
bun build --compile scripts/desktop-check.ts --outfile /tmp/postline-check && (cd /tmp && ./postline-check)
```

## Settings

Settings is a window of its own, as in any Mac app: the app menu's
Settings item, Cmd+, the comma key and the sidebar link all open it, and
asking again brings the same window forward. It is stx's `SettingsWindow`
with its Mac controls, opened with `craft.window.open` from
`resources/layouts/app.stx`. In a browser the same page fills the tab, with a
link back to the workspace.

Two windows share the app's storage (`--persistent-storage` in
`config/desktop.ts`), which is how the Settings window has the workspace's
session, and how the theme, the sidebar and drafts survive a quit. The
Settings window tells the workspace what it cannot do itself over a
`BroadcastChannel`: apply the theme picked there, and show the Channels page.

To start over as a new install, quit the app and move
`~/Library/Application Support/Postline` aside.

## First launch and upgrades

A first launch writes the database the build made: already migrated, and
empty. Every later launch compares the migrations the build carries with the
ones the database has had, copies the database aside if any are pending, and
applies them one at a time, each in a transaction with its ledger row. A
migration that fails leaves no half of itself behind.

The ledger is the framework's own `migrations` table, so the database is one
`./buddy migrate` would recognise.

## What runs while it is open

Scheduled posts are published every minute, keyword rules and direct messages
are checked every five, engagement is synced every thirty, and old posts are
cleaned up daily. A post that came due while the app was closed goes out when
it opens if it is less than 30 minutes late. Anything later is held back as
"missed" for you to publish or reschedule, so reopening the app after a week
does not send a week of posts at once. **Nothing publishes while the app is
quit**: for a queue that runs
overnight, run Postline on a machine that stays on.

## Releases

```bash
bun run release:minor
```

That bumps `package.json`, writes the changelog, commits, tags `vX.Y.Z` and
pushes. After CI passes, dispatch the approved tag. ReviewOS builds
`Postline-X.Y.Z-macos-arm64.dmg` on the Mac runner and publishes it to GitHub
through Pantry. [Release checklist](releasing.md).

The release requires the `DESKTOP_SIGNING_IDENTITY` repository variable to
name the approved Developer ID Application identity. The Mac runner verifies
the signed app before packaging the DMG.

## What is not done

- **Notarization.** The release signs the app but does not notarize it. Until
  it does, macOS refuses the first open of a downloaded copy: open it once,
  then choose **Open Anyway** under System Settings > Privacy & Security.
  (The right-click, then Open shortcut no longer works on current macOS.)
  `buddy release:desktop` notarizes, staples and publishes signed update
  manifests; moving the release onto it needs a Developer ID and an update
  signing key.
- **The Mac App Store.** A web view app is built unsandboxed, because the
  agent is a server and a sandboxed app cannot be one this way. The Store
  requires the sandbox. Shipping there means the framework's `macos` desktop
  mode, which is a different app shape.
- **In-app updates.** Not wired up; a new version is a new download.
- **Apple Silicon only.** The release builds `arm64`.
