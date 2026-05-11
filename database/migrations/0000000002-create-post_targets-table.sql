CREATE TABLE IF NOT EXISTS "post_targets" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin')),
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