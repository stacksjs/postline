-- Rebrand: the app's own publication provider is `opentimes`, not `postline`.
--
-- `provider` is a CHECK-constrained TEXT column, and SQLite cannot alter a
-- CHECK in place — so both tables are rebuilt exactly the way the generated
-- migrations 0000000089 and 0000000095 built them, with the value translated on
-- the way across. Existing rows are rewritten in the same statement that copies
-- them, so no row is ever briefly in violation of the new constraint.
PRAGMA foreign_keys=OFF;
BEGIN;

CREATE TABLE "_qb_tmp_post_targets" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin', 'threads', 'blog', 'opentimes')) not null,
  "status" TEXT CHECK ("status" IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'skipped')) not null default 'draft',
  "scheduled_at" TEXT,
  "remote_uri" TEXT,
  "remote_cid" TEXT,
  "failure_reason" TEXT,
  "metrics" TEXT,
  "post_id" INTEGER REFERENCES "posts"("id"),
  "social_driver_id" INTEGER REFERENCES "social_drivers"("id"),
  "social_identity_id" INTEGER REFERENCES "social_identities"("id"),
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
INSERT INTO "_qb_tmp_post_targets" ("id", "provider", "status", "scheduled_at", "remote_uri", "remote_cid", "failure_reason", "metrics", "post_id", "social_driver_id", "social_identity_id", "created_at", "updated_at", "uuid") SELECT "id", CASE "provider" WHEN 'postline' THEN 'opentimes' ELSE "provider" END, "status", "scheduled_at", "remote_uri", "remote_cid", "failure_reason", "metrics", "post_id", "social_driver_id", "social_identity_id", "created_at", "updated_at", "uuid" FROM "post_targets";
DROP TABLE "post_targets";
ALTER TABLE "_qb_tmp_post_targets" RENAME TO "post_targets";
CREATE INDEX IF NOT EXISTS "post_targets_provider_status_index" ON "post_targets" ("provider", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "post_targets_uuid_unique" ON "post_targets" ("uuid");

CREATE TABLE "_qb_tmp_purge_runs" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin', 'threads', 'blog', 'opentimes')) not null,
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
INSERT INTO "_qb_tmp_purge_runs" ("id", "provider", "handle", "scope", "mode", "status", "matched_count", "deleted_count", "failed_count", "details", "failure_reason", "finished_at", "account_id", "created_at", "updated_at", "uuid") SELECT "id", CASE "provider" WHEN 'postline' THEN 'opentimes' ELSE "provider" END, "handle", "scope", "mode", "status", "matched_count", "deleted_count", "failed_count", "details", "failure_reason", "finished_at", "account_id", "created_at", "updated_at", "uuid" FROM "purge_runs";
DROP TABLE "purge_runs";
ALTER TABLE "_qb_tmp_purge_runs" RENAME TO "purge_runs";
CREATE INDEX IF NOT EXISTS "purge_runs_provider_created_at_index" ON "purge_runs" ("provider", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "purge_runs_uuid_unique" ON "purge_runs" ("uuid");

PRAGMA foreign_key_check;
COMMIT;
PRAGMA foreign_keys=ON;
