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
| `update-backups/` | The three most recent snapshots taken before an in-app update |

The log is `~/Library/Logs/Postline.log`.

## How it is put together

| File | What it does |
|---|---|
| `config/desktop.ts` | The `webview` app: name, bundle id, window, where the agent and the views are |
| `app/Desktop/Agent.ts` | Redirects the window to Composer and starts the recurring jobs |
| `app/Desktop/Prepare.ts` | Loads the workspace key and sets the working directory and environment during startup |
| `app/Desktop/keychain.ts` | Loads or creates the workspace key in the login Keychain and migrates the legacy key file after a successful upgrade |
| `app/Desktop/schedule.ts` | Runs the recurring jobs on timers while the app is open |
| `app/Desktop/build-views.ts` | Builds the pages the app carries: the workspace, without the marketing site |
| `scripts/desktop-check.ts` | Compiled and run from an empty directory, proves the agent serves the API and writes to its database. The release runs it before imaging |
| `resources/views/settings.stx`, `resources/layouts/settings.stx` | The Settings window |
| `app/Desktop/icon.svg`, `AppIcon.icns`, `scripts/app-icon.ts` | The icon, and the script that draws it |

Stacks embeds the routes, actions, middleware, migrations, client scripts
and configuration in the agent. Its launcher calls `Prepare.ts` before
database migration and config loading. The agent removes the legacy key
file after migrations succeed and starts the recurring jobs.

The launcher trades the window's one-time token for a session cookie and
requires it on later requests. `Prepare.ts` sets `POSTLINE_DESKTOP_AGENT`
so workspace routes recognize the desktop owner once the request passes
the launcher's session check.

## Build and run

```bash
./buddy build:desktop
```

```bash
open storage/framework/desktop/webview/darwin-arm64/Postline.app
```

`./buddy dev:desktop` runs the same agent from source, with the views rendered
live.

To check the compiled agent the way the release does:

```bash
bun scripts/desktop-check.ts
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

Open **Notifications** and choose **Allow notifications** to enable macOS
alerts. This pane shows the current permission and whether email alerts and
the alert webhook are configured. **Open Activity** takes you to the alerts
in the workspace window.
Open **About** for the installed version, updates, and the log in Finder.

For a network that accepts a loopback OAuth callback, copy the address in
**Channels > Your network apps** into that app's developer console. Postline
remembers the agent port between launches. If the displayed address changes
because the port was in use, update the registered callback before connecting.
**Connect** and **Test connection** open consent in your default browser.
Return to Postline to see the result and, for Instagram, choose a Facebook Page.
Each network guide covers the required developer-app settings.

To start over as a new install, quit the app and move
`~/Library/Application Support/Postline` aside.

## First launch and upgrades

On first launch, Stacks creates the database and applies the migrations in
the build. On upgrades it backs up the database before applying any pending
migrations and restores the backup if a migration fails.

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
identify the approved Developer ID Application certificate. Use its
fingerprint when the Keychain has more than one certificate under that name.
The Mac runner verifies the signed app before packaging the DMG.

## What is not done

- **Notarization.** Apple accepted a Developer ID–signed test DMG, and
  Gatekeeper verified the stapled image. The release workflow uses
  `buddy release:desktop` with the approved notarytool profile to sign the
  distribution and update feed.
  [Release workflow tracking](https://github.com/stacksjs/postline/issues/191).
- **The Mac App Store.** A web view app is built unsandboxed, because the
  agent is a server and a sandboxed app cannot be one this way. The Store
  requires the sandbox. Shipping there means the framework's `macos` desktop
  mode, which is a different app shape.
- **In-app updates.** Settings shows the installed version and can check the
  signed feed. The stable feed gains an update after an approved release.
  The install-time workspace backup and the two-version Mac rehearsal are
  tracked in [#193](https://github.com/stacksjs/postline/issues/193).
- **Apple Silicon only.** The release builds `arm64`.
