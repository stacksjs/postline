# Upgrading

## The Mac app

Open **Settings > General > Software updates** and choose **Check for
updates**. Before installing a verified update, Postline saves a database
snapshot in the workspace’s `update-backups/` directory and keeps the three
most recent snapshots. If the snapshot fails, the installed app stays in place.

You can also download the new release and replace the app in Applications.
On the first launch after either kind of update, Postline copies the database aside as
`postline.before-<first new migration>.sqlite` in the data folder, then
applies the new migrations. If a migration fails, the app does not start, the
message names the copy, and the database is left as it was before the
migration began.

Upgrading from v0.1.1 is covered by a test that opens a v0.1.1 database, with
an account, a connected network and posts in it, in the current release
(`tests/unit/desktop-upgrade.test.ts`).

Postline moves the old `app.key` into the login Keychain and deletes the file
after the workspace has upgraded. Keep the matching Keychain entry to retain
connected accounts after a restore. To reopen the data in a build from before
this migration, use the original key as `app.key` with the pre-upgrade database
copy. [Back up the workspace and its key](./workspace-data.md).

## A server install

Take a [server recovery snapshot](./recovery.md) before migrating. Keep the
database, media and `APP_KEY` together if you need to restore.

```bash
git pull
```

```bash
bun install --frozen-lockfile
```

```bash
bun scripts/migrate-workspace.ts
```

Then restart the web, API, and scheduler services. The migration command
applies the committed migrations and archives any retired publication data
before removing those tables. The container and the Postline server deployment
use the same command.

## What changed between v0.1.1 and 1.0

- **Database name.** A checkout from before the rename may still have
  `database/opentimes.sqlite`. Stop Postline and move it to
  `database/postline.sqlite`. Rename any corresponding `-wal` and `-shm`
  files alongside it, then set `DB_DATABASE_PATH=database/postline.sqlite`
  in `.env` before starting Postline again.
- **Encrypted tokens.** Network tokens are stored encrypted with `APP_KEY`.
  Tokens saved by older versions are encrypted in place the first time
  Postline reads the connected accounts, so nothing has to be reconnected;
  losing `APP_KEY` means reconnecting every account.
- **Publication data.** The publication product moved to The Open Times. If
  your database still contains publication records, the upgrade saves a
  private copy as `postline.retired-publication.sqlite` next to your
  workspace database before removing the retired tables. Keep that SQLite
  copy with your backups if you need to recover the old publication data.
- **Network apps in Settings.** X, LinkedIn, Instagram and Threads apps can be
  entered under Settings, Channels instead of `.env`; values in `.env` still
  apply until something is saved in Settings.
- **X API.** Reconnect X accounts to grant image upload permission. Postline
  estimates and caps API reads at $2 per UTC day by default. See the
  [X setup guide](networks/x.md) for the budget setting and how to check usage.
- **Sign-in.** Passkeys and two-factor sign-in are available under Settings,
  Account; the password keeps working.
- **Configuration.** `.env.example` lists every variable Postline reads; ones
  it no longer reads were removed from it.
