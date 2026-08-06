PRAGMA foreign_keys=OFF;
BEGIN;
CREATE TABLE "_qb_tmp_purge_runs" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin', 'threads', 'blog', 'postline')) not null,
  "handle" TEXT,
  "scope" TEXT CHECK ("scope" IN ('tracked', 'all')) not null default 'tracked',
  "mode" TEXT CHECK ("mode" IN ('preview', 'execute')) not null default 'preview',
  "status" TEXT CHECK ("status" IN ('previewed', 'completed', 'partial', 'failed', 'skipped')) not null default 'previewed',
  "matched_count" INTEGER default 0,
  "deleted_count" INTEGER default 0,
  "failed_count" INTEGER default 0,
  "details" TEXT,
  "failure_reason" TEXT,
  "finished_at" TEXT,
  "account_id" INTEGER REFERENCES "accounts"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
INSERT INTO "_qb_tmp_purge_runs" ("id", "provider", "handle", "scope", "mode", "status", "matched_count", "deleted_count", "failed_count", "details", "failure_reason", "finished_at", "account_id", "created_at", "updated_at", "uuid") SELECT "id", "provider", "handle", "scope", "mode", "status", "matched_count", "deleted_count", "failed_count", "details", "failure_reason", "finished_at", "account_id", "created_at", "updated_at", "uuid" FROM "purge_runs";
DROP TABLE "purge_runs";
ALTER TABLE "_qb_tmp_purge_runs" RENAME TO "purge_runs";
CREATE INDEX IF NOT EXISTS "purge_runs_provider_created_at_index" ON "purge_runs" ("provider", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "purge_runs_uuid_unique" ON "purge_runs" ("uuid");
PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys=ON;
