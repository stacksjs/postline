# Installing the Mac app

The Mac app is Postline in one download: no server, no domain, no account to
create. The person at the Mac is the owner.

## What it needs

- macOS 13 (Ventura) or later
- A Mac with Apple silicon (M1 or newer). Intel builds are tracked in #205.

## Install

1. Download the latest `Postline-<version>-macos-arm64.dmg` from
   [the download page](https://postline.stacksjs.com/download) or
   [GitHub releases](https://github.com/stacksjs/postline/releases/latest).
   `checksums.txt` on the release lists each file's SHA-256.
2. Open the disk image and drag **Postline** into **Applications**.
3. Open Postline. Until releases are notarized by Apple (#191), macOS says it
   cannot check the app. Open **System Settings > Privacy & Security** and
   choose **Open Anyway** next to Postline. You do this once.

The app opens on the composer. Connect a network next:
[Connecting networks](./networks/index.md).

## Where your data lives

Everything is in `~/Library/Application Support/Postline`: the database, the
key that encrypts your network tokens (`app.key`), images attached to queued
posts, and blog posts. The log is `~/Library/Logs/Postline.log`; **Settings >
General > Troubleshooting > Show in Finder** opens it.

Back up that folder to keep your workspace. To move to another Mac, use
**Settings > Data > Export this workspace** and import it there; network
sign-ins do not travel and are connected again.

## Running in the background

Closing the window keeps Postline running in the menu bar, so scheduled
posts still go out. The menu-bar item shows the next post, pauses and resumes
publishing, opens Postline at login, and quits it.

## Updating and uninstalling

Download the new release and replace the app in Applications; your data
folder is kept and migrated on first launch, with a copy of the database made
before each migration. To uninstall, quit Postline, delete it from
Applications, and delete the data folder and the log if you want nothing left.
