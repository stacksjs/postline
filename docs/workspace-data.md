# Workspace data and cleanup

## Export or move a workspace

Open **Settings > Data > Export this workspace** to download a JSON archive. On the destination install, use **Import an export**. Imports accept archives up to 64 MB and leave existing records in place. Reconnect accounts and re-enter credentials on the destination. The archive keeps each X Listening watch’s selected source. To resume browser-session imports on another Mac, confirm your X sign-in there. [Connect a network](./networks/index.md).

Treat an export as private. It contains workspace content. For disaster recovery on a server, use the database, media, and application-key backup. [Back up and restore a server](./recovery.md).

## Locate data and back it up

| Installation | Database and media | Encryption key |
|---|---|---|
| Mac | `~/Library/Application Support/Postline`, including `postline.sqlite`, `storage/app/postline-media/`, and `content/blog/` | macOS login Keychain. `app.keychain-id` identifies the workspace's entry. |
| Server | The paths configured by `DB_DATABASE_PATH` and `POSTLINE_MEDIA_DIR`. A local checkout defaults to `database/postline.sqlite` and `storage/app/postline-media/`. | The configured `APP_KEY` |

Quit Postline before copying its Mac data directory. Back up the entire directory and the corresponding login Keychain. For a new Mac, Apple's Setup Assistant can transfer the Keychain with your workspace. If you move it manually, copy the matching `org.postline.workspace` entry identified by `app.keychain-id`. [Copy keychains to another Mac](https://support.apple.com/guide/keychain-access/kyca1121/mac).

If you have a separately protected copy of the original key value, save it as `app.key` in the restored data directory with owner-only access. Postline checks it against `app.keychain-id`, imports it into the login Keychain, and removes the file after preparing the workspace. Keep your recovery copy separate from the data folder.

On a server, use the online snapshot procedure. [Back up and restore a server](./recovery.md).

## Remove posts from networks

Open **Settings > Channels > Manage Channels**, then **Cleanup**. Choose the networks and whether to include all posts on those accounts or only posts made through Postline. Preview the results, review the counts, and enter the confirmation phrase if you want to proceed. Supported deletion networks are Bluesky, X, Mastodon, and LinkedIn. Remote deletion is permanent.

For age-based cleanup, use **Settings > Automatic Cleanup**. Select the cutoff in days, the scope, and the networks. Preview the rule before saving it. The scheduler checks it daily and preserves posts whose dates it cannot read.

## Remove the local workspace or uninstall

**Settings > Data > Delete everything** clears the current workspace's stored posts, plans, messages, rules, accounts, and images. Posts on social networks remain there. Export anything you want to keep before confirming.

On a Mac, quit Postline from the menu bar and move **Postline.app** out of Applications. Keep the data folder and Keychain entry for a later installation. To clear all local data, use `app.keychain-id` to identify the `org.postline.workspace` entry in Keychain Access before removing it, the data folder, and `~/Library/Logs/Postline.log`. On a server, stop the web, API, and scheduler services before removing the installation. Retain the database, media, and application key if you plan to reinstall, and revoke network or AI credentials you no longer need through their providers.
