# Workspace data and cleanup

## Export or move a workspace

Open **Settings > Data > Export this workspace** to download a JSON archive. On the destination install, use **Import an export**. Imports accept archives up to 64 MB and leave existing records in place. Reconnect accounts and re-enter credentials on the destination. [Connect a network](./networks/index.md).

Treat an export as private. It contains workspace content. For disaster recovery on a server, use the database, media, and application-key backup. [Back up and restore a server](./recovery.md).

## Locate data and back it up

| Installation | Database and media | Encryption key |
|---|---|---|
| Mac | `~/Library/Application Support/Postline`, including `postline.sqlite`, `storage/app/postline-media/`, and `content/blog/` | `app.key` inside that folder |
| Server | The paths configured by `DB_DATABASE_PATH` and `POSTLINE_MEDIA_DIR`. A local checkout defaults to `database/postline.sqlite` and `storage/app/postline-media/`. | The configured `APP_KEY` |

Quit Postline before copying its Mac data directory. Back up the whole directory so the database, attachments, and key stay together. On a server, use the online snapshot procedure in the recovery guide. [Upgrade an existing workspace](./upgrading.md).

## Remove posts from networks

Open **Settings > Channels > Manage Channels**, then **Post removal tools**. Choose the networks and whether to include all posts on those accounts or only posts made through Postline. Preview the results, review the counts, and enter the confirmation phrase if you want to proceed. Supported deletion networks are Bluesky, X, Mastodon, and LinkedIn. Remote deletion is permanent.

For age-based cleanup, use **Settings > Automatic Deletion**. Select the cutoff in days, the scope, and the networks. Preview the rule before saving it. The scheduler checks it daily and preserves posts whose dates it cannot read.

## Remove the local workspace or uninstall

**Settings > Data > Delete everything** clears the current workspace's stored posts, plans, messages, rules, accounts, and images. Posts on social networks remain there. Export anything you want to keep before confirming.

On a Mac, quit Postline from the menu bar and move **Postline.app** out of Applications. Keep the data folder for a later installation, or remove it and `~/Library/Logs/Postline.log` when you no longer need them. On a server, stop the web, API, and scheduler services before removing the installation. Retain the database, media, and application key together if you plan to reinstall, and revoke network or AI credentials you no longer need through their providers.
