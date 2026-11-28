# Installing the Mac app

The Mac app is Postline in one download: no server, no domain, no account to
create. The person at the Mac is the owner.

## What it needs

- macOS 13 (Ventura) or later
- A Mac with Apple silicon (M1 or newer). Intel builds are tracked in #205.

## Install

1. Download the latest `Postline-<version>-macos-arm64.dmg` from
   [the download page](https://postline.theopentimes.org/download) or
   [GitHub releases](https://github.com/stacksjs/postline/releases/latest).
   `checksums.txt` on the release lists each file's SHA-256.
2. Open the disk image and drag **Postline** into **Applications**.
3. Open Postline from **Applications**. If macOS cannot verify the download,
   check GitHub Releases for a signed and notarized build. Notarization for
   public builds is tracked in [#191](https://github.com/stacksjs/postline/issues/191).

The app opens on the composer. Connect a network next:
[Connecting networks](./networks/index.md).

## Where your data lives

The database, queued images, and blog posts are in
`~/Library/Application Support/Postline`. The login Keychain holds the key
that encrypts your network tokens. Open **Settings > General > Troubleshooting >
Show in Finder** to find `~/Library/Logs/Postline.log`.

Back up that folder and the matching Keychain entry to keep your workspace
and its sign-ins. You can also export the workspace from **Settings > Data**
and reconnect your accounts after import. [Back up or move a workspace](./workspace-data.md).

## Running in the background

Closing the window keeps Postline running in the menu bar, so scheduled
posts still go out. The menu-bar item shows the next post, pauses and resumes
publishing, opens Postline at login, and quits it.

## Updating and uninstalling

Open **Settings > About > Check for updates** to look for a signed update.
Postline saves a database snapshot before installing an in-app update. You can
also download a release and replace the app in Applications. Postline keeps
your data folder and makes a copy of the database before each migration.

To uninstall, quit Postline and remove it from Applications. To erase the
local workspace as well, follow [Back up or move a workspace](./workspace-data.md).
