-- The provider CHECK constraint predates the Threads driver and the blog
-- target, so inserts for either provider fail. SQLite can't alter a CHECK
-- in place — rebuild the table with the widened constraint.
CREATE TABLE IF NOT EXISTS "post_targets_new" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin', 'threads', 'blog')),
  "status" TEXT CHECK ("status" IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'skipped')) default 'draft',
  "scheduled_at" TEXT,
  "remote_uri" TEXT,
  "remote_cid" TEXT,
  "failure_reason" TEXT,
  "metrics" TEXT,
  "post_id" INTEGER,
  "social_driver_id" INTEGER,
  "social_identity_id" INTEGER,
  "created_at" TEXT not null default CURRENT_TIMESTAMP,
  "updated_at" TEXT,
  "uuid" TEXT
);
INSERT INTO "post_targets_new" SELECT * FROM "post_targets";
DROP TABLE "post_targets";
ALTER TABLE "post_targets_new" RENAME TO "post_targets";
CREATE INDEX IF NOT EXISTS "post_targets_provider_status_index" ON "post_targets" ("provider", "status");
