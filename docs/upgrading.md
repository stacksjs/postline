# Upgrading

## The Mac app

Download the new release and replace the app in Applications. On its first
launch it copies the database aside as
`postline.before-<first new migration>.sqlite` in the data folder, then
applies the new migrations. If a migration fails, the app does not start, the
message names the copy, and the database is left as it was before the
migration began.

Upgrading from v0.1.1 is covered by a test that opens a v0.1.1 database, with
an account, a connected network and posts in it, in the current release
(`tests/unit/desktop-upgrade.test.ts`).

Keep `app.key` with the database: it decrypts the network tokens.

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
./buddy migrate
```

Then restart the web, API, and scheduler services. `./buddy migrate` applies
the pending migrations.

## What changed between v0.1.1 and 1.0

- **Database name.** A checkout from before the rename may still have
  `database/opentimes.sqlite`; the README has the one-line move.
- **Encrypted tokens.** Network tokens are stored encrypted with `APP_KEY`.
  Tokens saved by older versions are encrypted in place the first time
  Postline reads the connected accounts, so nothing has to be reconnected;
  losing `APP_KEY` means reconnecting every account.
- **Publication tables.** The publication product moved to The Open Times;
  its tables stay in an existing database until #72 removes them.
- **Network apps in Settings.** X, LinkedIn, Instagram and Threads apps can be
  entered under Settings, Channels instead of `.env`; values in `.env` still
  apply until something is saved in Settings.
- **Sign-in.** Passkeys and two-factor sign-in are available under Settings,
  Account; the password keeps working.
- **Configuration.** `.env.example` lists every variable Postline reads; ones
  it no longer reads were removed from it.
