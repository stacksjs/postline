# Back up and restore a Postline server

The production scheduler runs `BackupWorkspace` at 02:00 server time. Set
`POSTLINE_BACKUP_BUCKET` on a production SQLite install to enable it. Give the
job credentials for that bucket and a recovery key separate from `APP_KEY`.
Postline's bucket limits the service credential to uploading objects and
verifying those uploads. Use a separate operator credential to list recovery
sets.

Each recovery set contains a transactionally consistent SQLite snapshot,
the uploaded media, and the original application key. The three files are
encrypted before leaving the server. A `complete.json` object appears only
after S3 confirms all three uploads. The production bucket keeps daily sets
for 90 days and expires rehearsal sets after seven days.

To run the same job on the production scheduler host with its usual
environment loaded:

```bash
./buddy schedule:run-one BackupWorkspace --in-process
```

The job logs the verified `complete.json` path. Search for `BackupWorkspace`
in the scheduler log if a run fails.

## Recover onto a fresh install

1. With an S3 operator credential, choose the newest completed production set.
   Substitute your bucket and the selected directory in the second command.

   ```bash
   aws s3 ls s3://YOUR_BUCKET/snapshots/ --recursive | awk '$4 ~ /\/complete\.json$/ {print $4}' | sort | tail -1
   aws s3 cp s3://YOUR_BUCKET/snapshots/SELECTED_SET/ ./downloaded-postline/ --recursive
   ```

2. Load the recovery key through your secret store as
   `POSTLINE_BACKUP_RECOVERY_KEY`. On the Mac that provisioned Postline's
   bucket, the restore tool can also read `recovery-key` from the
   `postline-production-backups` Keychain service. Run the restore tool on a
   machine with room to decrypt and expand the media archive.

   ```bash
   bun scripts/restore-workspace.ts ./downloaded-postline ./recovered-postline
   ```

   The output path must be new. The tool checks the encrypted files against
   the manifest, authenticates them during decryption, checks SQLite, and
   extracts the media. The output contains `postline.sqlite`, `media/`, and
   `app-key` in a private directory.

3. Before starting the replacement server, place the database and media in
   its `DB_DATABASE_PATH` and `POSTLINE_MEDIA_DIR`. Install the recovered
   `app-key` as `APP_KEY` in its secret store. Keep that value across upgrades
   so Postline can open the encrypted network sign-ins in the database.
4. Start Postline with scheduled publishing paused while verifying the
   workspace. Check that it opens, that a queued image loads, and that
   `/api/postline/health` reports the database and migrations are healthy.
   Transfer scheduling to the replacement server once the original scheduler
   has stopped. Check the [upgrade guide](upgrading.md) before opening an
   older backup with newer Postline code.
