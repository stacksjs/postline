CREATE TABLE IF NOT EXISTS "post_targets" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "provider" TEXT CHECK ("provider" IN ('bluesky', 'twitter', 'mastodon', 'facebook', 'instagram', 'tiktok', 'linkedin', 'threads', 'blog')) not null,
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
CREATE INDEX IF NOT EXISTS "post_targets_provider_status_index" ON "post_targets" ("provider", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "post_targets_uuid_unique" ON "post_targets" ("uuid");
